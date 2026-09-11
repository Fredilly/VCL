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

type ProductCandidate = {
  id: string;
  title: string;
  image_reference: string | null;
  destination: string | null;
  price: string | null;
  currency: string | null;
  result_class: 'LIKELY' | 'SIMILAR';
};

type CommerceResponse = {
  query: { query: string };
  products: ProductCandidate[];
  latency_ms: number;
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

function parseCommerceResponse(value: unknown): CommerceResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Commerce provider returned an invalid response');
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.products)) throw new Error('Commerce provider returned an invalid response');
  return value as CommerceResponse;
}

function removeOverlay() { document.getElementById(OVERLAY_ID)?.remove(); }
function removeResult() { document.getElementById(RESULT_ID)?.remove(); }

function basePanel(titleText: string) {
  removeResult();
  const panel = document.createElement('div');
  panel.id = RESULT_ID;
  Object.assign(panel.style, {
    position: 'fixed', right: '20px', bottom: '20px', zIndex: '2147483647', width: '380px',
    maxWidth: 'calc(100vw - 40px)', maxHeight: '75vh', overflowY: 'auto', padding: '14px', borderRadius: '14px', background: '#111',
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
  panel.appendChild(message);
  addClose(panel);
}

function renderProducts(panel: HTMLElement, commerce: CommerceResponse) {
  const heading = document.createElement('div');
  heading.textContent = `Products · ${commerce.products.length} · ${commerce.latency_ms}ms`;
  Object.assign(heading.style, { fontWeight: '700', margin: '12px 0 8px' });
  panel.appendChild(heading);

  if (!commerce.products.length) {
    const empty = document.createElement('div');
    empty.textContent = 'No useful product candidates returned.';
    Object.assign(empty.style, { opacity: '0.75' });
    panel.appendChild(empty);
    return;
  }

  for (const product of commerce.products.slice(0, 5)) {
    const row = document.createElement(product.destination ? 'a' : 'div');
    if (row instanceof HTMLAnchorElement && product.destination) {
      row.href = product.destination;
      row.target = '_blank';
      row.rel = 'noopener noreferrer';
    }
    Object.assign((row as HTMLElement).style, {
      display: 'grid', gridTemplateColumns: product.image_reference ? '56px 1fr' : '1fr', gap: '8px',
      padding: '8px 0', borderTop: '1px solid rgba(255,255,255,.12)', color: '#fff', textDecoration: 'none',
    });
    if (product.image_reference) {
      const img = document.createElement('img');
      img.src = product.image_reference;
      img.alt = '';
      Object.assign(img.style, { width: '56px', height: '56px', objectFit: 'cover', borderRadius: '8px' });
      row.appendChild(img);
    }
    const text = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = product.title;
    Object.assign(title.style, { fontWeight: '600', lineHeight: '1.3' });
    const meta = document.createElement('div');
    meta.textContent = [product.result_class, product.price && product.currency ? `${product.price} ${product.currency}` : null].filter(Boolean).join(' · ');
    Object.assign(meta.style, { opacity: '0.7', marginTop: '4px' });
    text.append(title, meta);
    row.appendChild(text);
    panel.appendChild(row);
  }
}

async function showAnalysis(result: Extract<FrameCaptureResult, { ok: true }>) {
  const panel = basePanel('VCL analyzing selection…');
  const image = document.createElement('img');
  image.src = result.dataUrl;
  image.alt = 'Selected object crop';
  Object.assign(image.style, { display: 'block', width: '100%', maxHeight: '180px', objectFit: 'contain', borderRadius: '10px', background: '#000', marginBottom: '10px' });
  panel.appendChild(image);

  try {
    const requestId = crypto.randomUUID();
    const response = await browser.runtime.sendMessage({ type: 'VCL_ANALYZE_SELECTION', requestId, dataUrl: result.dataUrl });
    if (response && typeof response === 'object' && typeof response.error === 'string') throw new Error(response.error);
    const analysis = parseObjectDescription(response);
    panel.firstElementChild!.textContent = 'VCL object understanding: success';

    const summary = document.createElement('div');
    summary.textContent = [analysis.brand_candidate, analysis.model_candidate, analysis.subcategory || analysis.category].filter(Boolean).join(' · ') || analysis.category;
    Object.assign(summary.style, { fontWeight: '700', marginBottom: '6px' });
    panel.appendChild(summary);

    const attrs = document.createElement('div');
    attrs.textContent = [analysis.color, analysis.material, ...analysis.style_attributes].filter(Boolean).join(' · ');
    Object.assign(attrs.style, { opacity: '0.85', lineHeight: '1.45', marginBottom: '8px' });
    panel.appendChild(attrs);

    const confidence = document.createElement('div');
    confidence.textContent = `Commercially searchable confidence: ${Math.round(analysis.confidence * 100)}%`;
    Object.assign(confidence.style, { opacity: '0.75' });
    panel.appendChild(confidence);

    const commerceRaw = await browser.runtime.sendMessage({ type: 'VCL_RESOLVE_PRODUCTS', requestId: crypto.randomUUID(), description: analysis });
    if (commerceRaw && typeof commerceRaw === 'object' && typeof commerceRaw.error === 'string') throw new Error(commerceRaw.error);
    renderProducts(panel, parseCommerceResponse(commerceRaw));
  } catch (error) {
    const message = document.createElement('div');
    message.textContent = error instanceof Error ? error.message : 'VCL request failed.';
    Object.assign(message.style, { lineHeight: '1.4', opacity: '0.9', marginTop: '10px' });
    panel.appendChild(message);
  }

  addClose(panel);
}

function showOverlay() {
  removeOverlay(); removeResult();
  const root = document.createElement('div');
  root.id = OVERLAY_ID;
  Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: '2147483647', background: 'rgba(0,0,0,0.12)', cursor: 'crosshair' });
  const label = document.createElement('div');
  label.textContent = 'VCL · click the object you want · Esc to close';
  Object.assign(label.style, { position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)', padding: '8px 12px', borderRadius: '999px', background: '#111', color: '#fff', font: '13px system-ui, sans-serif', pointerEvents: 'none' });
  root.appendChild(label);
  root.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    const capture = captureSelectionAtClientPoint(event.clientX, event.clientY);
    removeOverlay();
    if (capture.ok) void showAnalysis(capture); else showFailure(capture);
  }, { once: true, capture: true });
  document.documentElement.appendChild(root);
}

export default defineContentScript({
  matches: ['https://www.youtube.com/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  main() {
    browser.runtime.onMessage.addListener((message) => {
      if (message?.type === 'VCL_TOGGLE_OVERLAY') document.getElementById(OVERLAY_ID) ? removeOverlay() : showOverlay();
    });
    window.addEventListener('keydown', (event) => { if (event.key === 'Escape') { removeOverlay(); removeResult(); } });
  },
});
