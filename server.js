// ---------------- Load .env only locally ---------------- 
if (process.env.NODE_ENV !== "production") {
    const path = require('path');
    require('dotenv').config({ path: path.resolve(__dirname, '.env') });
}

const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Gemini client
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ---------------- Debug: Check if env variables are loaded ----------------
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY);

if (!process.env.GEMINI_API_KEY) {
    console.error("❌ Gemini API Key missing! Check your environment variables.");
    if (process.env.NODE_ENV === "production") process.exit(1);
}

// ---------------- Init Gemini Client ----------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ---------------- Root route ----------------
app.get("/", (req, res) => {
    res.send("✅ Anshu Backend running. Use POST /speak with JSON { text: '...' }");
});

// ---------------- Text-to-Speech endpoint ----------------
app.post("/speak", async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: "No text provided" });

        console.log("TTS request received:", text);

        // Generate audio via Gemini 2.0 Flash
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            generationConfig: {
                audioConfig: { voice: "Puck" } // choose your voice
            }
        });

        const result = await model.generateContent(text);

        // Audio is base64-encoded
        const audioData = result.response.candidates[0].content[0].audio.data;

        // Send base64 audio directly to Unity
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
