// Popup script for the audio transcription extension
let audioContext = null;
let stream = null;
let mediaRecorder = null;
let transcriptText = '';

async function loadTabs() {
    const tabs = await chrome.tabs.query({
        audible: true  // Only show tabs that are playing audio
    });
    
    const select = document.getElementById('tabSelect');
    select.innerHTML = '<option value="">Select a tab to record</option>';
    
    tabs.forEach(tab => {
        const option = document.createElement('option');
        option.value = tab.id;
        // Show audio indicator if tab is playing sound
        const audioIndicator = tab.audible ? '🔊 ' : '';
        option.textContent = audioIndicator + tab.title.substring(0, 50) + 
                           (tab.title.length > 50 ? '...' : '');
        select.appendChild(option);
    });

    // Update status if no audio tabs are found
    if (tabs.length === 0) {
        updateStatus('No tabs playing audio found', 'info');
    }
}

async function summarizeText(text, retries = 3) {
    const models = [
        'mixtral-8x7b-32768',
        'llama2-70b-4096'
    ];

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const model = models[attempt % models.length];
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{
                        role: 'system',
                        content: 'You are a helpful assistant that summarizes text concisely.'
                    }, {
                        role: 'user',
                        content: `Please summarize this text in 2-3 sentences: ${text}`
                    }],
                    temperature: 0.3,
                    max_tokens: 1024
                })
            });

            if (response.status === 503) {
                console.warn(`API temporarily unavailable (attempt ${attempt + 1}/${retries})`);
                await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                continue;
            }

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            return data.choices[0].message.content;
        } catch (error) {
            if (attempt === retries - 1) {
                throw new Error(`Summarization failed: ${error.message}`);
            }
            console.warn(`Attempt ${attempt + 1} failed, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
}

async function getTabAudio() {
    const tabSelect = document.getElementById('tabSelect');
    const selectedTabId = parseInt(tabSelect.value);
    
    if (!selectedTabId) {
        throw new Error('No tab selected');
    }

    try {
        // Get tab info first
        const tab = await chrome.tabs.get(selectedTabId);
        
        // Check if it's a chrome:// page
        if (tab.url.startsWith('chrome://')) {
            throw new Error('Chrome system pages cannot be captured');
        }

        // Inject a content script to ensure activeTab permission
        await chrome.scripting.executeScript({
            target: { tabId: selectedTabId },
            function: () => {
                // This script does nothing but ensures we have permission
                return true;
            }
        });

        // Now capture the audio
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
    } catch (error) {
        throw new Error(`Failed to capture tab audio: ${error.message}`);
    }
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
    
    const summarizeBtn = document.getElementById('summarizeBtn');
    summarizeBtn.classList.remove('hidden');
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
    const summarizeBtn = document.getElementById('summarizeBtn');
    const tabSelect = document.getElementById('tabSelect');

    // Load tabs initially
    loadTabs();
    
    // Refresh tabs list when audio status changes
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.audible !== undefined) {
            loadTabs();
        }
    });

    // Enable start button when a tab is selected
    tabSelect.addEventListener('change', () => {
        startBtn.disabled = !tabSelect.value;
        if (tabSelect.value) {
            updateStatus('Ready to record selected tab', 'info');
        }
    });

    summarizeBtn.addEventListener('click', async () => {
        if (!transcriptText) {
            updateStatus('No text to summarize', 'error');
            return;
        }

        try {
            updateStatus('Generating summary...', 'info');
            const summary = await summarizeText(transcriptText);
            const summaryPreview = document.getElementById('summaryPreview');
            summaryPreview.textContent = summary;
            updateStatus('Summary generated!', 'success');
        } catch (error) {
            console.error('Summarization error:', error);
            updateStatus(`Error: ${error.message}`, 'error');
        }
    });

    startBtn.addEventListener('click', async () => {
        try {
            stream = await getTabAudio();
            
            audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(stream);
            const destination = audioContext.createMediaStreamDestination();
            source.connect(destination);

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
                    
                    // Poll for results
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