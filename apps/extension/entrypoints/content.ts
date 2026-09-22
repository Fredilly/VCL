import { captureSelectionAtClientPoint, cropFrozenSelection, focusBox, selectionPoint, validatedTargetBox, type FrameCaptureResult } from '../lib/frame-capture';
import { captureNearbyFrames, nearbyCaptureLimitation } from '../lib/nearby-frame-capture';

const OVERLAY_ID = 'vcl-overlay-root';
const RESULT_ID = 'vcl-capture-result';
let activeCapture: AbortController | undefined;
const alphaSessionId = crypto.randomUUID();

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
  identity_confidence: number;
  multi_frame?: { frames_used: number; changed_hypothesis: boolean; changed_fields: string[] };
};

type ProductCandidate = {
  id: string;
  title: string;
  image_reference: string | null;
  destination: string | null;
  price: string | null;
  currency: string | null;
  result_class: 'LIKELY' | 'SIMILAR';
  provider?: string;
  attribution_token?: string;
  click_ref?: string;
};

type CommerceResponse = {
  query: { query: string };
  products: ProductCandidate[];
  latency_ms: number;
  state?: 'RESULTS' | 'NO_RESULTS' | 'TEMPORARILY_UNAVAILABLE';
  providers_used?: string[];
  timing?: { provider_retrieval_ms?: number; candidate_verification_ms?: number; total_ms?: number };
};

