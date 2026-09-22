const INSTALL_ID_KEY = 'scoop_alpha_install_id';
let cachedInstallId: string | undefined;

async function getInstallId() {
  if (cachedInstallId) return cachedInstallId;
  const stored = await browser.storage.local.get(INSTALL_ID_KEY);
  const existing = typeof stored?.[INSTALL_ID_KEY] === 'string' ? stored[INSTALL_ID_KEY] : '';
  if (/^[a-f0-9-]{36}$/i.test(existing)) return cachedInstallId = existing;
  const created = crypto.randomUUID();
  await browser.storage.local.set({ [INSTALL_ID_KEY]: created });
  return cachedInstallId = created;
}

function friendlyError(responseStatus?: number, providerMessage?: string, reason?: string) {
  const detail = `${providerMessage ?? ''} ${reason ?? ''}`.toLowerCase();
  const temporarilyUnavailable = [429, 502, 503, 504].includes(responseStatus ?? 0) ||
    detail.includes('temporarily unavailable') || detail.includes('rate limit') || detail.includes('quota') ||
    detail.includes('timeout') || detail.includes('provider');
  if (temporarilyUnavailable) return { error: 'Scoop is temporarily unavailable. Try again in a moment.', failure_state: 'TEMPORARILY_UNAVAILABLE', retryable: true };
  if (responseStatus === 400 || responseStatus === 422) return { error: 'Scoop could not use this selection. Adjust the crop and try again.', failure_state: 'UNSUPPORTED_SELECTION', retryable: true };
  return { error: 'Scoop hit an unexpected error. Try again.', failure_state: 'REQUEST_FAILED', retryable: true };
}

function localizationFallback(reason?: string) {
  return { x: 0, y: 0, width: 1, height: 1, confidence: 1, fallback: true, ...(reason ? { fallback_reason: reason } : {}) };
}

function validLocalization(payload: unknown, point: unknown) {
  if (!payload || typeof payload !== 'object' || !point || typeof point !== 'object') return false;
  const box = payload as Record<string, unknown>;
  const click = point as Record<string, unknown>;
  const values = [box.x, box.y, box.width, box.height, box.confidence, click.x, click.y];
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) return false;
  const x = box.x as number; const y = box.y as number; const width = box.width as number; const height = box.height as number;
  const confidence = box.confidence as number; const clickX = click.x as number; const clickY = click.y as number;
  return confidence >= 0.8 && confidence <= 1 && x >= 0 && y >= 0 && width > 0 && height > 0 &&
    x + width <= 1.001 && y + height <= 1.001 && clickX >= x && clickY >= y && clickX <= x + width && clickY <= y + height;
}

async function toggleOverlay(tabId?: number) {
  if (!tabId) return;
  await browser.tabs.sendMessage(tabId, { type: 'VCL_TOGGLE_OVERLAY' }).catch(() => undefined);
}

export default defineBackground(() => {
  browser.action.onClicked.addListener(async (tab) => {
    await toggleOverlay(tab.id);
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-scoop') return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    await toggleOverlay(tab?.id);
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const isLocate = message?.type === 'VCL_LOCATE_SELECTION' && typeof message.dataUrl === 'string';
    const isVision = (message?.type === 'VCL_ANALYZE_SELECTION' || isLocate) && typeof message.dataUrl === 'string';
    const isCommerce = message?.type === 'VCL_RESOLVE_PRODUCTS' && message.description && typeof message.description === 'object';
    const isAttribution = message?.type === 'VCL_COMMERCE_CLICK' && typeof message.attribution_token === 'string';
    if (!isVision && !isCommerce && !isAttribution) return;

    const requestId = message.requestId;
    const endpoint = isLocate ? 'locate-selection' : isVision ? 'analyze-selection' : isAttribution ? 'commerce-click' : 'resolve-products';
    const body = isVision
      ? { dataUrl: message.dataUrl, focusDataUrl: message.focusDataUrl, timestamp: message.timestamp, nearby_frames: message.nearby_frames, primary_description: message.primary_description,
        point: message.point }
      : isAttribution
        ? { attribution_token: message.attribution_token }
        : { description: message.description, context: message.context ?? null, source_image: message.source_image, telemetry: message.telemetry ?? null };

    void getInstallId().then((installId) => fetch(`https://api.vcl.article6.org/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Scoop-Install-Id': installId },
      body: JSON.stringify(body),
    })).then(async (response) => {
      const payload = await response.json();
      if (isLocate) {
        if (!response.ok || !validLocalization(payload, message.point)) {
          sendResponse(localizationFallback(typeof payload?.reason === 'string' ? payload.reason : typeof payload?.error === 'string' ? payload.error : undefined));
          return;
        }
        sendResponse(payload);
        return;
      }
      if (!response.ok) {
        sendResponse(friendlyError(response.status, typeof payload?.error === 'string' ? payload.error : undefined,
          typeof payload?.reason === 'string' ? payload.reason : undefined));
        return;
      }
      sendResponse(payload);
    }).catch(() => {
      if (isLocate) {
        sendResponse(localizationFallback('request_failed'));
        return;
      }
      sendResponse({ error: 'Scoop could not reach the service. Check your connection and try again.', failure_state: 'NETWORK_ERROR', retryable: true });
    });

    return true;
  });
});
