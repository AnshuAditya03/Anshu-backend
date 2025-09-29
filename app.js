// app.js

const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const uploadButton = document.getElementById('uploadButton');
const audioFileInput = document.getElementById('audioFile');
const statusText = document.getElementById('status');
const audioPlayback = document.getElementById('audioPlayback');

let mediaRecorder;
let audioChunks = [];

// Helper functions for writing WAV header
function setUint32(view, offset, data) {
    view.setUint32(offset, data, true);
}

function setUint16(view, offset, data) {
    view.setUint16(offset, data, true);
}


// Helper function to convert a Blob to WAV format
function convertBlobToWav(blob) {
    return new Promise((resolve) => {
        const audioContext = new AudioContext();
        const reader = new FileReader();
        reader.onload = (event) => {
            audioContext.decodeAudioData(event.target.result).then(audioBuffer => {
                const wavBlob = bufferToWav(audioBuffer);
                resolve(wavBlob);
            });
        };
        reader.readAsArrayBuffer(blob);
    });
}

function bufferToWav(abuffer) {
    const numOfChan = abuffer.numberOfChannels;
    const length = abuffer.length * numOfChan * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    const channels = [];
    let offset = 0;
    let pos = 0;

    // write WAVE header
    setUint32(view, offset, 0x46464952);                         // "RIFF"
    offset += 4;
    setUint32(view, offset, length - 8);                         // file length - 8
    offset += 4;
    setUint32(view, offset, 0x45564157);                         // "WAVE"
    offset += 4;

    setUint32(view, offset, 0x20746d66);                         // "fmt " chunk
    offset += 4;
    setUint32(view, offset, 16);                                 // length = 16
    offset += 4;
    setUint16(view, offset, 1);                                  // PCM (uncompressed)
    offset += 2;
    setUint16(view, offset, numOfChan);
    offset += 2;
    setUint32(view, offset, abuffer.sampleRate);
    offset += 4;
    setUint32(view, offset, abuffer.sampleRate * numOfChan * 2); // avg. bytes/sec
    offset += 4;
    setUint16(view, offset, numOfChan * 2);                      // block-align
    offset += 2;
    setUint16(view, offset, 16);                                 // 16-bit
    offset += 2;
    setUint32(view, offset, 0x61746164);                         // "data" chunk
    offset += 4;
    setUint32(view, offset, length - offset - 4);                // chunk length
    offset += 4;


    // write interleaved samples
    for (let i = 0; i < abuffer.numberOfChannels; i++) {
        channels.push(abuffer.getChannelData(i));
    }
    
    while(pos < abuffer.length) {
        for (let i = 0; i < numOfChan; i++) {
            let sample = Math.max(-1, Math.min(1, channels[i][pos]));
            sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF) | 0;
            view.setInt16(offset, sample, true);
            offset += 2;
        }
        pos++;
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            
            // Convert the recorded audio to WAV format
            const wavBlob = await convertBlobToWav(audioBlob);

            const formData = new FormData();
            formData.append('audio', wavBlob, 'recording.wav');
            
            await sendAudioToBackend(formData);

            audioChunks = [];
            startButton.style.display = 'inline-block';
            stopButton.style.display = 'none';
        };

        mediaRecorder.start();
        statusText.textContent = "🎙️ Recording... Press 'Stop Recording' to end.";
        startButton.style.display = 'none';
        stopButton.style.display = 'inline-block';
    } catch (err) {
        console.error('Error accessing microphone:', err);
        statusText.textContent = "🚫 Error: Microphone access denied.";
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}

async function uploadAudioFile() {
    const file = audioFileInput.files[0];
    if (!file) {
        alert("Please select an audio file first.");
        return;
    }

    const formData = new FormData();
    formData.append('audio', file, file.name);

    await sendAudioToBackend(formData);
}

async function sendAudioToBackend(formData) {
    try {
        statusText.textContent = "Processing response...";
        
        const response = await fetch('http://localhost:3000/transcribe-file', {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error);
        }

        const audioData = await response.blob();
        const audioUrl = URL.createObjectURL(audioData);
        audioPlayback.src = audioUrl;
        audioPlayback.play();
        statusText.textContent = "🗣️ AI is speaking...";

    } catch (err) {
        console.error("Error sending audio to backend:", err);
        statusText.textContent = "🚫 An error occurred. Please try again.";
    }
}

// ---------------- Event Listeners ----------------
startButton.addEventListener('click', startRecording);
stopButton.addEventListener('click', stopRecording);
uploadButton.addEventListener('click', uploadAudioFile);

// Initial status
statusText.textContent = "Press start to record, or choose a file to upload.";
