import { captureSelectionAtClientPoint, type FrameCaptureResult } from '../lib/frame-capture';

const OVERLAY_ID = 'vcl-overlay-root';
const RESULT_ID = 'vcl-capture-result';

function removeOverlay() {
  document.getElementById(OVERLAY_ID)?.remove();
}

function removeResult() {
  document.getElementById(RESULT_ID)?.remove();
}

function showCaptureResult(result: FrameCaptureResult) {
  removeResult();

  const panel = document.createElement('div');
  panel.id = RESULT_ID;
  Object.assign(panel.style, {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    zIndex: '2147483647',
    width: '340px',
    maxWidth: 'calc(100vw - 40px)',
    padding: '14px',
    borderRadius: '14px',
    background: '#111',
    color: '#fff',
    boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
    font: '13px system-ui, sans-serif',
  });

  const title = document.createElement('div');
  title.textContent = result.ok
    ? result.crop
      ? 'VCL object crop: success'
      : 'VCL frame capture: success'
    : 'VCL object crop: unsupported';
  Object.assign(title.style, { fontWeight: '700', marginBottom: '10px' });
  panel.appendChild(title);

  if (result.ok) {
    const image = document.createElement('img');
    image.src = result.dataUrl;
    image.alt = result.crop ? 'Selected object crop' : 'Captured video frame';
    Object.assign(image.style, {
      display: 'block',
      width: '100%',
      maxHeight: '260px',
      objectFit: 'contain',
      borderRadius: '10px',
      background: '#000',
      marginBottom: '10px',
    });
    panel.appendChild(image);

    const meta = document.createElement('div');
    meta.textContent = result.crop
      ? `crop ${result.crop.width}×${result.crop.height} @ (${result.crop.x}, ${result.crop.y}) · click (${result.crop.clickX}, ${result.crop.clickY}) · ${result.currentTime.toFixed(2)}s`
      : `${result.sourceWidth}×${result.sourceHeight} → ${result.width}×${result.height} · ${result.currentTime.toFixed(2)}s`;
    Object.assign(meta.style, { opacity: '0.8', lineHeight: '1.4' });
    panel.appendChild(meta);
  } else {
    const message = document.createElement('div');
    message.textContent = `${result.code}: ${result.message}`;
    Object.assign(message.style, { lineHeight: '1.4', opacity: '0.9' });
    panel.appendChild(message);
  }

  const close = document.createElement('button');
  close.textContent = 'Close';
  Object.assign(close.style, {
    marginTop: '12px',
    padding: '7px 10px',
    border: '0',
    borderRadius: '8px',
    cursor: 'pointer',
  });
  close.addEventListener('click', removeResult);
  panel.appendChild(close);

  document.documentElement.appendChild(panel);
}

function showOverlay() {
  removeOverlay();
  removeResult();

  const root = document.createElement('div');
  root.id = OVERLAY_ID;
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    background: 'rgba(0,0,0,0.12)',
    cursor: 'crosshair',
  });

  const label = document.createElement('div');
  label.textContent = 'VCL · click the object you want · Esc to close';
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
  root.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const result = captureSelectionAtClientPoint(event.clientX, event.clientY);
      removeOverlay();
      showCaptureResult(result);
    },
    { once: true, capture: true },
  );

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
      if (event.key === 'Escape') {
        removeOverlay();
        removeResult();
      }
    });
  },
});
