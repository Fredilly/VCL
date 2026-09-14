import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadModule } from '../../api/tests/helpers/load-ts.mjs';

function setup({ src = 'http://localhost/video.webm', failSeek = false, failLoad = false, blank = false,
  duplicate = false, protectedMedia = false, timestamp = 10, paused = true, tainted = false,
  staleFrame = false, missingFrame = false, onSeek, onDraw, failRestore = false } = {}) {
  let draws = 0; let creates = 0; const seeks = []; const canvases = []; const timers = new Set();
  class Video extends EventTarget {
    duration = 20; videoWidth = 200; videoHeight = 200; mediaKeys = protectedMedia ? {} : null;
    currentSrc = src; isConnected = true; paused = paused; seeking = false;
    seekable = { length: 1, start: () => 0, end: () => 20 };
    time = timestamp; src = ''; removed = false; callbacks = new Map(); nextId = 0;
    load() { if (this.src) queueMicrotask(() => this.dispatchEvent(new Event(failLoad ? 'error' : 'loadeddata'))); }
    requestVideoFrameCallback(callback) { const id = ++this.nextId; this.callbacks.set(id, callback); return id; }
    cancelVideoFrameCallback(id) { this.callbacks.delete(id); }
    present(time) { for (const [id, cb] of [...this.callbacks]) { this.callbacks.delete(id); cb(0, { mediaTime: time }); } }
    set currentTime(value) {
      this.time = value; this.seeking = true; seeks.push(value);
      queueMicrotask(() => {
        this.dispatchEvent(new Event('seeking'));
        onSeek?.(this, value);
        if ((failSeek && value !== timestamp) || (failRestore && value === timestamp)) {
          this.dispatchEvent(new Event('error')); return;
        }
        this.seeking = false;
        this.dispatchEvent(new Event('seeked'));
        if (staleFrame) this.present(value - 1);
        if (!missingFrame) this.present(value);
      });
    }
    get currentTime() { return this.time; }
    removeAttribute() { this.src = ''; }
    remove() { this.removed = true; }
    play() { assert.fail('continuous playback is forbidden'); }
  }
  const source = new Video(); const decoder = new Video();
  const selection = { ok: true, dataUrl: 'primary', currentTime: timestamp, width: 100, height: 100, sourceWidth: 200, sourceHeight: 200,
    crop: { x: 20, y: 30, width: 100, height: 100 } };
  const module = loadModule(new URL('../lib/nearby-frame-capture.ts', import.meta.url).pathname, {
    require: () => ({ selectionSource: () => ({ video: source, src }) }),
    EventTarget, Event, AbortController,
    location: { href: 'http://localhost/test', origin: 'http://localhost' },
    clearTimeout: (timer) => { timers.delete(timer); clearTimeout(timer); },
    setTimeout: (fn) => { const timer = setTimeout(fn, 50); timers.add(timer); return timer; },
    document: { createElement(tag) {
      creates++;
      if (tag === 'video') return decoder;
      let sampled;
      const canvas = { width: 0, height: 0,
        getContext: () => ({ drawImage(video, ...args) { draws++; sampled = video; onDraw?.(); assert.deepEqual(args.slice(0, 4), [20, 30, 100, 100]); },
          getImageData: () => { if (tainted) throw new DOMException('Blocked', 'SecurityError');
            return { data: blank ? new Uint8Array(128) : Uint8Array.from({ length: 128 }, (_, i) => i) }; } }),
        toDataURL: () => duplicate ? 'primary' : `crop-${sampled.time}` };
      canvases.push(canvas); return canvas;
    } },
  });
  return { ...module, source, decoder, selection, seeks, canvases, timers, stats: () => ({ draws, creates }) };
}

test('same-origin detached capture is opt-in, bounded and preserves the user player', async () => {
  const s = setup({ paused: false });
  assert.deepEqual(s.stats(), { draws: 0, creates: 0 });
  const result = await s.captureNearbyFrames(s.selection, new AbortController().signal);
  assert.deepEqual(s.seeks, [9.5, 10.5]);
  assert.equal(result.frames.length, 2);
  assert.equal(result.mode, 'detached');
  assert.equal(s.source.currentTime, 10);
  assert.equal(s.source.paused, false);
  assert.equal(s.decoder.src, '');
  assert.equal(s.decoder.removed, true);
  assert.ok(s.canvases.every(c => c.width === 0 && c.height === 0));
  assert.equal(s.timers.size, 0);
});

