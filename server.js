import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
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

// ---------------- Init Gemini Client ----------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error("❌ Gemini API Key missing! Check your environment variables.");
    if (process.env.NODE_ENV === "production") process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ---------------- Root route ----------------
app.get("/", (req, res) => {
    res.send("✅ Anshu Backend running. Use POST /speak with JSON { text: '...' }");
});

// ---------------- Text-to-Speech endpoint ----------------
app.post("/speak", async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: "No text provided" });

        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            generationConfig: {
                audioConfig: { voice: "Puck" }
            }
        });

        const result = await model.generateContent(text);
        const audioData = result.response.candidates[0].content[0].audio.data;

        res.json({ audio: audioData });

    } catch (err) {
        console.error("Gemini error:", err.message || err);
        res.status(500).json({ error: "Failed to generate speech", details: err.message });
    }
});

// ---------------- Start server ----------------
app.listen(PORT, () => {
    console.log(`✅ Anshu backend running on http://localhost:${PORT}`);
});