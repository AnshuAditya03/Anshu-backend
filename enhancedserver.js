import express from 'express';
// 💡 NEW IMPORT: express-ws for WebSocket support
import expressWs from 'express-ws'; 
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
// 💡 Note: Soniox uses 'SpeechClient' for its streaming API
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
// 💡 INITIALIZE EXPRESS-WS to wrap the Express app
const wsInstance = expressWs(app);
const wsApp = wsInstance.app; // This is the app object that now supports .ws() routes

app.use(cors());
app.use(express.json());

// For deployment, use the port provided by the hosting environment
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

if (!GEMINI_API_KEY) {
    console.error("❌ Gemini API Key missing! Check your environment variables.");
}

if (!SONIOX_API_KEY) {
    console.error("❌ Soniox API Key missing! Check your environment variables.");
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

// ---------------- HTTP route for file transcription (Original logic) ----------------
app.post("/transcribe-file", upload.single('audio'), async (req, res) => {
    let audioFilePath = req.file?.path; 
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No audio file provided" });
        }

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
        let spokenLangCode = 'en';
        const transcribedText = result.words.map(word => {
            if (word.language && !spokenLangCode) {
                spokenLangCode = word.language; 
            }
            return word.text;
        }).join("").replace(/(\s+)([.,?!;])/g, '$2').trim();
        
        console.log(`Final Transcription (Spoken in ${spokenLangCode}): "${transcribedText}"`);
        
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
        
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                geminiResult = await model.generateContent(transcribedText);
                break; 
            } catch (error) {
                console.warn(`Gemini generation failed (Attempt ${attempt + 1}/${MAX_RETRIES}). Retrying...`);
                if (attempt === MAX_RETRIES - 1) {
                    throw error; 
                }
                const backoffTime = Math.pow(2, attempt) * 1000; 
                await delay(backoffTime);
            }
        }

        if (!geminiResult) {
             return res.status(500).json({ error: "Gemini failed to provide a response after all retries." });
        }
        
        let geminiTextResponse = geminiResult.response.text().trim();
        
        // Remove markdown wrappers
        if (geminiTextResponse.startsWith('```') && geminiTextResponse.endsWith('```')) {
            const lines = geminiTextResponse.split('\n');
            lines.shift(); 
            lines.pop(); 
            geminiTextResponse = lines.join('\n').trim();
        }

        if (!geminiTextResponse) {
            return res.status(500).json({ error: "Gemini did not provide a response" });
        }
        
        console.log(`Gemini Response (in ${targetLangCode}): "${geminiTextResponse}"`);

        // 6. SYNTHESIZE SPEECH USING DYNAMIC VOICE MAP
        const [ttsResponse] = await ttsClient.synthesizeSpeech({
            input: { text: geminiTextResponse },
            voice: ttsVoiceConfig, 
            audioConfig: { audioEncoding: 'MP3' },
        });

        res.set("Content-Type", "audio/mpeg");
        res.send(ttsResponse.audioContent);

    } catch (err) {
        console.error("API error:", err.message || err);
        
        if (audioFilePath && fs.existsSync(audioFilePath)) {
            fs.unlinkSync(audioFilePath);
        }
        
        res.status(500).json({
            error: "Failed to process audio file",
            details: err.message
        });
    }
});


