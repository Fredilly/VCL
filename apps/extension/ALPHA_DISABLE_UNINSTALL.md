# Alpha disable and uninstall behavior

Scoop is user-triggered. It does not continuously scan pages or poll in the background.

## Disable

When the extension is disabled, its background/content-script execution and API requests stop. Scoop uses extension storage only for one random anonymous alpha install ID used for usage guardrails. It does not keep browsing history, screenshots, frame crops, or product history there.

## Re-enable

Re-enabling the extension is safe. Opening Scoop first removes any existing Scoop overlay/result panel, aborts any in-flight selection request owned by the current content-script instance, and then starts a fresh selection.

## Page cleanup

Scoop removes its overlay/result UI and aborts active work when:
- the user presses Escape;
- a fresh Scoop overlay is opened;
- the page is hidden/unloaded during navigation or refresh;
- the result panel is closed.

## Uninstall browser limitation

Browsers do not provide an installed content script with a reliable final callback after the extension itself has been removed. Uninstall immediately stops Scoop code and future network activity, but an already-injected DOM panel on an already-open page can remain visually present until that page is refreshed or navigated.

Uninstall removes the extension's stored anonymous install ID with the extension. Scoop has no local product/session database.

## Regression contract

The extension regression suite verifies:
- storage is limited to the anonymous install ID;
- no broad host permission is requested;
- cleanup removes both overlay and result UI;
- cleanup aborts active work;
- navigation/unload hooks invoke cleanup;
- reopening Scoop starts from a clean UI state.
