import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { SpeechClient } from '@soniox/soniox-node';
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
// IMPORTANT: We only parse JSON for standard routes. 
app.use(express.json()); 

const PORT = process.env.PORT || 3000;

// Helper function for exponential backoff delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const MAX_RETRIES = 3;

// ---------------- 1. Multilingual Voice Map ----------------
const VOICE_MAP = {
    // Note: TTS will respond in the language of the voice name's prefix (e.g., en-US, es-ES)
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
    console.error("❌ API Keys missing! Check your environment variables (GEMINI_API_KEY, SONIOX_API_KEY).");
    // process.exit(1); // Uncomment this line if you want the server to fail without keys
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const ttsClient = new TextToSpeechClient();
const sonioxClient = new SpeechClient({ api_key: SONIOX_API_KEY });


// ---------------- STATIC FILE SERVING ----------------
app.use(express.static(__dirname)); 

// ---------------- Root route ----------------
app.get("/", (req, res) => {
    // Assuming 'he.html' is your web UI file
    res.sendFile(path.join(__dirname, 'he.html')); 
});


// ---------------- FINAL ROUTE: Handles RAW WAV data from Unity and Web UI ----------------
// We use express.raw() middleware specifically for this route, expecting audio/wav
app.post("/process-raw-audio", express.raw({ type: 'audio/wav', limit: '5mb' }), async (req, res) => {
    
    // ⭐ FIX: Read target language from query params instead of body
    let targetLangCode = req.query.targetLangCode;
    // Validate and default the language code
    if (!VOICE_MAP[targetLangCode]) {
        targetLangCode = 'en'; 
    }
    
    let spokenLangCode = 'en'; // Spoken language code detected by Soniox

    // Check if the request body contains raw audio data
    if (!req.body || req.header('Content-Type') !== 'audio/wav') {
        return res.status(400).json({ error: "Invalid request: Expected raw audio/wav data with Content-Type: audio/wav." });
    }

    const audioBuffer = req.body;
    const tempFileName = `audio_${Date.now()}.wav`;
    // Use the /tmp directory in production for better cleanup/security (for local, ensure 'uploads' exists)
    const uploadDir = path.join(__dirname, 'uploads');
    const audioFilePath = path.join(uploadDir, tempFileName);
    
    try {
        // Ensure the uploads directory exists
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }

        // 1. SAVE RAW AUDIO BUFFER TO TEMP FILE
        await fs.promises.writeFile(audioFilePath, audioBuffer);

        console.log(`Received raw audio (size: ${audioBuffer.length} bytes). Target response language: ${targetLangCode}. Processing...`);
        
        // 2. TRANSCRIBE WITH SONIOX 
        // Note: Using a general model that supports English detection
        const sonioxModel = "en_v2"; 
        
        const result = await sonioxClient.transcribeFileShort(
            audioFilePath,
            { model: sonioxModel }
        );

        // 3. EXTRACT TRANSCRIPT AND DETECTED LANGUAGE
        let transcribedText = "";
        
        // Basic word extraction and language detection (if available on the first word)
        transcribedText = result.words.map(word => {
            if (word.language && spokenLangCode === 'en') {
                spokenLangCode = word.language; 
            }
            return word.text;
        }).join("").replace(/(\s+)([.,?!;])/g, '$2').trim(); // Basic cleanup

        
        console.log(`Final Transcription (Spoken in ${spokenLangCode}): "${transcribedText}"`);
        
        // --- CLEANUP: Delete temporary file ---
        if (fs.existsSync(audioFilePath)) {
            fs.unlinkSync(audioFilePath);
        }

        if (transcribedText.length === 0) {
            return res.status(400).json({ 
                error: "Could not transcribe audio. Text is empty.",
                transcribedText: "",
                assistantResponse: "I'm sorry, I couldn't understand what you said. Please try again."
            });
        }

        // 4. CONSTRUCT PROMPT AND GET GEMINI RESPONSE
        const ttsVoiceConfig = VOICE_MAP[targetLangCode]; 
        
        const systemInstruction = `You are a helpful and friendly virtual assistant.
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

        let geminiTextResponse = geminiResult.response.text().trim();
        // Remove code block wrappers if Gemini sometimes includes them
        if (geminiTextResponse.startsWith('```') && geminiTextResponse.endsWith('```')) {
            geminiTextResponse = geminiTextResponse.split('\n').slice(1, -1).join('\n').trim();
        }

        if (!geminiTextResponse) {
            return res.status(500).json({ error: "Gemini did not provide a response" });
        }
        
        console.log(`Gemini Response (in ${targetLangCode}): "${geminiTextResponse}"`);

        // 5. SYNTHESIZE SPEECH (Audio format set to MP3, as it is smaller)
        const [ttsResponse] = await ttsClient.synthesizeSpeech({
            input: { text: geminiTextResponse },
            voice: ttsVoiceConfig,
            audioConfig: { audioEncoding: 'MP3' },
        });
        
        // ⭐ 6. ENCODE AUDIO AND SEND STRUCTURED JSON RESPONSE
        const audioBufferResponse = ttsResponse.audioContent;
        const audioBase64 = audioBufferResponse.toString('base64');


        // Send structured JSON response back to the client (Unity/Web)
        res.json({
            transcribedText: transcribedText,
            assistantResponse: geminiTextResponse,
            audioBase64: audioBase64 // MP3 data
        });

    } catch (err) {
        const errorMessage = err.message || "Failed to process audio file";
        console.error("API error in /process-raw-audio:", errorMessage);
        
        // --- CLEANUP ON ERROR ---
        if (fs.existsSync(audioFilePath)) {
            fs.unlinkSync(audioFilePath);
        }
        
        // Send a detailed error response
        res.status(500).json({
            error: "Failed to process audio file",
            details: errorMessage
        });
    }
});


// ------ ---------- Start server ----------------
app.listen(PORT, () => {
    console.log(`✅ Anshu backend running on http://localhost:${PORT}`);
});