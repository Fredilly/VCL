const OVERLAY_ID = 'vcl-overlay-root';

function removeOverlay() {
  document.getElementById(OVERLAY_ID)?.remove();
}

function showOverlay() {
  removeOverlay();

  const root = document.createElement('div');
  root.id = OVERLAY_ID;
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    background: 'rgba(0,0,0,0.18)',
    cursor: 'crosshair',
  });

  const label = document.createElement('div');
  label.textContent = 'VCL · click an object · Esc to close';
  Object.assign(label.style, {
    position: 'fixed',
    top: '16px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '8px 12px',
    borderRadius: '999px',
    background: '#111',
    color: '#fff',
    font: '13px system-ui, sans-serif',
    pointerEvents: 'none',
  });

  root.appendChild(label);
  root.addEventListener('click', removeOverlay, { once: true });
  document.documentElement.appendChild(root);
}

export default defineContentScript({
  matches: [
    'https://www.youtube.com/*',
    'http://localhost/*',
    'http://127.0.0.1/*',
  ],
  main() {
    browser.runtime.onMessage.addListener((message) => {
      if (message?.type === 'VCL_TOGGLE_OVERLAY') {
        document.getElementById(OVERLAY_ID) ? removeOverlay() : showOverlay();
      }
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') removeOverlay();
    });
  },
});
