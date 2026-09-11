export default defineBackground(() => {
  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;
    await browser.tabs.sendMessage(tab.id, { type: 'VCL_TOGGLE_OVERLAY' }).catch(() => undefined);
  });

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'VCL_ANALYZE_SELECTION' || typeof message.dataUrl !== 'string') return;

    return fetch('https://api.vcl.article6.org/analyze-selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: message.dataUrl }),
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || `Vision API failed with HTTP ${response.status}`);
      return payload;
    });
  });
});
