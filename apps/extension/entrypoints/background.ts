export default defineBackground(() => {
  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;
    await browser.tabs.sendMessage(tab.id, { type: 'VCL_TOGGLE_OVERLAY' }).catch(() => undefined);
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const isVision = message?.type === 'VCL_ANALYZE_SELECTION' && typeof message.dataUrl === 'string';
    const isCommerce = message?.type === 'VCL_RESOLVE_PRODUCTS' && message.description && typeof message.description === 'object';
    if (!isVision && !isCommerce) return;

    const requestId = message.requestId;
    const endpoint = isVision ? 'analyze-selection' : 'resolve-products';
    const body = isVision
      ? { dataUrl: message.dataUrl }
      : { description: message.description, context: message.context ?? null, source_image: message.source_image };

    void fetch(`https://api.vcl.article6.org/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || `VCL API failed with HTTP ${response.status}`);
      sendResponse(payload);
    }).catch((error: unknown) => {
      sendResponse({ error: error instanceof Error ? error.message : 'VCL request failed.' });
    });

    return true;
  });
});