function parseObjectDescription(value: unknown): ObjectDescription {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Vision provider returned an invalid response');
  const record = value as Record<string, unknown>;
  if (typeof record.category !== 'string' || typeof record.subcategory !== 'string' ||
      !(record.brand_candidate === null || typeof record.brand_candidate === 'string') ||
      !(record.model_candidate === null || typeof record.model_candidate === 'string') ||
      typeof record.color !== 'string' || typeof record.material !== 'string' ||
      !Array.isArray(record.style_attributes) || !Array.isArray(record.search_terms) ||
      typeof record.confidence !== 'number' || !Number.isFinite(record.confidence) ||
      typeof record.identity_confidence !== 'number' || !Number.isFinite(record.identity_confidence)) {
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

function surfaceContext() {
  const youtubeTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim()
    || document.querySelector('h1.title yt-formatted-string')?.textContent?.trim()
    || document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
  const youtubeMatch = location.hostname.includes('youtube.com') && typeof location.search === 'string' ? location.search.match(/[?&]v=([^&]+)/) : null;
  const youtubeId = youtubeMatch?.[1] ? decodeURIComponent(youtubeMatch[1]) : null;
  return {
    platform: location.hostname.includes('youtube.com') ? 'youtube' : 'generic-html5',
    title: youtubeTitle || null,
    content_ref: youtubeId ? `youtube:${youtubeId}` : null,
  };
}

function removeOverlay() { document.getElementById(OVERLAY_ID)?.remove(); }
function removeResult() {
  activeCapture?.abort();
  activeCapture = undefined;
  document.getElementById(RESULT_ID)?.remove();
}
function cleanupScoopUi() {
  removeOverlay();
  removeResult();
}

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

function button(text: string) {
  const element = document.createElement('button');
  element.textContent = text;
  Object.assign(element.style, { padding: '7px 10px', border: '0', borderRadius: '8px', cursor: 'pointer' });
  return element;
}

function addClose(panel: HTMLElement) {
  const close = button('Close');
  Object.assign(close.style, { marginTop: '12px' });
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

  if (__VCL_DEBUG_PROVENANCE__ && commerce.providers_used?.length) {
    const counts = new Map<string, number>();
    for (const product of commerce.products) {
      if (product.provider) counts.set(product.provider, (counts.get(product.provider) ?? 0) + 1);
    }
    if (counts.size) {
      const summary = document.createElement('div');
      summary.textContent = `Providers: ${[...counts.entries()].map(([name, n]) => `${name} ${n}`).join(' · ')}`;
      Object.assign(summary.style, { opacity: '0.6', fontSize: '11px', marginBottom: '6px' });
      panel.appendChild(summary);
    }
  }

  if (!commerce.products.length) {
    const empty = document.createElement('div');
    empty.textContent = commerce.state === 'TEMPORARILY_UNAVAILABLE'
      ? 'Shopping sources are temporarily unavailable. Try again.'
      : 'No useful product candidates returned.';
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
      if (product.attribution_token) {
        row.addEventListener('click', () => {
          void browser.runtime.sendMessage({ type: 'VCL_COMMERCE_CLICK', attribution_token: product.attribution_token }).catch(() => undefined);
        });
      }
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
    const parts = [product.result_class, product.price && product.currency ? `${product.price} ${product.currency}` : null];
    if (__VCL_DEBUG_PROVENANCE__ && product.provider) parts.push(`source: ${product.provider}`);
    meta.textContent = parts.filter(Boolean).join(' · ');
    Object.assign(meta.style, { opacity: '0.7', marginTop: '4px' });
    text.append(title, meta);
    if (product.provider) {
      const providerLabel = document.createElement('div');
      providerLabel.textContent = product.provider;
      Object.assign(providerLabel.style, { fontSize: '11px', opacity: '0.5', marginTop: '2px' });
      text.appendChild(providerLabel);
    }
    row.appendChild(text);
    panel.appendChild(row);
  }
}

async function showAnalysis(result: Extract<FrameCaptureResult, { ok: true }>, supplied?: ObjectDescription, captureDebug?: unknown, stageTiming: Record<string, number | null> = {}) {
  const scoopEventId = crypto.randomUUID();
  const interactionStarted = Date.now();
  const panel = basePanel('VCL analyzing selection…');
  const controller = new AbortController();
  activeCapture = controller;
  const image = document.createElement('img');
  image.src = result.dataUrl;
  image.alt = 'Selected object crop';
  Object.assign(image.style, { display: 'block', width: '100%', maxHeight: '180px', objectFit: 'contain', borderRadius: '10px', background: '#000', marginBottom: '10px' });
  panel.appendChild(image);
  addClose(panel);

  try {
    let focusDataUrl: string | undefined;
    if (!supplied && result.crop) {
      panel.firstElementChild!.textContent = 'VCL locating the clicked object…';
      const localizationStarted = Date.now();
      const focus = await cropFrozenSelection(result, focusBox(result));
      focusDataUrl = focus.dataUrl;
      if (controller.signal.aborted) return;
      const located = await browser.runtime.sendMessage({ type: 'VCL_LOCATE_SELECTION', requestId: crypto.randomUUID(),
        dataUrl: result.dataUrl, focusDataUrl: focus.dataUrl, point: selectionPoint(result) });
      if (controller.signal.aborted) return;
      if (located?.error) throw new Error(located.error + (__VCL_DEBUG_PROVENANCE__ && located.reason ? ` (${located.reason})` : ''));
      // Validate the localized target, but keep the user's selected crop for analysis.
      // Destructively recropping to the model's box can remove garment/object context
      // and amplify localization errors into bad product understanding.
      validatedTargetBox(located, result);
      stageTiming.localization_ms = Date.now() - localizationStarted;
      if (controller.signal.aborted) return;
      panel.firstElementChild!.textContent = 'VCL analyzing the clicked object…';
    }
    const requestId = crypto.randomUUID();
    const visionStarted = Date.now();
    const response: unknown = supplied ?? await browser.runtime.sendMessage({ type: 'VCL_ANALYZE_SELECTION', requestId, dataUrl: result.dataUrl, focusDataUrl, timestamp: result.currentTime,
      point: result.crop ? selectionPoint(result) : undefined });
    if (!supplied) stageTiming.vision_ms = Date.now() - visionStarted;
    if (controller.signal.aborted) return;
    if (response && typeof response === 'object' && 'error' in response && typeof response.error === 'string') throw new Error(response.error);
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

    const identityConfidence = document.createElement('div');
    identityConfidence.textContent = `Identity confidence: ${Math.round(analysis.identity_confidence * 100)}%`;
    Object.assign(identityConfidence.style, { opacity: '0.75', marginTop: '3px' });
    panel.appendChild(identityConfidence);

    if (__VCL_DEBUG_PROVENANCE__) {
      const details = document.createElement('details');
      const label = document.createElement('summary'); label.textContent = 'Frame evidence provenance';
      const text = document.createElement('pre');
      text.style.whiteSpace = 'pre-wrap'; text.style.fontSize = '11px';
      text.textContent = JSON.stringify({ evidence: analysis.multi_frame ?? { frames_used: 1, changed_hypothesis: false }, capture: captureDebug, selection: result.crop, timing: stageTiming }, null, 2);
      details.append(label, text); panel.appendChild(details);
    }

    // A confident primary guess must not prevent the user from checking another view.
    // Confidence still comes from grounded evidence, never from action availability.
    if (!supplied) {
      const improve = button('Improve with nearby frames');
      const note = document.createElement('div');
      note.textContent = 'Check up to two nearby frames (±0.5 seconds), then return to your paused position.';
      panel.append(note, improve);
      improve.addEventListener('click', async () => {
        improve.disabled = true;
        const limitation = nearbyCaptureLimitation(result);
        if (limitation) {
          note.textContent = 'Nearby frames are unavailable for this video. Keeping the selected-frame result.';
          if (__VCL_DEBUG_PROVENANCE__) note.textContent += ` (${limitation})`;
          return;
        }
        note.textContent = 'Checking nearby frames…';
        let captured;
        try {
          captured = await captureNearbyFrames(result, controller.signal);
          if (controller.signal.aborted) return;
          if (!captured.frames.length) {
            note.textContent = 'No useful nearby crops were captured. Keeping the selected-frame result.';
            if (__VCL_DEBUG_PROVENANCE__) note.textContent += ` ${JSON.stringify(captured)}`;
            return;
          }
          const { multi_frame: _debug, ...primaryDescription } = analysis;
          const response = await browser.runtime.sendMessage({ type: 'VCL_ANALYZE_SELECTION', requestId: crypto.randomUUID(),
            dataUrl: result.dataUrl, timestamp: result.currentTime, primary_description: primaryDescription, nearby_frames: captured.frames,
            point: selectionPoint(result) });
          if (controller.signal.aborted) return;
          if (response?.error) throw new Error('Nearby analysis unavailable');
          const merged = parseObjectDescription(response);
          const debug = { attempts: captured.attempts, limitation: captured.limitation, mode: captured.mode, restored: captured.restored };
          if (merged.multi_frame?.changed_hypothesis) await showAnalysis(result, merged, debug);
          else {
            note.textContent = 'Nearby evidence did not change the selected-object hypothesis.';
            if (__VCL_DEBUG_PROVENANCE__) {
              const text = document.createElement('pre'); text.style.whiteSpace = 'pre-wrap';
              text.textContent = JSON.stringify({ evidence: merged.multi_frame, capture: debug }, null, 2); panel.appendChild(text);
            }
          }
        } catch {
          if (!controller.signal.aborted) note.textContent = 'Nearby analysis is unavailable. Keeping the selected-frame result.';
        } finally { if (captured) captured.frames.length = 0; }
      }, { once: true });
    }

    const commerceRaw = await browser.runtime.sendMessage({
      type: 'VCL_RESOLVE_PRODUCTS',
      requestId: crypto.randomUUID(),
      description: analysis,
      context: surfaceContext(),
      source_image: result.dataUrl,
      telemetry: { event_id: scoopEventId, session_id: alphaSessionId, interaction_started_at: interactionStarted },
    });
    if (controller.signal.aborted) return;
    if (commerceRaw && typeof commerceRaw === 'object' && typeof commerceRaw.error === 'string') throw new Error(commerceRaw.error);
    const commerce = parseCommerceResponse(commerceRaw);
    if (__VCL_DEBUG_PROVENANCE__) {
      const timing = document.createElement('div');
      const total = Object.values(stageTiming).reduce<number>((sum, value) => sum + (value ?? 0), 0) + (commerce.timing?.total_ms ?? commerce.latency_ms);
      timing.textContent = `Timing · capture ${stageTiming.capture_ms ?? 'n/a'}ms · localization ${stageTiming.localization_ms ?? 'n/a'}ms · vision ${stageTiming.vision_ms ?? 'n/a'}ms · retrieval ${commerce.timing?.provider_retrieval_ms ?? 'n/a'}ms · verification ${commerce.timing?.candidate_verification_ms ?? 'n/a'}ms · total ${total}ms`;
      Object.assign(timing.style, { opacity: '0.6', fontSize: '11px', marginTop: '8px' });
      panel.appendChild(timing);
    }
    renderProducts(panel, commerce);
  } catch (error) {
    if (controller.signal.aborted) return;
    const message = document.createElement('div');
    message.textContent = error instanceof Error ? error.message : 'VCL request failed.';
    Object.assign(message.style, { lineHeight: '1.4', opacity: '0.9', marginTop: '10px' });
    panel.appendChild(message);
  }
}

function showSelectionPreview(clientX: number, clientY: number) {
  let cropFraction = 0.5;
  const captureStarted = Date.now();
  let capture = captureSelectionAtClientPoint(clientX, clientY, cropFraction);
  const captureMs = Date.now() - captureStarted;
  if (!capture.ok) { showFailure(capture); return; }

  const panel = basePanel('VCL selection · adjust before analyzing');
  const image = document.createElement('img');
  image.alt = 'Selected object crop preview';
  Object.assign(image.style, { display: 'block', width: '100%', height: '100%', borderRadius: '10px', background: '#000' });
  const preview = document.createElement('div');
  Object.assign(preview.style, { position: 'relative', width: '220px', height: '220px', margin: '0 auto 10px' });
  const pointMarker = document.createElement('span');
  Object.assign(pointMarker.style, { position: 'absolute', width: '12px', height: '12px', border: '2px solid #fff',
    boxShadow: '0 0 0 2px #111', borderRadius: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none' });
  preview.append(image, pointMarker); panel.appendChild(preview);

  const cropLabel = document.createElement('div');
  Object.assign(cropLabel.style, { opacity: '0.7', marginBottom: '10px' });
  panel.appendChild(cropLabel);

  const controls = document.createElement('div');
  Object.assign(controls.style, { display: 'flex', gap: '8px', flexWrap: 'wrap' });
  const tighter = button('− Tighter');
  const wider = button('+ Wider');
  const analyze = button('Analyze');
  Object.assign(analyze.style, { fontWeight: '700' });
  controls.append(tighter, wider, analyze);
  panel.appendChild(controls);

  const refresh = () => {
    const next = captureSelectionAtClientPoint(clientX, clientY, cropFraction);
    if (!next.ok) { showFailure(next); return; }
    capture = next;
    image.src = capture.dataUrl;
    const point = selectionPoint(capture);
    pointMarker.style.left = `${point.x * 100}%`; pointMarker.style.top = `${point.y * 100}%`;
    cropLabel.textContent = `The marked point selects your object. Include its whole outline using − / +. Context size: ${Math.round(cropFraction * 100)}%.`;
  };

  tighter.addEventListener('click', () => {
    cropFraction = Math.max(0.22, Math.round((cropFraction - 0.1) * 100) / 100);
    refresh();
  });
  wider.addEventListener('click', () => {
    cropFraction = Math.min(0.9, Math.round((cropFraction + 0.1) * 100) / 100);
    refresh();
  });
  analyze.addEventListener('click', () => { if (capture.ok) void showAnalysis(capture, undefined, undefined, { capture_ms: captureMs }); });

  refresh();
  addClose(panel);
}

function showOverlay() {
  cleanupScoopUi();
  const root = document.createElement('div');
  root.id = OVERLAY_ID;
  Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: '2147483647', background: 'rgba(0,0,0,0.12)', cursor: 'crosshair' });
  const label = document.createElement('div');
  label.textContent = 'VCL · click the object you want · Esc to close';
  Object.assign(label.style, { position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)', padding: '8px 12px', borderRadius: '999px', background: '#111', color: '#fff', font: '13px system-ui, sans-serif', pointerEvents: 'none' });
  root.appendChild(label);
  root.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    const clientX = event.clientX;
    const clientY = event.clientY;
    removeOverlay();
    showSelectionPreview(clientX, clientY);
  }, { once: true, capture: true });
  document.documentElement.appendChild(root);
}

export default defineContentScript({
  matches: ['https://www.youtube.com/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  main() {
    browser.runtime.onMessage.addListener((message) => {
      if (message?.type === 'VCL_TOGGLE_OVERLAY') document.getElementById(OVERLAY_ID) ? removeOverlay() : showOverlay();
    });
    window.addEventListener('keydown', (event) => { if (event.key === 'Escape') cleanupScoopUi(); });
    window.addEventListener('pagehide', cleanupScoopUi, { once: true });
    window.addEventListener('beforeunload', cleanupScoopUi, { once: true });
  },
});
