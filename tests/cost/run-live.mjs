import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const port = Number(process.env.VCL_CDP_PORT ?? 9334);
const apiOrigin = 'https://api.vcl.article6.org';
const casesPath = process.env.VCL_COST_CASES ?? 'tests/manual/spike-5/cases.json';
const outputPath = process.env.VCL_COST_OUTPUT ?? 'tests/cost/run.json';
const profilePath = resolve(process.env.VCL_COST_PROFILE ?? '.tmp/vcl-cost-browser');
const caseLimit = Math.max(1, Number(process.env.VCL_COST_LIMIT ?? 10));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  try { return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); }
  catch { return null; }
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

async function ensureBrowser() {
  let list = await targets();
  if (list) return { list, launched: false };
  const executable = braveExecutable();
  if (!executable) throw new Error(`No CDP browser on port ${port}, and Brave was not found.`);
  spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profilePath}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank',
  ], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    list = await targets();
    if (list) return { list, launched: true };
  }
  throw new Error('Brave started but CDP did not become ready.');
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) return;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      message.error ? waiter.reject(new Error(message.error.message ?? JSON.stringify(message.error))) : waiter.resolve(message.result);
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

async function postJson(path, body) {
  const response = await fetch(`${apiOrigin}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(payload?.error ?? `${path} failed with HTTP ${response.status}`);
    error.status = response.status;
    error.reason = payload?.reason;
    throw error;
  }
  return payload;
}

async function videoRect(page) {
  const rect = await page.eval(`(() => { const r=document.querySelector('video')?.getBoundingClientRect(); return r && r.width>0 && r.height>0 ? {x:r.x,y:r.y,width:r.width,height:r.height} : null; })()`);
  if (!rect) throw new Error('Video has no visible rectangle');
  return rect;
}

async function screenshotDataUrl(page, clip) {
  const shot = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 82, fromSurface: true, clip: { ...clip, scale: 1 } });
  return `data:image/jpeg;base64,${shot.data}`;
}

function safeTargetBox(target) {
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  if (!target || ![target.x, target.y, target.width, target.height].every(finite)) return { x: 0, y: 0, width: 1, height: 1, fallback: true };
  const x = Math.max(0, Math.min(1, target.x));
  const y = Math.max(0, Math.min(1, target.y));
  const width = Math.max(0.01, Math.min(1 - x, target.width));
  const height = Math.max(0.01, Math.min(1 - y, target.height));
  return { x, y, width, height };
}

function focusClip(rect, point) {
  // Match the extension's 24% focus box around the click. The localization prompt
  // explicitly expects IMAGE 2 to be a magnified local view, not a duplicate frame.
  const size = 0.24;
  const x = Math.max(0, Math.min(1 - size, point.x - size / 2));
  const y = Math.max(0, Math.min(1 - size, point.y - size / 2));
  return {
    x: rect.x + rect.width * x,
    y: rect.y + rect.height * y,
    width: Math.max(1, rect.width * size),
    height: Math.max(1, rect.height * size),
  };
}

const { list: initialTargets, launched } = await ensureBrowser();
let pageTarget = initialTargets.find((target) => target.type === 'page' && /^https?:|about:blank/.test(target.url));
if (!pageTarget) throw new Error('No browser page target found.');
const page = await new Cdp(pageTarget.webSocketDebuggerUrl).open();
await page.send('Page.enable');
await page.send('Runtime.enable');
await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

const fixture = JSON.parse(await readFile(casesPath, 'utf8'));
const runs = [];

try {
  for (const testCase of fixture.cases.slice(0, caseLimit)) {
    console.error(`Spike 7: ${testCase.id} — ${testCase.selected_item}`);
    const started = Date.now();
    try {
      await page.send('Page.navigate', { url: testCase.source });
      await waitFor(async () => await page.eval(`document.readyState === 'complete' && !!document.querySelector('video')`), 30000, 'YouTube video did not become ready');
      await page.eval(`(() => { const v=document.querySelector('video'); v.pause(); v.currentTime=${Number(testCase.timestamp_s)}; return true; })()`);
      await waitFor(async () => await page.eval(`Math.abs((document.querySelector('video')?.currentTime ?? 0)-${Number(testCase.timestamp_s)}) < 1`), 12000, 'Could not seek video');
      await sleep(700);

      const rect = await videoRect(page);
      const frame = await screenshotDataUrl(page, rect);
      const point = { x: Number(testCase.selection?.x ?? 0.5), y: Number(testCase.selection?.y ?? 0.5) };

      let localization = null;
      let localizationFailure = null;
      let box = { x: 0, y: 0, width: 1, height: 1, fallback: true };
      try {
        const focusDataUrl = await screenshotDataUrl(page, focusClip(rect, point));
        localization = await postJson('locate-selection', { dataUrl: frame, focusDataUrl, point });
        box = safeTargetBox(localization);
      } catch (error) {
        localizationFailure = error.reason ?? error.message;
        console.error(`  localization fallback: ${error.message}${error.reason ? ` (${error.reason})` : ''}`);
      }

      const targetClip = {
        x: rect.x + rect.width * box.x,
        y: rect.y + rect.height * box.y,
        width: Math.max(1, rect.width * box.width),
        height: Math.max(1, rect.height * box.height),
      };
      const targetImage = await screenshotDataUrl(page, targetClip);
      const analysis = await postJson('analyze-selection', { dataUrl: targetImage });
      const title = await page.eval(`document.title.replace(/\\s*-\\s*YouTube\\s*$/i,'').trim()`);
      const commerce = await postJson('resolve-products', {
        description: analysis,
        context: { platform: 'youtube', title: title || null, url: testCase.source },
        source_image: targetImage,
      });

      if (!analysis?.provider_usage && !commerce?.cost_usage) {
        throw new Error('Spike 7 telemetry is missing from the deployed API. Redeploy the current spike-7-cost-measurement branch before rerunning.');
      }

      const latencyMs = Date.now() - started;
      const degraded = commerce?.state === 'TEMPORARILY_UNAVAILABLE';
      const analysisSummary = {
        category: analysis?.category ?? null,
        subcategory: analysis?.subcategory ?? null,
        brand: analysis?.brand_candidate ?? null,
        model: analysis?.model_candidate ?? null,
        color: analysis?.color ?? null,
      };
      const run = {
        case_id: testCase.id,
        selected_item: testCase.selected_item,
        failed: degraded,
        failure_class: degraded ? 'PROVIDER_BLOCKED' : undefined,
        localization_usage: localization?.provider_usage ?? null,
        localization_failure: localizationFailure,
        vision_usage: analysis?.provider_usage ?? null,
        analysis: analysisSummary,
        commerce_query: commerce?.query ?? null,
        verification_usage: commerce?.cost_usage?.verification_usage ?? null,
        verification: commerce?.verification ?? null,
        commerce_calls: commerce?.cost_usage?.commerce_calls ?? {},
        latency_ms: latencyMs,
        provider_blocked: degraded,
        providers_used: commerce?.providers_used ?? [],
        serpapi: commerce?.serpapi ?? null,
        brave: commerce?.brave ?? null,
        notes: `state=${commerce?.state ?? 'unknown'}; products=${commerce?.products?.length ?? 0}${box.fallback ? '; localization=fallback' : ''}`,
      };
      runs.push(run);
      console.error(`  ${latencyMs}ms · ${commerce?.state ?? 'unknown'} · ${commerce?.products?.length ?? 0} products · providers=${run.providers_used.join(',') || 'none'}`);
      console.error(`  localization=${box.fallback ? `fallback:${localizationFailure ?? 'unknown'}` : 'ok'}`);
      console.error(`  analysis=${JSON.stringify(analysisSummary)}`);
      console.error(`  commerce_query=${JSON.stringify(commerce?.query ?? null)}`);
      if (run.verification) console.error(`  verification=${JSON.stringify(run.verification)}`);
    } catch (error) {
      const latencyMs = Date.now() - started;
      console.error(`  FAILED after ${latencyMs}ms · ${error.message}`);
      runs.push({
        case_id: testCase.id,
        selected_item: testCase.selected_item,
        failed: true,
        failure_class: error.status === 429 || error.status === 503 ? 'PROVIDER_BLOCKED' : 'RUNNER_OR_API_FAILURE',
        localization_usage: null,
        vision_usage: null,
        verification_usage: null,
        verification: null,
        commerce_calls: {},
        latency_ms: latencyMs,
        provider_blocked: error.status === 429 || error.status === 503,
        notes: `runner/api failure: ${error.message}`,
      });
      if (String(error.message).includes('telemetry is missing')) break;
    }
    await sleep(400);
  }
} finally {
  page.close();
}

const successful = runs.filter((run) => !run.failed);
const record = {
  schema_version: 1,
  spike: '7',
  run_date: new Date().toISOString(),
  pricing_snapshot_date: '2026-09-16',
  browser_launched_by_runner: launched,
  runner_mode: 'direct-api-with-cdp-frame-capture',
  runs: successful,
  failed_runs: runs.filter((run) => run.failed),
  summary: { sample_size: successful.length, attempted: runs.length, failed: runs.length - successful.length },
};
await writeFile(outputPath, JSON.stringify(record, null, 2) + '\n');
console.log(`Wrote ${successful.length}/${runs.length} successful runs to ${outputPath}`);
if (successful.length < Math.min(8, caseLimit)) {
  console.error('Too few successful runs for a useful Spike 7 cost estimate.');
  process.exitCode = 1;
} else {
  console.log(`Next: pnpm cost:summary ${outputPath}`);
}
