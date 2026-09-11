export default defineBackground(() => {
  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;
    await browser.tabs.sendMessage(tab.id, { type: 'VCL_TOGGLE_OVERLAY' }).catch(() => undefined);
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'VCL_ANALYZE_SELECTION' || typeof message.dataUrl !== 'string') return;

    const requestId = message.requestId;
    console.debug('[VCL message v2] start', { requestId, tabId: sender.tab?.id, frameId: sender.frameId });
    void fetch('https://api.vcl.article6.org/analyze-selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: message.dataUrl }),
    }).then(async (response) => {
      const payload = await response.json();
      console.debug('[VCL message v2] fetch JSON', requestId, response.status, JSON.stringify(payload));
      if (!response.ok) throw new Error(payload?.error || `Vision API failed with HTTP ${response.status}`);
      console.debug('[VCL message v2] sendResponse', requestId, JSON.stringify(payload));
      sendResponse(payload);
    }).catch((error: unknown) => {
      const payload = { error: error instanceof Error ? error.message : 'Vision analysis failed.' };
      console.debug('[VCL message v2] sendResponse error', requestId, JSON.stringify(payload));
      sendResponse(payload);
    });
    // Native Chromium before 148 does not use a returned Promise as the response.
    return true;
  });
});
