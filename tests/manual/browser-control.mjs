// Small CDP helper for local extension verification when toolbar automation is unavailable.
// Outputs text/derived provenance only. Never record screenshots, network bodies or frame bytes.
const arguments_ = process.argv.slice(2);
const port = arguments_[0] === '--port' ? (arguments_.shift(), arguments_.shift()) : '9334';
const [action = 'summary', ...args] = arguments_;
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
if (action === 'targets') { console.log(targets.map(({ type, url }) => ({ type, url }))); process.exit(0); }
const target = action === 'invoke' ? targets.find(t => t.type === 'service_worker' && t.url.startsWith('chrome-extension://') && t.url.endsWith('/background.js'))
  : targets.find(t => t.type === 'page' && t.url.startsWith('http://127.0.0.1:8799')) ?? targets.find(t => t.type === 'page');
if (!target) throw Error(`Start the dedicated test browser with remote-debugging-port=${port} and the VCL extension loaded`);
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', ({ data }) => { const message = JSON.parse(data); const callback = pending.get(message.id); if (callback) { pending.delete(message.id); message.error ? callback.reject(message.error) : callback.resolve(message.result); } });
const send = (method, params) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); });
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
};
try {
  if (target.type === 'page' && action !== 'invoke') {
    await send('Page.bringToFront');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  }
  if (action === 'close') {
    const closed = new Promise(resolve => ws.addEventListener('close', resolve, { once: true }));
    await Promise.race([send('Browser.close'), closed]);
    console.log('Test browser closed');
  }
  else if (action === 'wake') {
    await send('ServiceWorker.enable');
    console.log(await send('ServiceWorker.startWorker', { scopeURL: `chrome-extension://${args[0]}/` }));
  }
  else if (action === 'open') console.log(await send('Page.navigate', { url: args[0] ?? 'http://127.0.0.1:8799/' }));
  else if (action === 'invoke') console.log(await evaluate(`chrome.tabs.query({active:true,currentWindow:true}).then(tabs=>chrome.tabs.sendMessage(tabs[0].id,{type:'VCL_TOGGLE_OVERLAY'})).then(()=> 'Extension invoked')`));
  else if (action === 'eval') console.log(JSON.stringify(await evaluate(args.join(' '))));
  else if (action === 'result') console.log(JSON.stringify(await evaluate(`(() => {
    const panel = document.querySelector('#vcl-capture-result');
    const records = [...(panel?.querySelectorAll('pre') ?? [])].map(p => { try { return JSON.parse(p.textContent); } catch { return null; } });
    const record = records.at(-1);
    const evidence = record?.evidence;
    return { text: panel?.innerText.slice(0, 450), time: document.querySelector('video')?.currentTime,
      paused: document.querySelector('video')?.paused, frames_used: evidence?.frames_used,
      changed_fields: evidence?.changed_fields, field_sources: evidence?.field_sources,
      frames: evidence?.frames?.map(f => ({ id: f.id, status: f.status,
        accepted: f.contributions.filter(c => c.decision === 'accepted'),
        identity: f.contributions.filter(c => ['brand_candidate', 'model_candidate', 'visible_text'].includes(c.field)) })),
      capture: record?.capture };
  })()`), null, 2));
  else if (action === 'click') {
    const [x, y] = args.map(Number);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    console.log('Clicked');
  } else console.log(JSON.stringify(await evaluate(`({text:document.documentElement.innerText, video:{time:document.querySelector('video')?.currentTime,paused:document.querySelector('video')?.paused},buttons:[...document.querySelectorAll('button')].map(b=>({text:b.textContent,disabled:b.disabled})), evidence:[...document.querySelectorAll('#vcl-capture-result pre')].map(p=>{try{return JSON.parse(p.textContent)}catch{return null}})})`), null, 2));
} finally { ws.close(); }
