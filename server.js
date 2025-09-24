import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TextToSpeechClient } from '@google-cloud/text-to-speech'; // Import the Google Cloud TTS client
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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

if (!GEMINI_API_KEY) {
    console.error("❌ Gemini API Key missing! Check your environment variables.");
    if (process.env.NODE_ENV === "production") process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const ttsClient = new TextToSpeechClient(); // Initialize the TTS client

// ---------------- Root route ----------------
app.get("/", (req, res) => {
    res.send("✅ Anshu backend running. Use POST /speak with JSON { text: '...' }");
});

// ---------------- Text-to-Speech endpoint ----------------
app.post("/speak", async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) {
            return res.status(400).json({ error: "No text provided" });
        }

        // Step 1: Get a text response from Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" }); // "gemini-pro" is a valid model
        const result = await model.generateContent(text);
        const geminiTextResponse = result.response.text();

        if (!geminiTextResponse) {
            return res.status(500).json({ error: "Gemini did not provide a response" });
        }

        // Step 2: Use the Google Cloud TTS client to synthesize the audio
        const [ttsResponse] = await ttsClient.synthesizeSpeech({
            input: { text: geminiTextResponse },
            voice: { languageCode: 'en-US', ssmlGender: 'NEUTRAL' },
            audioConfig: { audioEncoding: 'MP3' },
        });

        // Step 3: Send the audio back to the client
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