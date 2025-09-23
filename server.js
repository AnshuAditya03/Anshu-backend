import readline from "readline";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import sound from "sound-play";

// ---------------- Load .env only locally ----------------
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------- Gemini Client -----------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("❌ Gemini API key missing.");
  process.exit(1);
}
const ai = new GoogleGenerativeAI(GEMINI_API_KEY);

// ----------------- Google Cloud TTS Client -----------------
const ttsClient = new TextToSpeechClient();

// ----------------- Readline setup -----------------
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Keep conversation in memory
let conversationHistory = [];
let isChatting = false; // State flag to manage the conversation

console.log("🎤 Gemini Terminal Chat (type 'exit' to quit)");
console.log("To begin a conversation, type 'chat with gemini'.");

async function ask() {
  rl.question("You: ", async (userText) => {
    if (userText.toLowerCase() === "exit") {
      console.log("Exiting...");
      rl.close();
      return;
    }

    // If chat is not active, check for the start command
    if (!isChatting) {
      if (userText.toLowerCase() === "chat with gemini") {
        isChatting = true;
        console.log("✅ Chat mode enabled. What's on your mind?");
      } else {
        console.log("Please say 'chat with gemini' to begin a conversation.");
      }
      ask(); // loop back to the next question
      return;
    }

    // Normal conversation logic when isChatting is true
    conversationHistory.push({ role: "user", content: userText });

    try {
      // ----------------- Gemini API Call -----------------
      const resp = await ai.getGenerativeModel({
        model: "gemini-2.5-flash",
      }).generateContentStream({
        contents: conversationHistory,
      });

      let geminiText = "";
      for await (const chunk of resp.stream) {
        geminiText += chunk.text;
      }
      
      if (!geminiText) throw new Error("No response from Gemini");

      conversationHistory.push({ role: "assistant", content: geminiText });

      // ----------------- Google Cloud TTS Call with SSML -----------------
      console.log("Generating audio with Google Cloud TTS...");

      const ssmlText = `<speak><prosody rate="medium">${geminiText}</prosody></speak>`;

      const [response] = await ttsClient.synthesizeSpeech({
        input: { ssml: ssmlText },
        voice: {
          languageCode: "en-US",
          name: "en-US-Neural2-A",
          ssmlGender: "MALE",
        },
        audioConfig: { audioEncoding: "MP3" },
      });

      const timestamp = new Date().getTime();
      const outputFilename = `gemini_response_${timestamp}.mp3`;
      const outputPath = path.join(__dirname, outputFilename);

      fs.writeFileSync(outputPath, response.audioContent, 'binary');
      console.log(`✅ Audio content saved to '${outputFilename}'`);

      await sound.play(outputPath);
      console.log("🎶 Playing audio...");
      console.log("Gemini:", geminiText);
      fs.unlinkSync(outputPath); // Clean up temporary file
      
    } catch (err) {
      console.error("Error:", err.message);
    }
    
    ask(); // loop back
  });
}

ask();