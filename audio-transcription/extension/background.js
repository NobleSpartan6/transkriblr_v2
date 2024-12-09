// Initialize global state at the top level
const state = {
    isRecording: false,
    ws: null,
    transcriptChunks: new Map(),
    reconnectAttempts: 0,
    MAX_RECONNECT_ATTEMPTS: 5,
    activeTabId: null,
    currentTranscript: '',
    recordingStream: null,
    audioContext: null,
    mediaRecorder: null
};

// Message type constants
const MessageTypes = {
    INITIALIZE: 'initialize',
    CONNECTION: 'connection',
    TRANSCRIPT: 'transcript',
    ERROR: 'error',
    STATUS: 'status'
};

// Add this at the top of your background.js
if (!chrome.tabCapture) {
    console.error('tabCapture API not available');
}

// Define handleWebSocketMessage function first since it's used in initializeWebSocket
function handleWebSocketMessage(event) {
    try {
        const message = JSON.parse(event.data);
        console.log('Received WebSocket message:', message.type);

        switch (message.type) {
            case MessageTypes.INITIALIZE:
            case MessageTypes.CONNECTION:
                console.log('Connection status:', message.status || 'established');
                notifyClients({
                    type: 'status',
                    detail: 'WebSocket connection established'
                });
                break;

            case MessageTypes.TRANSCRIPT:
                if (message.text) {
                    state.transcriptChunks.set(message.chunkId, message.text);
                    notifyClients({
                        type: 'transcriptReady',
                        chunkId: message.chunkId,
                        text: message.text,
                        timestamp: message.timestamp
                    });
                }
                break;

            case MessageTypes.ERROR:
                console.error('Server error:', message.error);
                notifyClients({
                    type: 'error',
                    error: message.error
                });
                break;

            default:
                console.warn('Unhandled message type:', message.type);
        }
    } catch (error) {
        console.error('Error processing WebSocket message:', error);
        notifyClients({
            type: 'error',
            error: 'Failed to process server message'
        });
    }
}

// Helper function to notify all clients
async function notifyClients(message) {
    try {
        chrome.runtime.sendMessage(message).catch(error => {
            console.error('Error notifying clients:', error);
        });
    } catch (error) {
        console.error('Failed to send message to clients:', error);
    }
}

// WebSocket initialization with proper error handling
async function initializeWebSocket() {
    return new Promise((resolve, reject) => {
        try {
            // Clean up existing connection
            if (state.ws) {
                state.ws.close();
                state.ws = null;
            }

            console.log('Initializing WebSocket connection...');
            state.ws = new WebSocket('ws://localhost:3000/websocket');
            
            state.ws.onopen = () => {
                console.log('WebSocket connected successfully');
                state.reconnectAttempts = 0;
                
                // Send initialization message
                const initMessage = {
                    type: MessageTypes.INITIALIZE,
                    timestamp: new Date().toISOString(),
                    clientId: chrome.runtime.id
                };
                
                state.ws.send(JSON.stringify(initMessage));
                resolve({ success: true });
            };
            
            state.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                reject(new Error('Failed to connect to transcription server'));
            };
            
            state.ws.onclose = async () => {
                console.log('WebSocket closed');
                if (state.isRecording && state.reconnectAttempts < state.MAX_RECONNECT_ATTEMPTS) {
                    state.reconnectAttempts++;
                    console.log(`Attempting reconnection ${state.reconnectAttempts}/${state.MAX_RECONNECT_ATTEMPTS}`);
                    try {
                        await initializeWebSocket();
                    } catch (error) {
                        console.error('Reconnection failed:', error);
                    }
                }
            };
            
            // Now handleWebSocketMessage is defined before we use it
            state.ws.onmessage = handleWebSocketMessage;
            
        } catch (error) {
            console.error('WebSocket initialization error:', error);
            reject(new Error('Failed to initialize WebSocket'));
        }
    });
}

// Process audio chunks
async function processAudioChunk(audioData) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket connection not available');
    }

    try {
        state.ws.send(audioData);
        return { success: true };
    } catch (error) {
        console.error('Error processing audio:', error);
        throw error;
    }
}

// Cleanup function
async function cleanup() {
    state.isRecording = false;
    
    if (state.ws) {
        if (state.ws.readyState === WebSocket.OPEN) {
            state.ws.close(1000, 'Recording stopped by user');
        }
        state.ws = null;
    }
    
    state.reconnectAttempts = 0;
    return { success: true };
}

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Received message:', message);
    
    // Handle windowLoaded message type
    if (message.type === 'windowLoaded') {
        sendResponse({ state: getPublicState() });
        return true;
    }
    
    // Handle action-based messages
    const handleMessage = async () => {
        try {
            switch (message.action) {
                case 'initializeWebSocket':
                    return await initializeWebSocket();
                    
                case 'processAudioChunk':
                    if (!message.audioData) {
                        throw new Error('No audio data provided');
                    }
                    return await processAudioChunk(message.audioData);
                    
                case 'stopRecording':
                    return await cleanup();
                    
                case 'getState':
                    return getPublicState();
                    
                case 'startRecording':
                    state.isRecording = true;
                    state.activeTabId = message.tabId;
                    updateState(state);
                    return { success: true };
                
                case 'startCapture':
                    if (!chrome.tabCapture) {
                        sendResponse({ error: 'tabCapture API not available' });
                        return true;
                    }

                    chrome.tabCapture.getMediaStreamId(
                        { targetTabId: message.tabId },
                        (streamId) => {
                            if (chrome.runtime.lastError) {
                                sendResponse({ error: chrome.runtime.lastError.message });
                                return;
                            }
                            sendResponse({ streamId });
                        }
                    );
                    return true;
                
                default:
                    throw new Error(`Unknown action: ${message.action}`);
            }
        } catch (error) {
            console.error('Error handling message:', error);
            return { error: error.message };
        }
    };

    handleMessage().then(sendResponse).catch(error => {
        console.error('Message handling error:', error);
        sendResponse({ error: error.message });
    });

    return true;
});

// Service worker lifecycle events
self.addEventListener('install', (event) => {
    console.log('Service Worker installing...');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('Service Worker activated');
    event.waitUntil(clients.claim());
});

console.log('Service Worker initialized');

let recordingWindow = null;

chrome.action.onClicked.addListener(async () => {
    if (recordingWindow) {
        // Focus existing window
        await chrome.windows.update(recordingWindow.id, { focused: true });
    } else {
        // Create new window
        recordingWindow = await chrome.windows.create({
            url: 'window.html',
            type: 'popup',
            width: 400,
            height: 600,
            focused: true
        });

        // Handle window close
        chrome.windows.onRemoved.addListener((windowId) => {
            if (recordingWindow && windowId === recordingWindow.id) {
                recordingWindow = null;
            }
        });
    }
});

// Add to your existing state management
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'windowLoaded') {
        // Sync state with newly opened window
        sendResponse({ state: state });
    }
});

// Add new function to handle state updates
function updateState(updates) {
    Object.assign(state, updates);
    // Notify all extension views of state change
    chrome.runtime.sendMessage({ type: 'stateUpdate', state: getPublicState() });
}

function getPublicState() {
    return {
        isRecording: state.isRecording,
        currentTranscript: state.currentTranscript,
        activeTabId: state.activeTabId
    };
}