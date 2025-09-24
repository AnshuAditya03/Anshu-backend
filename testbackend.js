import axios from 'axios';

// Replace with your actual Render URL
const RENDER_URL = "https://anshu-backend-xidp.onrender.com";

async function testBackend() {
    try {
        const response = await axios.post(`${RENDER_URL}/speak`, {
            text: "Hello, my name is Anshu. Can you tell me about the project?"
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log("✅ Success! Backend responded with audio data.");
        // The audio data is a long Base64 string, so we'll just show a part of it.
        console.log("Audio data preview:", response.data.audio.substring(0, 50), "...");

    } catch (error) {
        console.error("❌ Failed to get a response from the backend.");
        console.error("Error details:", error.response ? error.response.data : error.message);
    }
}

testBackend();