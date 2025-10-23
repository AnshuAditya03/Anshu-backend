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

// Load .env only during local development. 
if (process.env.NODE_ENV !== "production") {
    dotenv.config({ path: path.resolve(__dirname, '.env') });
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Helper function for exponential backoff delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const MAX_RETRIES = 3;

// ---------------- 1. Multilingual Voice Map ----------------
const VOICE_MAP = {
    'en': { languageCode: 'en-US', name: 'en-US-Neural2-J', ssmlGender: 'MALE' }, 
    'es': { languageCode: 'es-ES', name: 'es-ES-Wavenet-C', ssmlGender: 'MALE' }, 
    'fr': { languageCode: 'fr-FR', name: 'fr-FR-Wavenet-B', ssmlGender: 'MALE' }, 
    'de': { languageCode: 'de-DE', name: 'de-DE-Wavenet-E', ssmlGender: 'MALE' }, 
    'ja': { languageCode: 'ja-JP', name: 'ja-JP-Wavenet-D', ssmlGender: 'MALE' }, 
    'ru': { languageCode: 'ru-RU', name: 'ru-RU-Wavenet-C', ssmlGender: 'MALE' }, 
    'hi': { languageCode: 'hi-IN', name: 'hi-IN-Wavenet-C', ssmlGender: 'MALE' },
    'ta': { languageCode: 'ta-IN', name: 'ta-IN-Wavenet-D', ssmlGender: 'MALE' }, 
    'te': { languageCode: 'te-IN', name: 'te-IN-Wavenet-C', ssmlGender: 'MALE' },
    'ml': { languageCode: 'ml-IN', name: 'ml-IN-Wavenet-B', ssmlGender: 'MALE' },
    'kn': { languageCode: 'kn-IN', name: 'kn-IN-Wavenet-B', ssmlGender: 'MALE' },
};

// ---------------- Init Clients ----------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SONIOX_API_KEY = process.env.SONIOX_API_KEY;

if (!GEMINI_API_KEY || !SONIOX_API_KEY) {
    console.error("❌ API Keys missing! Check your environment variables.");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const ttsClient = new TextToSpeechClient();
const sonioxClient = new SpeechClient({ api_key: SONIOX_API_KEY });

// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' });

// ---------------- STATIC FILE SERVING ----------------
// Added this for the UI (multilang.html) to load correctly
app.use(express.static(__dirname)); 

// ---------------- Root route ----------------
app.get("/", (req, res) => {
    // Serves the HTML file when the user visits http://localhost:3000/
    res.sendFile(path.join(__dirname, 'anshu.html')); 
});


// ---------------- HTTP route for file transcription (TRANSLATOR MODE) ----------------
app.post("/transcribe-file", upload.single('audio'), async (req, res) => {
    let audioFilePath = req.file?.path; 
    
    // 1. GET TARGET LANGUAGE FROM FRONTEND
    const targetLangCode = req.body.targetLangCode || 'en';
    const ttsVoiceConfig = VOICE_MAP[targetLangCode]; 
    let spokenLangCode = 'en'; // Initialize local variable for spoken language

    try {
        if (!req.file) {
            return res.status(400).json({ error: "No audio file provided" });
        }
        if (!ttsVoiceConfig) {
             return res.status(400).json({ error: `Unsupported target language code: ${targetLangCode}` });
        }
        
        console.log(`Received audio file. Target response language: ${targetLangCode}`);
        
        // ⭐ 2. TRANSCRIBE WITH SONIOX: Using the stable model for multilingual compatibility.
        // We rely on Soniox's passive ability to detect non-English words.
        const sonioxModel = "en_v2"; 
        
        const result = await sonioxClient.transcribeFileShort(
            audioFilePath,
            { model: sonioxModel }
        );

        // 3. EXTRACT TRANSCRIPT AND DETECTED LANGUAGE
        let transcribedText = "";
        
        transcribedText = result.words.map(word => {
            // Use a local variable to capture the language code from the first detected word.
            if (word.language && spokenLangCode === 'en') {
                spokenLangCode = word.language; 
            }
            return word.text;
        }).join("").replace(/(\s+)([.,?!;])/g, '$2').trim();
        
        console.log(`Final Transcription (Spoken in ${spokenLangCode} using stable model ${sonioxModel}): "${transcribedText}"`);
        
        // --- CLEANUP: Delete temporary file ---
        if (fs.existsSync(audioFilePath)) {
            fs.unlinkSync(audioFilePath);
        }

        if (transcribedText.length === 0) {
            return res.status(400).json({ error: "Could not transcribe audio. Text is empty." });
        }

        // 4. CONSTRUCT PROMPT: Respond in the TARGET language (UI selection)
        const systemInstruction = `You are a helpful and friendly virtual assistant.
        The user spoke in the language code: ${spokenLangCode}.
        The required output response language is: ${targetLangCode}.
        Respond ONLY in the required output language (${targetLangCode}) to the user's question.`;

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction });
        
        let geminiResult;
        // --- EXPONENTIAL BACKOFF RETRY FOR GEMINI ---
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                geminiResult = await model.generateContent(transcribedText);
                break; 
            } catch (error) {
                if (attempt === MAX_RETRIES - 1) { throw error; }
                await delay(Math.pow(2, attempt) * 1000);
            }
        }
        // --- END RETRY BLOCK ---

        let geminiTextResponse = geminiResult.response.text().trim();
        if (geminiTextResponse.startsWith('```') && geminiTextResponse.endsWith('```')) {
            geminiTextResponse = geminiTextResponse.split('\n').slice(1, -1).join('\n').trim();
        }

        if (!geminiTextResponse) {
            return res.status(500).json({ error: "Gemini did not provide a response" });
        }
        
        console.log(`Gemini Response (in ${targetLangCode}): "${geminiTextResponse}"`);

        // 5. SYNTHESIZE SPEECH: Use the voice configured for the TARGET language
        const [ttsResponse] = await ttsClient.synthesizeSpeech({
            input: { text: geminiTextResponse },
            voice: ttsVoiceConfig, // <--- Uses the TARGET language voice
            audioConfig: { audioEncoding: 'MP3' },
        });

        res.set("Content-Type", "audio/mpeg");
        res.send(ttsResponse.audioContent);

    } catch (err) {
        console.error("API error:", err.message || err);
        
        // --- CLEANUP ON ERROR ---
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
