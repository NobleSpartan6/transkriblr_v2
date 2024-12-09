document.addEventListener('DOMContentLoaded', () => {
    chrome.runtime.sendMessage({ type: 'windowLoaded' }, (response) => {
        if (response && response.state) {
            if (response.state.isRecording) {
                document.getElementById('startBtn').disabled = true;
                document.getElementById('stopBtn').disabled = false;
            }
        }
    });
});

window.onbeforeunload = (e) => {
    if (document.getElementById('stopBtn').disabled === false) {
        e.preventDefault();
        e.returnValue = '';
        return '';
    }
}; 