test('ordinary MSE/blob and readable cross-origin media use the existing paused player and restore it', async () => {
  for (const src of ['blob:http://localhost/mse', 'https://cdn.example/media.mp4']) {
    const s = setup({ src, staleFrame: true });
    const result = await s.captureNearbyFrames(s.selection, new AbortController().signal);
    assert.equal(result.mode, 'player');
    assert.equal(result.frames.length, 2);
    assert.deepEqual(s.seeks, [9.5, 10.5, 10]);
    assert.deepEqual(Array.from(result.frames, f => f.timestamp), [9.5, 10.5]);
    assert.equal(result.restored, true);
    assert.equal(s.source.paused, true);
    assert.equal(s.source.currentTime, 10);
    assert.equal(s.stats().creates, 2, 'only canvases; never copy an MSE URL into another player');
    assert.equal(s.source.callbacks.size, 0);
    assert.equal(s.timers.size, 0);
  }
});

test('load, seek, presentation and canvas-security failures preserve the selected image', async () => {
  for (const options of [{ failLoad: true }, { failSeek: true }, { missingFrame: true },
    { src: 'blob:http://localhost/mse', failSeek: true }, { src: 'blob:http://localhost/mse', tainted: true }]) {
    const s = setup(options);
    const result = await s.captureNearbyFrames(s.selection, new AbortController().signal);
    assert.equal(result.frames.length, 0);
    assert.equal(s.selection.dataUrl, 'primary');
    assert.equal(s.source.currentTime, 10);
    assert.equal(s.timers.size, 0);
    assert.equal(s.decoder.callbacks.size, 0);
    assert.equal(s.source.callbacks.size, 0);
  }
});

test('DRM and live sources are refused before capture; an unpaused MSE player is not hijacked', async () => {
  for (const options of [{ protectedMedia: true }, { src: 'blob:http://localhost/mse', paused: false }]) {
    const s = setup(options);
    const result = await s.captureNearbyFrames(s.selection, new AbortController().signal);
    assert.equal(result.frames.length, 0);
    assert.deepEqual(s.stats(), { creates: 0, draws: 0 });
    assert.ok(result.limitation);
    assert.equal(s.seeks.length, 0);
  }
  const s = setup(); s.source.duration = Infinity;
  assert.equal((await s.captureNearbyFrames(s.selection, new AbortController().signal)).limitation, 'live_or_stream_source');
});

test('range boundaries, duplicates and blank crops minimize uploads', async () => {
  const s = setup({ timestamp: 0.1 });
  assert.equal((await s.captureNearbyFrames(s.selection, new AbortController().signal)).frames.length, 1);
  assert.deepEqual(s.seeks, [0.6]);
  for (const options of [{ duplicate: true }, { blank: true }]) {
    const empty = setup(options);
    assert.equal((await empty.captureNearbyFrames(empty.selection, new AbortController().signal)).frames.length, 0);
  }
});

test('cancellation before and during capture stops work and still restores an owned seek', async () => {
  const controller = new AbortController();
  const s = setup({ src: 'blob:http://localhost/mse', onDraw: () => controller.abort() });
  const result = await s.captureNearbyFrames(s.selection, controller.signal);
  assert.equal(result.frames.length, 0);
  assert.deepEqual(s.seeks, [9.5, 10]);
  assert.equal(result.restored, true);
  const before = setup();
  assert.equal((await before.captureNearbyFrames(before.selection, controller.signal)).frames.length, 0);
  assert.equal(before.stats().creates, 0);
});

test('user playback changes take priority over restoration and discard captured evidence', async () => {
  const s = setup({ src: 'blob:http://localhost/mse', onSeek(video, value) {
    if (value === 9.5) { video.time = 7; video.paused = false; video.dispatchEvent(new Event('play')); }
  } });
  assert.equal((await s.captureNearbyFrames(s.selection, new AbortController().signal)).frames.length, 0);
  assert.equal(s.source.currentTime, 7);
  assert.equal(s.source.paused, false);
  assert.deepEqual(s.seeks, [9.5]);
});

test('failed restoration discards evidence and exposes a graceful fallback reason', async () => {
  const s = setup({ src: 'blob:http://localhost/mse', failRestore: true });
  const result = await s.captureNearbyFrames(s.selection, new AbortController().signal);
  assert.equal(result.frames.length, 0);
  assert.equal(result.restored, false);
  assert.equal(result.limitation, 'playback_restore_failed');
});

test('capture has no persistence, stream extraction or recurring scan', async () => {
  const source = await readFile(new URL('../lib/nearby-frame-capture.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|chrome\.storage|browser\.storage|MediaRecorder|captureStream|setInterval|requestAnimationFrame|\.play\(/);
});
