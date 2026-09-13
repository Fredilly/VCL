import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadModule } from '../../api/tests/helpers/load-ts.mjs';

function setup({ src = 'http://localhost/video.webm', failSeek = false, failLoad = false, blank = false, duplicate = false, protectedMedia = false, timestamp = 10 } = {}) {
  const source = { currentSrc: src, mediaKeys: protectedMedia ? {} : null, isConnected: true, duration: 20, currentTime: 10, paused: false };
  const selection = { ok: true, dataUrl: 'primary', currentTime: timestamp, width: 100, height: 100, sourceWidth: 200, sourceHeight: 200,
    crop: { x: 20, y: 30, width: 100, height: 100 } };
  let draws = 0; let creates = 0; const seeks = []; const canvases = []; const timers = new Set();
  class Decoder extends EventTarget {
    duration = 20; videoWidth = 200; videoHeight = 200; mediaKeys = null;
    seekable = { length: 1, start: () => 0, end: () => 20 };
    time = 0; src = ''; removed = false;
    load() { if (this.src) queueMicrotask(() => this.dispatchEvent(new Event(failLoad ? 'error' : 'loadeddata'))); }
    set currentTime(value) { this.time = value; seeks.push(value); queueMicrotask(() => this.dispatchEvent(new Event(failSeek ? 'error' : 'seeked'))); }
    get currentTime() { return this.time; }
    removeAttribute() { this.src = ''; }
    remove() { this.removed = true; }
    play() { assert.fail('continuous playback is forbidden'); }
  }
  const decoder = new Decoder();
  const module = loadModule(new URL('../lib/nearby-frame-capture.ts', import.meta.url).pathname, {
    require: () => ({ selectionSource: () => ({ video: source, src }) }),
    location: { href: 'http://localhost/test', origin: 'http://localhost' },
    clearTimeout: (timer) => { timers.delete(timer); clearTimeout(timer); },
    setTimeout: (fn) => { const timer = setTimeout(fn, 50); timers.add(timer); return timer; },
    document: { createElement(tag) {
      creates++;
      if (tag === 'video') return decoder;
      const canvas = { width: 0, height: 0,
        getContext: () => ({ drawImage(...args) { draws++; assert.deepEqual(args.slice(1, 5), [20, 30, 100, 100]); },
          getImageData: () => ({ data: blank ? new Uint8Array(128) : Uint8Array.from({ length: 128 }, (_, i) => i) }) }),
        toDataURL: () => duplicate ? 'primary' : `crop-${decoder.time}` };
      canvases.push(canvas); return canvas;
    } },
  });
  return { ...module, source, decoder, selection, seeks, canvases, timers, stats: () => ({ draws, creates }) };
}

test('no capture occurs until explicit invocation; bounded previous/next without playing or changing the source', async () => {
  const s = setup();
  assert.deepEqual(s.stats(), { draws: 0, creates: 0 });
  const result = await s.captureNearbyFrames(s.selection, new AbortController().signal);
  assert.deepEqual(s.seeks, [9.5, 10.5]);
  assert.equal(result.frames.length, 2);
  assert.equal(result.frames[0].offset, -0.5);
  assert.equal(result.frames[1].offset, 0.5);
  assert.equal(s.source.currentTime, 10);
  assert.equal(s.source.paused, false);
  assert.equal(s.decoder.src, '');
  assert.equal(s.decoder.removed, true);
  assert.ok(s.canvases.every(c => c.width === 0 && c.height === 0));
  assert.equal(s.timers.size, 0);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(s.stats().draws, 2, 'no recurring scan');
});

test('load failure and nearby seek failure fall back without touching primary bytes', async () => {
  for (const options of [{ failLoad: true }, { failSeek: true }]) {
    const s = setup(options);
    const result = await s.captureNearbyFrames(s.selection, new AbortController().signal);
    assert.equal(result.frames.length, 0);
    assert.equal(s.selection.dataUrl, 'primary');
    assert.equal(s.decoder.src, '');
    assert.equal(s.timers.size, 0);
    assert.ok(s.seeks.length <= 1);
  }
});

test('protected, cross-origin and blob/MSE sources never create a decoder', async () => {
  for (const options of [{ protectedMedia: true }, { src: 'https://other.example/media.mp4' }, { src: 'blob:http://localhost/example' }]) {
    const s = setup(options);
    const result = await s.captureNearbyFrames(s.selection, new AbortController().signal);
    assert.equal(result.frames.length, 0);
    assert.deepEqual(s.stats(), { creates: 0, draws: 0 });
    assert.ok(result.limitation);
  }
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

test('closing/cancelling prevents further capture', async () => {
  const s = setup(); const controller = new AbortController(); controller.abort();
  assert.equal((await s.captureNearbyFrames(s.selection, controller.signal)).frames.length, 0);
  assert.equal(s.stats().creates, 0);
});

test('capture module has no frame persistence, stream recording or scanning APIs', async () => {
  const source = await readFile(new URL('../lib/nearby-frame-capture.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|chrome\.storage|browser\.storage|MediaRecorder|captureStream|setInterval|requestAnimationFrame|\.play\(/);
});
