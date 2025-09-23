import readline from "readline";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { spawn } from "child_process";
import path from "path";
import player from "play-sound";
import { fileURLToPath } from "url";

// ---------- Fix for __dirname in ES modules ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Load environment ----------
dotenv.config();

// ---------- Gemini Client ----------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("❌ Gemini API key missing.");
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ---------- Readline setup ----------
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let conversationHistory = [];
console.log("🎤 Gemini Terminal Chat (type 'exit' to quit)");

// Audio player
const audioPlayer = player({});

// ---------- Function to speak using female TTS ----------
function speakFemale(text) {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, "livevoice.py");

    const py = spawn("python", [pythonScript, text]);

    py.stdout.on("data", (data) => {
      console.log(data.toString());
    });

    py.stderr.on("data", (data) => {
      console.error("Python error:", data.toString());
    });

    py.on("close", (code) => {
      if (code === 0) {
        audioPlayer.play("female_test.wav", (err) => {
          if (err) console.error("Audio play error:", err);
          resolve();
        });
      } else {
        reject(new Error(`Python TTS exited with code ${code}`));
      }
    });
  });
}

// ---------- Ask loop ----------
function ask() {
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
        contents: conversationHistory.map(m => m.content),
      });

      if (!resp || !resp.text) throw new Error("No response from Gemini");
      const geminiText = resp.text;

      conversationHistory.push({ role: "assistant", content: geminiText });
      console.log("Gemini:", geminiText);

      // Speak the reply with Coqui TTS
      await speakFemale(geminiText);

    } catch (err) {
      console.error("Error:", err.message);
    }

    ask(); // loop
  });
}

ask();
