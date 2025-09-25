import readline from "readline";
import { GoogleGenerativeAI } from "@google/generative-ai";
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
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ----------------- Google Cloud TTS Client -----------------
const ttsClient = new TextToSpeechClient();

// ----------------- Readline setup -----------------
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Keep conversation in memory
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
const chat = model.startChat({
  history: [],
});

console.log("🎤 Gemini Terminal Chat (type 'exit' to quit)");

async function ask() {
  rl.question("You: ", async (userText) => {
    if (userText.toLowerCase() === "exit") {
      console.log("Exiting...");
      rl.close();
      return;
    }

    try {
      // Generate response from Gemini using the chat session
      const result = await chat.sendMessage(userText);
      const geminiText = result.response.text();

      if (!geminiText) throw new Error("No response from Gemini");

      // ----------------- Google Cloud TTS Call with SSML -----------------
      console.log("Generating audio with Google Cloud TTS...");
      
      const ssmlText = `<speak><prosody rate="medium">${geminiText}</prosody></speak>`;

      const [response] = await ttsClient.synthesizeSpeech({
        input: { ssml: ssmlText },
        voice: {
          languageCode: "en-US",
          name: "en-US-Neural2-J", // Using a professional, clear voice
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