const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

// Create Express app
const app = express();

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files from 'public' directory

// Serve a basic frontend
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Audio Transcription Server</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; }
                .status { padding: 20px; background: #e8f5e9; border-radius: 8px; }
                .error { background: #ffebee; }
            </style>
        </head>
        <body>
            <h1>Audio Transcription Server</h1>
            <div class="status">
                Server is running and ready to accept WebSocket connections
                <br><br>
                WebSocket endpoint: ws://localhost:3000/websocket
            </div>
        </body>
        </html>
    `);
});

// Create HTTP server
const server = app.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
});

// Create WebSocket server with improved error handling
const wss = new WebSocket.Server({
    server: server,
    path: '/websocket'
});

// Track active connections
const activeConnections = new Set();

// Add this function to validate WebM data
function isValidWebM(buffer) {
    // WebM files start with 0x1A 0x45 0xDF 0xA3 or have it within the first few bytes
    const searchLength = Math.min(buffer.length, 50); // Search in first 50 bytes
    for (let i = 0; i < searchLength - 3; i++) {
        if (buffer[i] === 0x1A && 
            buffer[i + 1] === 0x45 && 
            buffer[i + 2] === 0xDF && 
            buffer[i + 3] === 0xA3) {
            return true;
        }
    }
    return false;
}

// Add this at the top with other constants
const audioChunks = new Map(); // Map to store chunks per connection

// Update the WebSocket message handler
wss.on('connection', (ws) => {
    console.log('New WebSocket connection established');
    activeConnections.add(ws);

    ws.send(JSON.stringify({
        type: 'connection',
        status: 'connected',
        timestamp: new Date().toISOString()
    }));

    ws.on('message', async (data) => {
        try {
            if (!(data instanceof Buffer)) {
                throw new Error('Invalid data format received');
            }

            if (data.length < 100) {
                console.log('Skipping small audio chunk');
                return;
            }

            const timestamp = Date.now();
            const webmPath = path.join(__dirname, `temp_${timestamp}.webm`);
            const wavPath = path.join(__dirname, `temp_${timestamp}.wav`);

            // Write the WebM file
            await fs.promises.writeFile(webmPath, data);

            // Convert to WAV using specific FFmpeg options
            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(webmPath)
                    .inputOptions([
                        '-f webm',
                        '-acodec opus'
                    ])
                    .outputOptions([
                        '-ac 1',           // mono
                        '-ar 16000',       // 16kHz
                        '-acodec pcm_s16le', // PCM format
                        '-f wav'           // WAV container
                    ])
                    .on('error', (err, stdout, stderr) => {
                        console.error('FFmpeg stderr:', stderr);
                        reject(err);
                    })
                    .on('end', () => resolve())
                    .save(wavPath);
            });

            // Process with Whisper
            const whisperProcess = spawn('whisper', [
                '--model', 'tiny',
                '--language', 'en',
                '--output_format', 'txt',
                '--output_dir', __dirname,
                wavPath
            ]);

            // Add these handlers
            whisperProcess.stdout.on('data', (data) => {
                console.log('Whisper output:', data.toString());
            });

            whisperProcess.stderr.on('data', (data) => {
                console.error('Whisper error:', data.toString());
            });

            whisperProcess.on('error', (error) => {
                console.error('Failed to start Whisper:', error);
            });

            whisperProcess.on('close', async (code) => {
                try {
                    if (code === 0) {
                        const txtPath = wavPath.replace('.wav', '.txt');
                        if (fs.existsSync(txtPath)) {
                            const transcription = fs.readFileSync(txtPath, 'utf8');
                            console.log('Transcription generated:', transcription.trim());
                            ws.send(JSON.stringify({
                                type: 'transcription',
                                text: transcription.trim(),
                                timestamp: new Date().toISOString()
                            }));
                        } else {
                            console.error('No transcription file generated at:', txtPath);
                        }
                    }
                } finally {
                    // Cleanup temp files
                    try {
                        fs.unlinkSync(webmPath);
                        fs.unlinkSync(wavPath);
                        const txtPath = wavPath.replace('.wav', '.txt');
                        if (fs.existsSync(txtPath)) {
                            fs.unlinkSync(txtPath);
                        }
                    } catch (err) {
                        console.error('Cleanup error:', err);
                    }
                }
            });
        } catch (error) {
            console.error('Error processing audio:', error);
            ws.send(JSON.stringify({
                type: 'error',
                error: 'Failed to process audio chunk'
            }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        activeConnections.delete(ws);
    });
});