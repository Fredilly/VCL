export default defineBackground(() => {
  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;
    await browser.tabs.sendMessage(tab.id, { type: 'VCL_TOGGLE_OVERLAY' }).catch(() => undefined);
  });

  browser.runtime.onMessage.addListener((message, sender) => {
    const isVision = message?.type === 'VCL_ANALYZE_SELECTION' && typeof message.dataUrl === 'string';
    const isCommerce = message?.type === 'VCL_RESOLVE_PRODUCTS' && message.description && typeof message.description === 'object';
    if (!isVision && !isCommerce) return;

    const requestId = message.requestId;
    const endpoint = isVision ? 'analyze-selection' : 'resolve-products';
    const body = isVision
      ? { dataUrl: message.dataUrl }
      : { description: message.description, context: message.context ?? null };
    console.debug('[VCL message v5] start', { requestId, endpoint, tabId: sender.tab?.id, frameId: sender.frameId });

    return fetch(`https://api.vcl.article6.org/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (response) => {
      const payload = await response.json();
      console.debug('[VCL message v5] fetch JSON', requestId, endpoint, response.status, JSON.stringify(payload));
      if (!response.ok) throw new Error(payload?.error || `VCL API failed with HTTP ${response.status}`);
      return payload;
    }).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : 'VCL request failed.',
    }));
  });
});