// ---------------- WebSocket route for real-time STT (NEW REAL-TIME LOGIC) ----------------
wsApp.ws('/live-stt', (ws, req) => {
    console.log("WebSocket client connected for live STT.");

    // Start a real-time transcription session with Soniox.
    const sonioxStream = sonioxClient.startTranscription({
        // Recommended model for low-latency real-time
        model: "stt-rt-preview", 
        // Essential for multi-language support without pre-selection
        enableLanguageIdentification: true, 
        // Helps Soniox detect silence and finalize the transcript
        enableEndpointDetection: true 
    });

    let transcribedText = "";
    let spokenLangCode = ""; 
    let ttsResponseSent = false;

    // --- 1. Audio Data Flow (Client -> Server -> Soniox) ---
    ws.on('message', (audioChunk) => {
        // Audio stream from the frontend is piped directly to Soniox.
        if (sonioxStream.writable) {
            try {
                sonioxStream.write(audioChunk);
            } catch (e) {
                console.error("Error writing to Soniox stream:", e.message);
                ws.close(1011, "Internal server error during streaming.");
            }
        }
    });

    // --- 2. Transcription Result Flow (Soniox -> Server) ---
    sonioxStream.on('data', async (response) => {
        // We only proceed when Soniox sends the final, confirmed transcription for the utterance.
        if (response.is_final) {
            transcribedText = response.text.trim();
            spokenLangCode = response.language_code || 'en';
            console.log(`\n[STT FINAL] Spoken in ${spokenLangCode}: "${transcribedText}"`);

            // Immediately stop the Soniox stream for this turn to free resources
            sonioxStream.end(); 
            
            if (transcribedText.length === 0 || ttsResponseSent) {
                return; 
            }

            ttsResponseSent = true;

            // --- 3. Gemini Processing and TTS Response ---
            try {
                // Determine the language for the TTS response (reply in the detected native language)
                const targetLangCode = spokenLangCode; 
                const ttsVoiceConfig = VOICE_MAP[targetLangCode] || VOICE_MAP['en'];

                const systemInstruction = `You are a helpful and friendly virtual assistant.
                The user spoke in the language code: ${spokenLangCode}.
                The required output response language is: ${targetLangCode}.
                Respond ONLY in the required output language (${targetLangCode}) to the user's question.`;

                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction });
                
                let geminiResult;
                for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                    try {
                        geminiResult = await model.generateContent(transcribedText);
                        break; 
                    } catch (error) {
                        const backoffTime = Math.pow(2, attempt) * 1000;
                        if (attempt === MAX_RETRIES - 1) throw error;
                        await delay(backoffTime);
                    }
                }
                
                if (!geminiResult) throw new Error("Gemini failed to generate content.");

                let geminiTextResponse = geminiResult.response.text().trim();
                
                // Final check and cleanup of markdown
                if (geminiTextResponse.startsWith('```') && geminiTextResponse.endsWith('```')) {
                    geminiTextResponse = geminiTextResponse.split('\n').slice(1, -1).join('\n').trim();
                }
                
                console.log(`[GEMINI] Response: "${geminiTextResponse}"`);

                // 4. Synthesize Speech
                const [ttsResponse] = await ttsClient.synthesizeSpeech({
                    input: { text: geminiTextResponse },
                    voice: ttsVoiceConfig,
                    audioConfig: { audioEncoding: 'MP3' },
                });

                // 5. Send Audio Back to Frontend Client as a binary message
                ws.send(ttsResponse.audioContent, { binary: true });

            } catch (err) {
                console.error("Gemini/TTS Error:", err.message);
                // Send a structured error back to the client
                ws.send(JSON.stringify({ error: "Sorry, a server error occurred after transcribing." }));
                ws.close(1011, "Server processing error.");
            }
        }
    });

    // --- 6. Connection and Error Handling ---
    ws.on('close', () => {
        console.log('WebSocket client disconnected.');
        if (sonioxStream && sonioxStream.writable) {
            sonioxStream.end();
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket Error:', err.message);
        if (sonioxStream && sonioxStream.writable) {
            sonioxStream.end();
        }
    });

    sonioxStream.on('error', (err) => {
        console.error('Soniox Stream Error:', err.message);
        ws.send(JSON.stringify({ error: "Speech service error." }));
        ws.close(1011, "Soniox stream error.");
    });
});


// ---------------- HTTP route (for a fallback or simple text input) (Original logic) ----------------
app.post("/speak", async (req, res) => {
    try {
        const { text, targetLangCode = 'en' } = req.body;
        if (!text) {
            return res.status(400).json({ error: "No text provided" });
        }

        const ttsVoiceConfig = VOICE_MAP[targetLangCode] || VOICE_MAP['en'];

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction: `Respond ONLY in the language specified by the language code: ${targetLangCode}` });
        
        let result;
        
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                result = await model.generateContent(text);
                break; 
            } catch (error) {
                console.warn(`Gemini generation failed (Attempt ${attempt + 1}/${MAX_RETRIES}). Retrying...`);
                if (attempt === MAX_RETRIES - 1) {
                    throw error; 
                }
                const backoffTime = Math.pow(2, attempt) * 1000; 
                await delay(backoffTime);
            }
        }

        if (!result) {
            return res.status(500).json({ error: "Gemini did not provide a response after all retries" });
        }
        
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