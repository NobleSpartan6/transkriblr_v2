// This script runs in the context of the web page
document.addEventListener('DOMContentLoaded', () => {
    // Signal that the content script is loaded
    chrome.runtime.sendMessage({ type: 'contentScriptLoaded' });
}); 