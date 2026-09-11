export default defineBackground(() => {
  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;

    await browser.tabs.sendMessage(tab.id, { type: 'VCL_TOGGLE_OVERLAY' }).catch(() => undefined);
  });
});
