import readline from "readline";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import sound from "sound-play";

dotenv.config();

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------- Gemini Client -----------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("❌ Gemini API key missing.");
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ----------------- Google Cloud TTS Client -----------------
const ttsClient = new TextToSpeechClient();

// ----------------- Readline setup -----------------
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Keep conversation in memory
let conversationHistory = [];

console.log("🎤 Gemini Terminal Chat (type 'exit' to quit)");

async function ask() {
  rl.question("You: ", async (userText) => {
    if (userText.toLowerCase() === "exit") {
      console.log("Exiting...");
      rl.close();
      return;
    }

    conversationHistory.push({ role: "user", content: userText });

    try {
      const resp = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: conversationHistory.map(m => ({ text: m.content })),
      });

      if (!resp || !resp.text) throw new Error("No response from Gemini");

      const geminiText = resp.text;

      conversationHistory.push({ role: "assistant", content: geminiText });

      // ----------------- Google Cloud TTS Call with SSML -----------------
      console.log("Generating audio with Google Cloud TTS...");
      
      // Wrap the Gemini text in SSML to adjust the speaking rate for a more natural feel.
      const ssmlText = `<speak><prosody rate="medium">${geminiText}</prosody></speak>`;

      const [response] = await ttsClient.synthesizeSpeech({
        input: { ssml: ssmlText },
        voice: {
          languageCode: "en-US",
          name: "en-US-Neural2-A", // Using a professional, clear voice
          ssmlGender: "MALE"
        },
        audioConfig: { audioEncoding: "MP3" },
      });
      
      const timestamp = new Date().getTime();
      const outputFilename = `gemini_response_${timestamp}.mp3`;
      const outputPath = path.join(__dirname, outputFilename);

      fs.writeFileSync(outputPath, response.audioContent);
      console.log(`✅ Audio content saved to '${outputFilename}'`);

      await sound.play(outputPath);
      console.log("🎶 Playing audio...");

      console.log("Gemini:", geminiText);

    } catch (err) {
      console.error("Error:", err.message);
    }

    ask(); // loop
  });
}

ask();
