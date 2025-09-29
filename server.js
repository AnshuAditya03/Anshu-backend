import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { SpeechClient } from '@soniox/soniox-node';
import multer from 'multer';
import fs from 'fs';

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env only during local development. Remove this line for production.
if (process.env.NODE_ENV !== "production") {
    dotenv.config({ path: path.resolve(__dirname, '.env') });
}

const app = express();
app.use(cors());
app.use(express.json());

// For deployment, use the port provided by the hosting environment
const PORT = process.env.PORT || 3000;

// Helper function for exponential backoff delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const MAX_RETRIES = 3;

// ---------------- 1. Multilingual Voice Map (FIXED TAMIL VOICE NAME) ----------------
// Maps the simple 2-letter language code (from the frontend) to the full
// Google Cloud TTS voice configuration, now using premium WaveNet/Neural voices.
const VOICE_MAP = {
    // English (US) - High-quality Neural Male voice
    'en': { languageCode: 'en-US', name: 'en-US-Neural2-J', ssmlGender: 'MALE' }, 
    // Spanish (Spain) - WaveNet Male
    'es': { languageCode: 'es-ES', name: 'es-ES-Wavenet-C', ssmlGender: 'MALE' }, 
    // French (France) - WaveNet Male
    'fr': { languageCode: 'fr-FR', name: 'fr-FR-Wavenet-B', ssmlGender: 'MALE' }, 
    // German (Germany) - WaveNet Male
    'de': { languageCode: 'de-DE', name: 'de-DE-Wavenet-E', ssmlGender: 'MALE' }, 
    // Japanese (Japan) - WaveNet Male
    'ja': { languageCode: 'ja-JP', name: 'ja-JP-Wavenet-D', ssmlGender: 'MALE' }, 
    // Russian (Russia) - WaveNet Male
    'ru': { languageCode: 'ru-RU', name: 'ru-RU-Wavenet-C', ssmlGender: 'MALE' }, 
    // Hindi (India) - WaveNet Male
    'hi': { languageCode: 'hi-IN', name: 'hi-IN-Wavenet-C', ssmlGender: 'MALE' },
    // Tamil (India) - FIX: Switched to reliable Wavenet-D
    'ta': { languageCode: 'ta-IN', name: 'ta-IN-Wavenet-D', ssmlGender: 'MALE' }, 
    // Telugu (India) - UPGRADED to WaveNet Male
    'te': { languageCode: 'te-IN', name: 'te-IN-Wavenet-C', ssmlGender: 'MALE' },
    // Malayalam (India) - UPGRADED to WaveNet Male
    'ml': { languageCode: 'ml-IN', name: 'ml-IN-Wavenet-B', ssmlGender: 'MALE' },
    // Kannada (India) - UPGRADED to WaveNet Male
    'kn': { languageCode: 'kn-IN', name: 'kn-IN-Wavenet-B', ssmlGender: 'MALE' },
};

// ---------------- Init Clients ----------------
// In a deployed environment, these variables should be provided by the host.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SONIOX_API_KEY = process.env.SONIOX_API_KEY;

if (!GEMINI_API_KEY) {
    console.error("❌ Gemini API Key missing! Check your environment variables.");
    // In production, you would exit here: process.exit(1);
}

