import fs from "fs";
import fetch from "node-fetch";

(async () => {
    try {
        const response = await fetch("https://anshu-backend-xidp.onrender.com/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: "Hello Anshu, this is a test Gemini voice!" })
        });

        if (!response.ok) {
            console.error("Backend returned error:", response.status, await response.text());
            return;
        }

        const data = await response.json();
        if (!data.audio) {
            console.error("No audio received from backend.");
            return;
        }

        // Convert base64 to binary
        const audioBuffer = Buffer.from(data.audio, "base64");

        // Save as mp3
        fs.writeFileSync("geminiTest.mp3", audioBuffer);
        console.log("✅ Audio saved as geminiTest.mp3. Play it to verify!");
        
    } catch (err) {
        console.error("Error:", err);
    }
})();
