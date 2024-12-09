// Popup script for the audio transcription extension
let audioContext = null;
let stream = null;
let mediaRecorder = null;
let transcriptText = '';

async function getTabAudio() {
    // Query for the active tab
    const [tab] = await chrome.tabs.query({ 
        active: true, 
        currentWindow: true
    });
    
    if (!tab) {
        throw new Error('No active tab found');
    }

    // Capture tab audio
    return new Promise((resolve, reject) => {
        chrome.tabCapture.capture({
            audio: true,
            video: false,
            audioConstraints: {
                mandatory: {
                    chromeMediaSource: 'tab'
                }
            }
        }, stream => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(stream);
        });
    });
}

function updateStatus(message, type = 'info') {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = type;
}

function updateTranscript(text) {
    const preview = document.getElementById('transcriptPreview');
    preview.textContent = text;
    transcriptText = text;
}

function downloadTranscript() {
    const blob = new Blob([transcriptText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${new Date().toISOString()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

async function cleanup() {
    if (audioContext) {
        await audioContext.close();
        audioContext = null;
    }
    
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder = null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const downloadBtn = document.getElementById('downloadBtn');

    startBtn.addEventListener('click', async () => {
        try {
            // Get tab audio stream
            stream = await getTabAudio();
            
            // Create audio context
            audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(stream);
            const destination = audioContext.createMediaStreamDestination();
            source.connect(destination);

            // Create media recorder
            mediaRecorder = new MediaRecorder(destination.stream);
            let audioChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                updateStatus('Processing audio...', 'info');
                
                try {
                    // Upload the audio file
                    const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
                        method: 'POST',
                        headers: {
                            'Authorization': config.ASSEMBLY_AI_KEY
                        },
                        body: audioBlob
                    });
                    
                    if (!uploadResponse.ok) {
                        throw new Error('Upload failed: ' + await uploadResponse.text());
                    }
                    
                    const { upload_url } = await uploadResponse.json();
                    updateStatus('Audio uploaded, starting transcription...', 'info');
                    
                    // Start transcription
                    const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
                        method: 'POST',
                        headers: {
                            'Authorization': config.ASSEMBLY_AI_KEY,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            audio_url: upload_url,
                            language_code: 'en'
                        })
                    });
                    
                    if (!transcriptResponse.ok) {
                        throw new Error('Transcription request failed: ' + await transcriptResponse.text());
                    }
                    
                    const { id } = await transcriptResponse.json();
                    updateStatus('Transcribing...', 'info');
                    
                    // Poll for completion
                    let transcript;
                    while (!transcript) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        const pollResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
                            headers: {
                                'Authorization': config.ASSEMBLY_AI_KEY
                            }
                        });
                        
                        if (!pollResponse.ok) {
                            throw new Error('Polling failed: ' + await pollResponse.text());
                        }
                        
                        const result = await pollResponse.json();
                        
                        if (result.status === 'completed') {
                            updateTranscript(result.text);
                            transcript = result.text;
                            updateStatus('Transcription completed!', 'success');
                            downloadBtn.classList.remove('hidden');
                        } else if (result.status === 'error') {
                            throw new Error(result.error);
                        } else {
                            updateStatus(`Transcribing... (${result.status})`, 'info');
                        }
                    }

                } catch (error) {
                    console.error('Transcription error:', error);
                    updateStatus(`Error: ${error.message}`, 'error');
                }
            };

            // Start recording
            mediaRecorder.start(1000);
            startBtn.disabled = true;
            stopBtn.disabled = false;
            downloadBtn.classList.add('hidden');
            updateStatus('Recording in progress...', 'success');
        } catch (error) {
            console.error('Start recording error:', error);
            updateStatus(`Error: ${error.message}`, 'error');
            await cleanup();
        }
    });

    stopBtn.addEventListener('click', async () => {
        await cleanup();
        startBtn.disabled = false;
        stopBtn.disabled = true;
        downloadBtn.classList.remove('hidden');
        updateStatus('Recording stopped', 'info');
    });

    downloadBtn.addEventListener('click', downloadTranscript);
});