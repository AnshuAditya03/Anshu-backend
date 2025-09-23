import readline from "readline";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs"; // Import the file system module
import { TextToSpeechClient } from "@google-cloud/text-to-speech"; // Import Google Cloud TTS

dotenv.config();

// ----------------- Gemini Client -----------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("❌ Gemini API key missing.");
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ----------------- Google Cloud TTS Client -----------------
// The client will automatically use the credentials from the
// GOOGLE_APPLICATION_CREDENTIALS environment variable
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

    // Add user message to conversation
    conversationHistory.push({ role: "user", content: userText });

    try {
      // Generate Gemini response (send full conversation for context)
      const resp = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: conversationHistory.map(m => ({ text: m.content })),
      });

      if (!resp || !resp.text) throw new Error("No response from Gemini");

      const geminiText = resp.text;

      // Add Gemini response to conversation
      conversationHistory.push({ role: "assistant", content: geminiText });

      // ----------------- Google Cloud TTS Call -----------------
      console.log("Generating audio with Google Cloud TTS...");
      
      const [response] = await ttsClient.synthesizeSpeech({
        input: { text: geminiText },
        voice: { languageCode: "en-US", ssmlGender: "NEUTRAL" }, // Use a standard voice
        audioConfig: { audioEncoding: "MP3" },
      });

      // Define the filename and save the audio content to a file
      const outputFilename = "gemini_response.mp3";
      fs.writeFileSync(outputFilename, response.audioContent);
      console.log(`✅ Audio content saved to '${outputFilename}'`);
      
      // Print Gemini text to the console
      console.log("Gemini:", geminiText);

    } catch (err) {
      console.error("Error:", err.message);
    }

    ask(); // loop
  });
}

ask();
