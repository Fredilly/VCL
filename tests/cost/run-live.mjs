import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

let port = Number(process.env.VCL_CDP_PORT ?? 9334);
const apiOrigin = 'https://api.vcl.article6.org';
const casesPath = process.env.VCL_COST_CASES ?? 'tests/manual/spike-5/cases.json';
const outputPath = process.env.VCL_COST_OUTPUT ?? 'tests/cost/run.json';
const extensionPath = resolve(process.env.VCL_EXTENSION_PATH ?? 'apps/extension/.output/chrome-mv3');
const baseProfilePath = resolve(process.env.VCL_COST_PROFILE ?? '.tmp/vcl-cost-browser');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets(candidatePort = port) {
  try { return await (await fetch(`http://127.0.0.1:${candidatePort}/json/list`)).json(); }
  catch { return null; }
}

function scoopWorker(list) {
  return list?.find((target) => target.type === 'service_worker' && target.url.startsWith('chrome-extension://') && target.url.endsWith('/background.js')) ?? null;
}

function braveExecutable() {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser']
    : process.platform === 'win32'
      ? [
          `${process.env.PROGRAMFILES ?? 'C:/Program Files'}/BraveSoftware/Brave-Browser/Application/brave.exe`,
          `${process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)'}/BraveSoftware/Brave-Browser/Application/brave.exe`,
        ]
      : ['/usr/bin/brave-browser', '/usr/bin/brave'];
  return candidates.find(existsSync);
}

async function findFreePort(start = 9340) {
  for (let candidate = start; candidate < start + 20; candidate++) {
    if (!(await targets(candidate))) return candidate;
  }
  throw new Error('Could not find a free local CDP port for the Scoop cost browser.');
}

async function launchControlledBrowser() {
  const executable = braveExecutable();
  if (!executable) throw new Error('Brave was not found. Install Brave or set VCL_CDP_PORT to a compatible running Chromium browser.');
  if (!existsSync(extensionPath)) throw new Error(`Extension build not found at ${extensionPath}. Run: pnpm --filter @vcl/extension build`);
  if (await targets(port)) port = await findFreePort();
  const profilePath = process.env.VCL_COST_PROFILE ? baseProfilePath : `${baseProfilePath}-${port}`;
  spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profilePath}`,
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank',
  ], { detached: true, stdio: 'ignore' }).unref();

  let list = null;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    list = await targets();
    if (list && scoopWorker(list)) return { list, launched: true };
  }
  throw new Error(`Brave started on CDP port ${port}, but Scoop's extension service worker did not start.`);
}

async function ensureBrowser() {
  const list = await targets();
  if (list && scoopWorker(list)) return { list, launched: false };
  return launchControlledBrowser();
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        message.error ? waiter.reject(new Error(message.error.message ?? JSON.stringify(message.error))) : waiter.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    });
    return this;
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
    return () => this.listeners.get(method)?.delete(fn);
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.ws.close(); }
}

async function waitFor(predicate, timeoutMs, message) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(message);
}

async function collectApiResponses(worker, runAction) {
  // CDP Network events are not reliable for extension service-worker fetches in every
  // Chromium build. Wrap fetch inside the worker instead and keep only the tiny JSON
  // responses needed for cost telemetry. No image request bodies are retained.
  await worker.eval(`(() => {
    if (!globalThis.__vclCostOriginalFetch) globalThis.__vclCostOriginalFetch = globalThis.fetch;
    globalThis.__vclCostResponses = [];
    globalThis.fetch = async (...args) => {
      const response = await globalThis.__vclCostOriginalFetch(...args);
      try {
        const url = String(args[0] instanceof Request ? args[0].url : args[0]);
        const parsed = new URL(url);
        if (parsed.origin === ${JSON.stringify(apiOrigin)} && ['/locate-selection','/analyze-selection','/resolve-products'].includes(parsed.pathname)) {
          const clone = response.clone();
          let body = null;
          try { body = await clone.json(); } catch {}
          globalThis.__vclCostResponses.push({ name: parsed.pathname.slice(1), status: response.status, body });
        }
      } catch {}
      return response;
    };
    return true;
  })()`);
  try {
    await runAction();
    await waitFor(async () => {
      const responses = await worker.eval(`globalThis.__vclCostResponses ?? []`);
      return responses.some((item) => item.name === 'resolve-products') ? responses : null;
    }, 120000, 'Timed out waiting for product resolution');
    await sleep(300);
    return await worker.eval(`globalThis.__vclCostResponses ?? []`);
  } finally {
    await worker.eval(`(() => {
      if (globalThis.__vclCostOriginalFetch) globalThis.fetch = globalThis.__vclCostOriginalFetch;
      delete globalThis.__vclCostOriginalFetch;
      delete globalThis.__vclCostResponses;
      return true;
    })()`).catch(() => undefined);
  }
}

