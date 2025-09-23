import readline from "readline";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import say from "say";

dotenv.config();

// ----------------- Gemini Client -----------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("❌ Gemini API key missing.");
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ----------------- Readline setup -----------------
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Keep conversation in memory
let conversationHistory = [];

console.log("🎤 Gemini Terminal Chat (type 'exit' to quit)");

function ask() {
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
        contents: conversationHistory.map(m => m.content),
      });

      if (!resp || !resp.text) throw new Error("No response from Gemini");

      const geminiText = resp.text;

      // Add Gemini response to conversation
      conversationHistory.push({ role: "assistant", content: geminiText });

      // Speak Gemini response locally (male voice)
      // Windows: "David", macOS: "Alex"
      say.speak(geminiText, "David", 1.0);

      // Print Gemini text
      console.log("Gemini:", geminiText);

    } catch (err) {
      console.error("Error:", err.message);
    }

    ask(); // loop
  });
}

ask();
