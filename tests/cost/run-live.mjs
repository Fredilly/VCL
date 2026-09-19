import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const port = Number(process.env.VCL_CDP_PORT ?? 9334);
const apiOrigin = process.env.VCL_API_ORIGIN || 'https://api.vcl.article6.org';
const casesPath = process.env.VCL_COST_CASES ?? 'tests/manual/spike-5/cases.json';
const outputPath = process.env.VCL_COST_OUTPUT ?? 'tests/cost/run.json';
const profilePath = resolve(process.env.VCL_COST_PROFILE ?? '.tmp/vcl-cost-browser');
const caseLimit = Math.max(1, Number(process.env.VCL_COST_LIMIT ?? 10));
const caseOffset = Math.max(0, Number(process.env.VCL_COST_OFFSET ?? 0));
const caseIdFilter = process.env.VCL_COST_CASE_ID ?? null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logEvent = (event, testCase, details = {}) => console.error(JSON.stringify({ event, case_id: testCase?.id ?? null, at: new Date().toISOString(), ...details }));

async function targets() {
  try { return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); }
  catch { return null; }
}

function braveExecutable() {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : process.platform === 'win32'
      ? [
          `${process.env.PROGRAMFILES ?? 'C:/Program Files'}/BraveSoftware/Brave-Browser/Application/brave.exe`,
          `${process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)'}/BraveSoftware/Brave-Browser/Application/brave.exe`,
        ]
      : ['/usr/bin/brave-browser', '/usr/bin/brave', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
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
    ...(process.env.VCL_HEADLESS === '1' ? ['--headless=new', '--disable-gpu', '--no-sandbox'] : []),
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
  console.error(JSON.stringify({ event: 'API_REQUEST_STARTED', path, at: new Date().toISOString() }));
  let response;
  try {
    response = await fetch(`${apiOrigin}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    console.error(JSON.stringify({ event: timedOut ? 'API_REQUEST_TIMEOUT' : 'API_REQUEST_FAILED', path, at: new Date().toISOString(), error: error.message }));
    throw error;
  }
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(payload?.error ?? `${path} failed with HTTP ${response.status}`);
    error.status = response.status;
    error.reason = payload?.reason;
    throw error;
  }
  console.error(JSON.stringify({ event: 'API_REQUEST_COMPLETED', path, status: response.status, at: new Date().toISOString() }));
  return payload;
}

async function videoRect(page) {
  const rect = await page.eval(`(() => {
    const player = document.querySelector('.html5-video-player');
    if (!player) return null;
    const r = player.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return null;
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  if (!rect) throw new Error('Video player has no visible rectangle');
  const layout = await page.send('Page.getLayoutMetrics');
  const scrollX = layout.cssLayoutViewport.pageX;
  const scrollY = layout.cssLayoutViewport.pageY;
  return {
    x: rect.x + scrollX,
    y: rect.y + scrollY,
    width: rect.width,
    height: rect.height,
  };
}

async function assertPlayableVideo(page) {
  const status = await page.eval(`(() => {
    const v = document.querySelector('video');
    const visibleError = [...document.querySelectorAll('.ytp-error, .ytp-error-content-wrap, #error-screen')]
      .some(el => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      });
    return {
      hasVideo: Boolean(v),
      visibleError,
      mediaError: v?.error?.code ?? null,
      currentSrc: v?.currentSrc ?? '',
      readyState: v?.readyState ?? 0
    };
  })()`);

  if (!status.hasVideo || status.visibleError || status.mediaError || !status.currentSrc) {
    throw new Error(`YouTube video is not playable in the CDP browser: ${JSON.stringify(status)}. No model or commerce calls were made.`);
  }
}

async function screenshotDataUrl(page, clip) {
  const shot = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 82, clip: { ...clip, scale: 1 } });
  return `data:image/jpeg;base64,${shot.data}`;
}

async function hideOverlays(page) {
  await page.eval(`(() => {
    const selectors = [
      '.ytp-large-play-button',
      '.ytp-chrome-top',
      '.ytp-chrome-bottom',
      '.ytp-gradient-top',
      '.ytp-gradient-bottom',
      '.ytp-pause-overlay',
      '.ytp-cued-thumbnail-overlay',
      '.ytp.endscreen',
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('opacity', '0', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      }
    }
    const player = document.querySelector('.html5-video-player');
    if (player) player.classList.remove('ytp-autohide');
  })()`);
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
const allCases = fixture.cases;
const targetCases = caseIdFilter
  ? allCases.filter((c) => c.id === caseIdFilter)
  : allCases.slice(caseOffset, caseOffset + caseLimit);
if (targetCases.length === 0) throw new Error(`No cases matched offset=${caseOffset} limit=${caseLimit} id=${caseIdFilter}`);
const runs = [];

try {
  for (const testCase of targetCases) {
    console.error(`Spike 7: ${testCase.id} — ${testCase.selected_item}`);
    logEvent('FIXTURE_OPEN', testCase, { source: testCase.source, timestamp_s: testCase.timestamp_s });
    const started = Date.now();
    try {
      const currentUrl = await page.eval(`location.href`);
      const currentVideoId = new URL(currentUrl).searchParams.get('v');
      const targetVideoId = new URL(testCase.source).searchParams.get('v');
      if (currentVideoId !== targetVideoId) {
        await page.send('Page.navigate', { url: testCase.source });
        await waitFor(async () => {
          const url = await page.eval(`location.href`);
          return new URL(url).searchParams.get('v') === targetVideoId;
        }, 30000, `SPA navigation did not settle to video ${targetVideoId}`);
        await page.send('Runtime.evaluate', { expression: 'window.scrollTo(0, 0)', returnByValue: true });
      }
      await waitFor(async () => await page.eval(`(() => {
        const v = document.querySelector('video');
        const adShowing = document.querySelector('.html5-video-player')?.classList.contains('ad-showing');
        return document.readyState === 'complete'
          && !!v
          && !adShowing
          && !!v.currentSrc
          && v.readyState >= 2
          && v.videoWidth > 0
          && v.videoHeight > 0
          && Number.isFinite(v.duration)
          && v.duration > ${Number(testCase.timestamp_s) + 1};
      })()`), 60000, 'Actual YouTube video did not become ready or an ad is still playing');
      await assertPlayableVideo(page);
      logEvent('VIDEO_READY', testCase, { url: await page.eval('location.href') });
      await sleep(Number(process.env.VCL_COST_STABILIZE_MS ?? 1500));
      const loadedVideoId = await page.eval(`new URL(location.href).searchParams.get('v')`);
      if (loadedVideoId !== targetVideoId) {
        throw new Error(`Video ID mismatch: loaded=${loadedVideoId} expected=${targetVideoId}`);
      }
      const targetTs = Number(testCase.timestamp_s);
      await page.eval(`(() => { const v=document.querySelector('video'); v.currentTime=${targetTs}; v.pause(); return true; })()`);
      await waitFor(async () => await page.eval(`Math.abs((document.querySelector('video')?.currentTime ?? 0)-${targetTs}) < 1`), 12000, 'Could not seek video');
      await waitFor(async () => await page.eval(`(() => {
        const v = document.querySelector('video');
        if (!v || v.readyState < 2) return false;
        const t = ${targetTs};
        for (let i = 0; i < v.buffered.length; i++) {
          if (v.buffered.start(i) <= t && v.buffered.end(i) > t) return true;
        }
        return false;
      })()`), 20000, 'Video buffer did not reach target timestamp');
      await page.eval(`(() => { const v=document.querySelector('video'); v.play().catch(()=>{}); return true; })()`);
      await sleep(1500);
      await page.eval(`(() => { const v=document.querySelector('video'); v.pause(); v.currentTime=${targetTs}; return true; })()`);
      await waitFor(async () => await page.eval(`Math.abs((document.querySelector('video')?.currentTime ?? 0)-${targetTs}) < 1`), 5000, 'Could not re-seek after play burst');
      await sleep(500);
      await assertPlayableVideo(page);
      const finalTime = await page.eval(`document.querySelector('video')?.currentTime ?? -1`);
      if (Math.abs(finalTime - targetTs) >= 1) {
        throw new Error(`Seek drifted: current=${finalTime} target=${targetTs}`);
      }
      await hideOverlays(page);
      await page.send('Runtime.evaluate', { expression: 'window.scrollTo(0, 0)', returnByValue: true });
      await sleep(100);
      await hideOverlays(page);

      const rect = await videoRect(page);
      const frame = await screenshotDataUrl(page, rect);
      if (!frame?.startsWith('data:image/')) throw new Error('Frame capture did not return an image');
      logEvent('FRAME_READY', testCase, { timestamp_s: finalTime, width: rect.width, height: rect.height });

      if (process.env.VCL_COST_DEBUG_FRAME === '1') {
        await writeFile(
          'tests/cost/debug-frame.jpg',
          Buffer.from(frame.split(',')[1], 'base64')
        );
        console.error(`  DEBUG videoRect=${JSON.stringify(rect)}`);
        console.error('  Wrote tests/cost/debug-frame.jpg — no model calls made.');
        break;
      }

      const point = { x: Number(testCase.selection?.x ?? 0.5), y: Number(testCase.selection?.y ?? 0.5) };
      logEvent('SCOOP_INVOKED', testCase, { selection: point, invocation: 'direct-api-runner' });

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
        result_classes: (commerce?.products ?? []).map((product) => product.result_class).filter(Boolean),
        jev_router: commerce?.jev_router ?? null,
        timing: commerce?.timing ?? null,
        commerce_calls: commerce?.cost_usage?.commerce_calls ?? {},
        latency_ms: latencyMs,
        provider_blocked: degraded,
        providers_used: commerce?.providers_used ?? [],
        serpapi: commerce?.serpapi ?? null,
        brave: commerce?.brave ?? null,
        notes: `state=${commerce?.state ?? 'unknown'}; products=${commerce?.products?.length ?? 0}${box.fallback ? '; localization=fallback' : ''}`,
      };
      runs.push(run);
      await writeFile(outputPath, JSON.stringify({ schema_version: 1, spike: '7', run_date: new Date().toISOString(), runs, summary: { attempted: runs.length, successful: runs.filter((r) => !r.failed).length, failed: runs.filter((r) => r.failed).length } }, null, 2) + '\n');
      logEvent('ARTIFACT_WRITTEN', testCase, { outputPath });
      logEvent('FIXTURE_COMPLETE', testCase, { failed: Boolean(run.failed), latency_ms: latencyMs });
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
        result_classes: [],
        jev_router: null,
        timing: null,
        commerce_calls: {},
        latency_ms: latencyMs,
        provider_blocked: error.status === 429 || error.status === 503,
        notes: `runner/api failure: ${error.message}`,
      });
      await writeFile(outputPath, JSON.stringify({ schema_version: 1, spike: '7', run_date: new Date().toISOString(), runs, summary: { attempted: runs.length, successful: runs.filter((r) => !r.failed).length, failed: runs.filter((r) => r.failed).length } }, null, 2) + '\n');
      logEvent('ARTIFACT_WRITTEN', testCase, { outputPath, failure_class: runs.at(-1).failure_class });
      logEvent('FIXTURE_COMPLETE', testCase, { failed: true, latency_ms: latencyMs });
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
if (successful.length < Math.min(8, targetCases.length)) {
  console.error('Too few successful runs for a useful Spike 7 cost estimate.');
  process.exitCode = 1;
} else {
  console.log(`Next: pnpm cost:summary ${outputPath}`);
}
