import readline from "readline";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { spawn } from "child_process";
import path from "path";
import player from "play-sound";
import { fileURLToPath } from "url";

// ----- Path fixes for ES modules -----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----- Load environment -----
dotenv.config();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY missing in .env");
  process.exit(1);
}

// ----- Init Gemini -----
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ----- Init TTS server (Python) -----
const ttsScript = path.join(__dirname, "myserver.py");
const ttsProcess = spawn("python", [ttsScript]);

ttsProcess.stdout.once("data", () => {
  console.log("🔊 TTS engine loaded");
});

ttsProcess.stderr.on("data", (d) => {
  console.error("TTS error:", d.toString());
});

// ----- Function to send text to TTS -----
const audioPlayer = player({});
function speakFemale(text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ text }) + "\n";
    ttsProcess.stdin.write(payload, "utf8");

    const handle = (chunk) => {
      try {
        const res = JSON.parse(chunk.toString());
        if (res.ok) {
          audioPlayer.play("female_test.wav", (err) => {
            if (err) console.error("Audio play error:", err);
            resolve();
          });
        } else reject(new Error(res.error));
      } catch {
        // Ignore incomplete JSON (sometimes chunked)
      } finally {
        ttsProcess.stdout.off("data", handle);
      }
    };
    ttsProcess.stdout.on("data", handle);
  });
}

// ----- Chat loop -----
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let conversationHistory = [];

console.log("🎤 Gemini Terminal Chat (type 'exit' to quit)");

function ask() {
  rl.question("You: ", async (userText) => {
    if (userText.toLowerCase() === "exit") {
      console.log("👋 Exiting...");
      ttsProcess.stdin.write(JSON.stringify({ text: "__exit__" }) + "\n");
      ttsProcess.kill();
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

      // Speak instantly (no reload)
      await speakFemale(geminiText);

    } catch (err) {
      console.error("Error:", err.message);
    }

    ask();
  });
}

ask();
