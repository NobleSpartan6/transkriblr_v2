# Audio Transcription Pro

A Chrome extension that captures and transcribes audio from any browser tab using AssemblyAI's API.

## Features
- Record audio from any browser tab 
- Real-time audio capture
- High-quality transcription using AssemblyAI
- Text summarization using Groq's LLM API
- Download transcripts as text files
- Visual indicators for tabs playing audio
- Simple, intuitive interface

## Installation
1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" and select this directory

## Configuration
1. Create a `config.js` file in the extension directory:
```javascript
export const config = {
    ASSEMBLY_AI_KEY: 'your_assemblyai_api_key', 
    GROQ_API_KEY: 'your_groq_api_key'
};
```

2. Get your API keys:
- AssemblyAI API key: [https://www.assemblyai.com/](https://www.assemblyai.com/)
- Groq API key: [https://console.groq.com/](https://console.groq.com/)

## Usage
1. Click the extension icon in your browser
2. Select a tab that's playing audio from the dropdown
3. Click "Start Recording" to begin capturing audio
4. Click "Stop Recording" when finished
5. Wait for transcription to complete
6. Optionally generate a summary or download the transcript

## Permissions
- `tabCapture`: Required to record tab audio
- `tabs`: Required to access tab information 
- `host_permissions`: Required for cross-origin requests

## Technical Details
- Uses Chrome's tabCapture API for audio recording
- WebM audio format for optimal quality
- AssemblyAI for speech-to-text transcription
- Groq's LLM API for text summarization
- Background service worker for state management

## Limitations
- Cannot capture audio from Chrome system pages
- Requires tab to be active during capture
- Maximum recording length depends on available memory

## Contributing
Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License
MIT