import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { SpeechClient } from '@soniox/soniox-node';
import multer from 'multer'; // Import multer for file uploads
import fs from 'fs'; // Node.js file system module

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env only locally
if (process.env.NODE_ENV !== "production") {
    dotenv.config({ path: path.resolve(__dirname, '.env') });
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ---------------- Init Clients ----------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SONIOX_API_KEY = process.env.SONIOX_API_KEY;

if (!GEMINI_API_KEY) {
    console.error("❌ Gemini API Key missing! Check your environment variables.");
    if (process.env.NODE_ENV === "production") process.exit(1);
}

if (!SONIOX_API_KEY) {
    console.error("❌ Soniox API Key missing! Check your environment variables.");
    if (process.env.NODE_ENV === "production") process.exit(1);
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

// ---------------- HTTP route for file transcription ----------------
app.post("/transcribe-file", upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No audio file provided" });
        }

        const audioFilePath = req.file.path;
        console.log(`Received audio file at: ${audioFilePath}`);

        // Transcribe the audio file using Soniox's file transcription method
        const result = await sonioxClient.transcribeFileShort(
            audioFilePath,
            { model: "en_v2" } // Use an appropriate model
        );

        // --- FIX FOR SPACING ISSUE STARTS HERE ---
        const rawText = result.words.map(word => word.text).join(" ");
        
        // 1. Compress multiple spaces into a single space, and then remove leading/trailing spaces
        let transcribedText = rawText.replace(/\s+/g, ' ').trim(); 

        // 2. Remove spaces immediately before punctuation marks (.,?!;)
        transcribedText = transcribedText.replace(/\s+([.,?!;])/g, '$1');
        // --- FIX FOR SPACING ISSUE ENDS HERE ---

        console.log("Final Transcription:", transcribedText);
        
        // Clean up the temporary file
        fs.unlinkSync(audioFilePath);

        if (transcribedText.trim().length === 0) {
            return res.status(400).json({ error: "Could not transcribe audio. Text is empty." });
        }

        // Now, pass the transcribed text to your existing Gemini/TTS pipeline
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const geminiResult = await model.generateContent(transcribedText);
        const geminiTextResponse = geminiResult.response.text();

        if (!geminiTextResponse) {
            return res.status(500).json({ error: "Gemini did not provide a response" });
        }

        const [ttsResponse] = await ttsClient.synthesizeSpeech({
            input: { text: geminiTextResponse },
            // UPDATED VOICE CONFIGURATION: Neural D Male
            voice: { languageCode: 'en-US', name: 'en-US-Neural2-D' }, 
            audioConfig: { audioEncoding: 'MP3' },
        });

        res.set("Content-Type", "audio/mpeg");
        res.send(ttsResponse.audioContent);

    } catch (err) {
        console.error("API error:", err.message || err);
        res.status(500).json({
            error: "Failed to process audio file",
            details: err.message
        });
    }
});

// ---------------- HTTP route (for a fallback or simple text input) ----------------
app.post("/speak", async (req, res) => {
    // This route remains the same for simple text-to-speech without STT
    try {
        const { text } = req.body;
        if (!text) {
            return res.status(400).json({ error: "No text provided" });
        }

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(text);
        const geminiTextResponse = result.response.text();

        if (!geminiTextResponse) {
            return res.status(500).json({ error: "Gemini did not provide a response" });
        }

        const [ttsResponse] = await ttsClient.synthesizeSpeech({
            input: { text: geminiTextResponse },
            // UPDATED VOICE CONFIGURATION: Neural D Male
            voice: { languageCode: 'en-US', name: 'en-US-Neural2-D' },
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