function usageFrom(responses, name) {
  const item = responses.find((entry) => entry.name === name && entry.status >= 200 && entry.status < 300);
  return item?.body?.provider_usage ?? null;
}

function commerceFrom(responses) {
  const item = responses.findLast((entry) => entry.name === 'resolve-products');
  return item?.body ?? null;
}

const { list: initialTargets, launched } = await ensureBrowser();
let list = initialTargets;
let pageTarget = list.find((target) => target.type === 'page' && /^https?:|about:blank/.test(target.url));
if (!pageTarget) throw new Error('No browser page target found.');
const page = await new Cdp(pageTarget.webSocketDebuggerUrl).open();
await page.send('Page.enable');
await page.send('Runtime.enable');

const fixture = JSON.parse(await readFile(casesPath, 'utf8'));
const runs = [];

try {
  for (const testCase of fixture.cases.slice(0, 10)) {
    console.error(`Spike 7: ${testCase.id} — ${testCase.selected_item}`);
    await page.send('Page.navigate', { url: testCase.source });
    await waitFor(async () => await page.eval(`document.readyState === 'complete' && !!document.querySelector('video')`), 30000, 'YouTube video did not become ready');
    await page.eval(`(() => { const v=document.querySelector('video'); v.pause(); v.currentTime=${Number(testCase.timestamp_s)}; return true; })()`);
    await waitFor(async () => await page.eval(`Math.abs((document.querySelector('video')?.currentTime ?? 0)-${Number(testCase.timestamp_s)}) < 1`), 12000, 'Could not seek video');
    await sleep(700);

    list = await targets();
    const workerTarget = scoopWorker(list);
    if (!workerTarget) throw new Error(`Scoop extension service worker disappeared on CDP port ${port}. Retry the run once; the dedicated browser will be relaunched if needed.`);
    const worker = await new Cdp(workerTarget.webSocketDebuggerUrl).open();
    await worker.send('Runtime.enable');

    const started = Date.now();
    let responses;
    try {
      responses = await collectApiResponses(worker, async () => {
        await worker.eval(`chrome.tabs.query({active:true,currentWindow:true}).then(tabs=>chrome.tabs.sendMessage(tabs[0].id,{type:'VCL_TOGGLE_OVERLAY'}))`);
        await waitFor(async () => await page.eval(`!!document.querySelector('#vcl-overlay-root')`), 5000, 'Scoop overlay did not open');
        const rect = await page.eval(`(() => { const r=document.querySelector('video').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
        const x = rect.x + rect.width * Number(testCase.selection?.x ?? 0.5);
        const y = rect.y + rect.height * Number(testCase.selection?.y ?? 0.5);
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      });
    } finally { worker.close(); }

    const commerce = commerceFrom(responses);
    const latencyMs = Date.now() - started;
    runs.push({
      case_id: testCase.id,
      selected_item: testCase.selected_item,
      localization_usage: usageFrom(responses, 'locate-selection'),
      vision_usage: usageFrom(responses, 'analyze-selection'),
      verification_usage: commerce?.cost_usage?.verification_usage ?? null,
      commerce_calls: commerce?.cost_usage?.commerce_calls ?? {},
      latency_ms: latencyMs,
      provider_blocked: commerce?.state === 'TEMPORARILY_UNAVAILABLE',
      notes: commerce ? `state=${commerce.state}; products=${commerce.products?.length ?? 0}` : 'resolve-products response unavailable',
    });
    console.error(`  ${latencyMs}ms · ${commerce?.state ?? 'unknown'} · ${commerce?.products?.length ?? 0} products`);
    await page.eval(`document.querySelector('#vcl-capture-result')?.remove(); document.querySelector('#vcl-overlay-root')?.remove(); true`);
    await sleep(400);
  }
} finally {
  page.close();
}

const record = {
  schema_version: 1,
  spike: '7',
  run_date: new Date().toISOString(),
  pricing_snapshot_date: '2026-09-16',
  browser_launched_by_runner: launched,
  cdp_port: port,
  runs,
  summary: { sample_size: runs.length },
};
await writeFile(outputPath, JSON.stringify(record, null, 2) + '\n');
console.log(`Wrote ${runs.length} runs to ${outputPath}`);
console.log(`Next: pnpm cost:summary ${outputPath}`);
