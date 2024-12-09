# transkriblr_v2

## Tab Audio Transcription Extension

This Chrome extension captures audio from browser tabs and transcribes it using a local Whisper model.

## Features
- Tab audio capture
- Real-time transcription
- Local processing (no cloud services required)
- Downloadable transcripts

## Installation
1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" and select this directory

## Usage
1. Click the extension icon in your Chrome toolbar
2. Click "Start Recording" to begin capturing tab audio
3. Click "Stop Recording" when finished
4. Click "Download Transcript" to save the transcription

## Requirements
- Local Node.js server running on port 3000
- Whisper installed in your environment

## Note
Make sure the companion transcription server is running before using the extension.