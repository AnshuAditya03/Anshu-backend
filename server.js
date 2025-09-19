// ---------------- Load .env only locally ----------------
if (process.env.NODE_ENV !== "production") {
    const path = require('path');
    require('dotenv').config({ path: path.resolve(__dirname, '.env') });
}

const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors'); // You'll need this for cross-origin requests from Unity
const dns = require('dns');

// Force IPv4 to avoid network issues, which can sometimes occur on hosting platforms
dns.setDefaultResultOrder('ipv4first');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// --- Gemini API Integration ---
// Access the Gemini API key from environment variables
const geminiApiKey = process.env.GEMINI_API_KEY; 

if (!geminiApiKey) {
    console.error("❌ GEMINI_API_KEY is not set. The server will not run.");
    if (process.env.NODE_ENV === "production") {
        // Exit the process with an error code to make Render report the failure
        console.error("Exiting due to missing API key in production environment.");
        process.exit(1); 
    }
} else {
    // Log a partial key to confirm it's loaded without exposing the full secret
    console.log("✅ Gemini API key loaded. Key starts with:", geminiApiKey.substring(0, 5));
    console.log("✅ Server PORT is set to:", PORT);
}

const genAI = new GoogleGenerativeAI(geminiApiKey);
// Using Gemini 2.5 Flash for the conversational part
const flashModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
// Using the TTS model for voice output
const ttsModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-tts" });

// ---------------- Root route for sanity check ----------------
// This route now also confirms that the Gemini models are configured
app.get("/", (req, res) => {
    res.send("✅ Anshu Backend running. Gemini models are ready.");
});

// ---------------- Text-to-Speech endpoint using Gemini ----------------
// This is the new endpoint that your Unity app will call
app.post('/api/gemini-voice', async (req, res) => {
    try {
        const userPrompt = req.body.prompt;
        if (!userPrompt) {
            return res.status(400).send({ error: "Missing 'prompt' in request body." });
        }
        
        console.log("Gemini request received:", userPrompt);

        // 1. Get a text response from the Gemini Flash model
        const textResponse = await flashModel.generateContent({ contents: [{ parts: [{ text: userPrompt }] }] });
        const assistantText = textResponse.response.text();

        // 2. Get an audio response from the Gemini TTS model
        const audioResponse = await ttsModel.generateContent({
            contents: [{ parts: [{ text: assistantText }] }],
            generationConfig: {
                response_modalities: ['AUDIO'],
            },
        });
        
        // 3. Send the audio data back to your Unity app
        const audioData = audioResponse.candidates[0].parts[0].inline_data.data;
        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(audioData);

    } catch (error) {
        console.error('API call failed:', error);
        res.status(500).send({ error: 'Failed to process request.' });
    }
});

// ---------------- Start server ----------------
app.listen(PORT, () => {
    console.log(`✅ Anshu backend running on http://localhost:${PORT}`);
});
