document.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}); 