import { captureSelectionAtClientPoint, type FrameCaptureResult } from '../lib/frame-capture';

const OVERLAY_ID = 'vcl-overlay-root';
const RESULT_ID = 'vcl-capture-result';

type ObjectDescription = {
  category: string;
  subcategory: string;
  brand_candidate: string | null;
  model_candidate: string | null;
  color: string;
  material: string;
  style_attributes: string[];
  search_terms: string[];
  confidence: number;
};

function parseObjectDescription(value: unknown): ObjectDescription {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Vision provider returned an invalid response');
  const record = value as Record<string, unknown>;
  if (typeof record.category !== 'string' || typeof record.subcategory !== 'string' ||
      !(record.brand_candidate === null || typeof record.brand_candidate === 'string') ||
      !(record.model_candidate === null || typeof record.model_candidate === 'string') ||
      typeof record.color !== 'string' || typeof record.material !== 'string' ||
      !Array.isArray(record.style_attributes) || !Array.isArray(record.search_terms) ||
      typeof record.confidence !== 'number' || !Number.isFinite(record.confidence)) {
    throw new Error('Vision provider returned an invalid response');
  }
  return value as ObjectDescription;
}

function removeOverlay() {
  document.getElementById(OVERLAY_ID)?.remove();
}

function removeResult() {
  document.getElementById(RESULT_ID)?.remove();
}

function basePanel(titleText: string) {
  removeResult();
  const panel = document.createElement('div');
  panel.id = RESULT_ID;
  Object.assign(panel.style, {
    position: 'fixed', right: '20px', bottom: '20px', zIndex: '2147483647', width: '360px',
    maxWidth: 'calc(100vw - 40px)', padding: '14px', borderRadius: '14px', background: '#111',
    color: '#fff', boxShadow: '0 12px 40px rgba(0,0,0,0.35)', font: '13px system-ui, sans-serif',
  });
  const title = document.createElement('div');
  title.textContent = titleText;
  Object.assign(title.style, { fontWeight: '700', marginBottom: '10px' });
  panel.appendChild(title);
  document.documentElement.appendChild(panel);
  return panel;
}

function addClose(panel: HTMLElement) {
  const close = document.createElement('button');
  close.textContent = 'Close';
  Object.assign(close.style, { marginTop: '12px', padding: '7px 10px', border: '0', borderRadius: '8px', cursor: 'pointer' });
  close.addEventListener('click', removeResult);
  panel.appendChild(close);
}

function showFailure(result: Extract<FrameCaptureResult, { ok: false }>) {
  const panel = basePanel('VCL object crop: unsupported');
  const message = document.createElement('div');
  message.textContent = `${result.code}: ${result.message}`;
  Object.assign(message.style, { lineHeight: '1.4', opacity: '0.9' });
  panel.appendChild(message);
  addClose(panel);
}

async function showAnalysis(result: Extract<FrameCaptureResult, { ok: true }>) {
  const panel = basePanel('VCL analyzing selection…');
  const image = document.createElement('img');
  image.src = result.dataUrl;
  image.alt = 'Selected object crop';
  Object.assign(image.style, { display: 'block', width: '100%', maxHeight: '220px', objectFit: 'contain', borderRadius: '10px', background: '#000', marginBottom: '10px' });
  panel.appendChild(image);

  try {
    const analysis = parseObjectDescription(await browser.runtime.sendMessage({ type: 'VCL_ANALYZE_SELECTION', dataUrl: result.dataUrl }));
    panel.firstElementChild!.textContent = 'VCL object understanding: success';

    const summary = document.createElement('div');
    summary.textContent = [analysis.brand_candidate, analysis.model_candidate, analysis.subcategory || analysis.category].filter(Boolean).join(' · ') || analysis.category;
    Object.assign(summary.style, { fontWeight: '700', marginBottom: '6px' });
    panel.appendChild(summary);

    const attrs = document.createElement('div');
    attrs.textContent = [analysis.color, analysis.material, ...analysis.style_attributes].filter(Boolean).join(' · ');
    Object.assign(attrs.style, { opacity: '0.85', lineHeight: '1.45', marginBottom: '8px' });
    panel.appendChild(attrs);

    const searches = document.createElement('div');
    searches.textContent = `Search: ${analysis.search_terms.join(' | ')}`;
    Object.assign(searches.style, { lineHeight: '1.45', marginBottom: '8px' });
    panel.appendChild(searches);

    const confidence = document.createElement('div');
    confidence.textContent = `Commercially searchable confidence: ${Math.round(analysis.confidence * 100)}%`;
    Object.assign(confidence.style, { opacity: '0.75' });
    panel.appendChild(confidence);
  } catch (error) {
    panel.firstElementChild!.textContent = 'VCL object understanding: failed';
    const message = document.createElement('div');
    message.textContent = error instanceof Error ? error.message : 'Vision analysis failed.';
    Object.assign(message.style, { lineHeight: '1.4', opacity: '0.9' });
    panel.appendChild(message);
  }

  addClose(panel);
}

function showOverlay() {
  removeOverlay();
  removeResult();

  const root = document.createElement('div');
  root.id = OVERLAY_ID;
  Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: '2147483647', background: 'rgba(0,0,0,0.12)', cursor: 'crosshair' });

  const label = document.createElement('div');
  label.textContent = 'VCL · click the object you want · Esc to close';
  Object.assign(label.style, {
    position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)', padding: '8px 12px',
    borderRadius: '999px', background: '#111', color: '#fff', font: '13px system-ui, sans-serif', pointerEvents: 'none',
  });
  root.appendChild(label);

  root.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const result = captureSelectionAtClientPoint(event.clientX, event.clientY);
    removeOverlay();
    if (result.ok) void showAnalysis(result);
    else showFailure(result);
  }, { once: true, capture: true });

  document.documentElement.appendChild(root);
}

export default defineContentScript({
  matches: ['https://www.youtube.com/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  main() {
    browser.runtime.onMessage.addListener((message) => {
      if (message?.type === 'VCL_TOGGLE_OVERLAY') {
        document.getElementById(OVERLAY_ID) ? removeOverlay() : showOverlay();
      }
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { removeOverlay(); removeResult(); }
    });
  },
});