if (!SONIOX_API_KEY) {
    console.error("❌ Soniox API Key missing! Check your environment variables.");
    // In production, you would exit here: process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const ttsClient = new TextToSpeechClient();
const sonioxClient = new SpeechClient({
    api_key: SONIOX_API_KEY,
});

// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' });

// ---------------- Root route ----------------
app.get("/", (req, res) => {
    res.send("✅ Anshu backend running.");
});

// ---------------- HTTP route for file transcription (Production-ready version) ----------------
app.post("/transcribe-file", upload.single('audio'), async (req, res) => {
    let audioFilePath = req.file?.path; // Use optional chaining to safely get path
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No audio file provided" });
        }

        // 2. GET TARGET LANGUAGE FROM FRONTEND
        const targetLangCode = req.body.targetLangCode || 'en';
        const ttsVoiceConfig = VOICE_MAP[targetLangCode];

        if (!ttsVoiceConfig) {
             return res.status(400).json({ error: `Unsupported target language code: ${targetLangCode}` });
        }

        console.log(`Received audio file for processing. Target response language: ${targetLangCode}`);

        // 3. TRANSCRIBE WITH SONIOX, USING A STABLE FILE MODEL
        const sonioxModel = "en_v2"; 
        
        const result = await sonioxClient.transcribeFileShort(
            audioFilePath,
            { 
                model: sonioxModel, 
            }
        );

        // 4. EXTRACT TRANSCRIPT AND DETECTED LANGUAGE
        const transcribedText = result.words.map(word => {
            // Soniox returns the language code per token. We will assume the language of the first spoken word 
            // is the overall spoken language for context.
            if (word.language && !req.spokenLangCode) {
                req.spokenLangCode = word.language; 
            }
            return word.text;
        }).join("").replace(/(\s+)([.,?!;])/g, '$2').trim();
        
        const spokenLangCode = req.spokenLangCode || 'en'; // Default to English if detection fails
        
        console.log(`Final Transcription (Spoken in ${spokenLangCode}): "${transcribedText}"`);
        
        // **PRODUCTION CLEANUP**: Clean up the temporary file on success
        if (fs.existsSync(audioFilePath)) {
            fs.unlinkSync(audioFilePath);
        }

        if (transcribedText.length === 0) {
            return res.status(400).json({ error: "Could not transcribe audio. Text is empty." });
        }

        // 5. CONSTRUCT MULTILINGUAL PROMPT FOR GEMINI
        const systemInstruction = `You are a helpful and friendly virtual assistant.
        The user spoke in the language code: ${spokenLangCode}.
        The required output response language is: ${targetLangCode}.
        Respond ONLY in the required output language (${targetLangCode}) to the user's question.`;

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction });
        
        let geminiResult;
        
        // --- EXPONENTIAL BACKOFF RETRY FOR GEMINI ---
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                // Send the transcription as the user's prompt
                geminiResult = await model.generateContent(transcribedText);
                break; // Success! Exit the loop
            } catch (error) {
                console.warn(`Gemini generation failed (Attempt ${attempt + 1}/${MAX_RETRIES}). Retrying...`);
                if (attempt === MAX_RETRIES - 1) {
                    throw error; // Throw the error if it was the final attempt
                }
                const backoffTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
                await delay(backoffTime);
            }
        }
        // --- END RETRY BLOCK ---

        if (!geminiResult) {
             return res.status(500).json({ error: "Gemini failed to provide a response after all retries." });
        }
        
        // FIX: Call .text() as a function before trimming
        let geminiTextResponse = geminiResult.response.text().trim();
        
        // Remove markdown wrappers if Gemini added them (e.g., from an internal instruction to use JSON)
        if (geminiTextResponse.startsWith('```') && geminiTextResponse.endsWith('```')) {
            const lines = geminiTextResponse.split('\n');
            lines.shift(); // Remove starting ```
            lines.pop(); // Remove ending ```
            geminiTextResponse = lines.join('\n').trim();
        }

        if (!geminiTextResponse) {
            return res.status(500).json({ error: "Gemini did not provide a response" });
        }
        
        console.log(`Gemini Response (in ${targetLangCode}): "${geminiTextResponse}"`);

        // 6. SYNTHESIZE SPEECH USING DYNAMIC VOICE MAP
        const [ttsResponse] = await ttsClient.synthesizeSpeech({
            input: { text: geminiTextResponse },
            voice: ttsVoiceConfig, // <--- Dynamic voice selection
            audioConfig: { audioEncoding: 'MP3' },
        });

        res.set("Content-Type", "audio/mpeg");
        res.send(ttsResponse.audioContent);

    } catch (err) {
        console.error("API error:", err.message || err);
        
        // **PRODUCTION CLEANUP**: Ensure temporary file is cleaned up even on error
        if (audioFilePath && fs.existsSync(audioFilePath)) {
            fs.unlinkSync(audioFilePath);
        }
        
        res.status(500).json({
            error: "Failed to process audio file",
            details: err.message
        });
    }
});


// ---------------- HTTP route (for a fallback or simple text input) (UPDATED with Retry) ----------------
app.post("/speak", async (req, res) => {
    try {
        const { text, targetLangCode = 'en' } = req.body;
        if (!text) {
            return res.status(400).json({ error: "No text provided" });
        }

        const ttsVoiceConfig = VOICE_MAP[targetLangCode] || VOICE_MAP['en'];

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction: `Respond ONLY in the language specified by the language code: ${targetLangCode}` });
        
        let result;
        
        // --- EXPONENTIAL BACKOFF RETRY FOR GEMINI ---
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                result = await model.generateContent(text);
                break; // Success! Exit the loop
            } catch (error) {
                console.warn(`Gemini generation failed (Attempt ${attempt + 1}/${MAX_RETRIES}). Retrying...`);
                if (attempt === MAX_RETRIES - 1) {
                    throw error; // Throw the error if it was the final attempt
                }
                const backoffTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
                await delay(backoffTime);
            }
        }
        // --- END RETRY BLOCK ---

        if (!result) {
            return res.status(500).json({ error: "Gemini did not provide a response after all retries" });
        }
        
        // Improvement: Ensure the text is trimmed immediately
        const geminiTextResponse = result.response.text().trim();

        if (!geminiTextResponse) {
            return res.status(500).json({ error: "Gemini did not provide a response" });
        }

        const [ttsResponse] = await ttsClient.synthesizeSpeech({
            input: { text: geminiTextResponse },
            voice: ttsVoiceConfig,
            audioConfig: { audioEncoding: 'MP3' },
        });

        res.set("Content-Type", "audio/mpeg");
        res.send(ttsResponse.audioContent);

    } catch (err) {
        console.error("API error:", err.message || err);
        res.status(500).json({
            error: "Failed to generate speech",
            details: err.message
        });
    }
});

// ---------------- Start server ----------------
app.listen(PORT, () => {
    console.log(`✅ Anshu backend running on http://localhost:${PORT}`);
});
