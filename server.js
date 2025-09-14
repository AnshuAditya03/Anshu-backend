// ---------------- Load .env only locally ----------------
if (process.env.NODE_ENV !== "production") {
    const path = require('path');
    require('dotenv').config({ path: path.resolve(__dirname, '.env') });
}

const express = require('express');
const axios = require('axios');
const dns = require('dns');

// Force IPv4 to avoid network issues
dns.setDefaultResultOrder('ipv4first');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------- Debug: Check if env variables are loaded ----------------
console.log('VOICE_ID:', process.env.VOICE_ID);
console.log('API_KEY:', process.env.ELEVENLABS_API_KEY);

// Use environment variables
const voiceId = process.env.VOICE_ID;
const apiKey = process.env.ELEVENLABS_API_KEY;

if (!voiceId || !apiKey) {
    console.error("❌ API Key or Voice ID missing! Check your environment variables.");
    if (process.env.NODE_ENV === "production") {
        process.exit(1); // stop server on Render if missing
    }
}

// ---------------- Root route for sanity check ----------------
app.get("/", (req, res) => {
    res.send("✅ Anshu Backend running. Use /speak?text=YOUR_TEXT to generate voice.");
});

// ---------------- Text-to-Speech endpoint ----------------
app.get("/speak", async (req, res) => {
    try {
        const text = req.query.text;
        if (!text) return res.status(400).json({ error: "No text provided" });

        console.log("TTS request received:", text);

        // Request ElevenLabs TTS
        const response = await axios({
            method: 'post',
            url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            data: { text, model_id: "eleven_multilingual_v2" },
            headers: {
                "xi-api-key": apiKey,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
            responseType: 'arraybuffer' // buffer audio for Unity
        });

        // Set headers for Unity audio playback
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Cache-Control", "no-cache");

        // Send audio directly
        res.send(Buffer.from(response.data, 'binary'));

    } catch (err) {
        if (err.response) {
            console.error("ElevenLabs error data:", err.response.data);
            console.error("ElevenLabs status:", err.response.status);
        } else {
            console.error("Other error:", err.message);
        }
        res.status(500).json({
            error: "Failed to generate speech",
            details: err.response ? err.response.data : err.message
        });
    }
});

// ---------------- Start server ----------------
app.listen(PORT, () => {
    console.log(`✅ Anshu backend running on http://localhost:${PORT}`);
});
