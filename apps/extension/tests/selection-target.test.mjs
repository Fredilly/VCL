import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from '../../api/tests/helpers/load-ts.mjs';

// The same scene has a small foreground object and a much larger surrounding
// object. Expected boxes are geometry fixtures, not production category rules.
const scene = {
  sourceWidth: 1000, sourceHeight: 1000,
  small: { x: 0.47, y: 0.45, width: 0.08, height: 0.12, confidence: 0.95 },
  large: { x: 0.05, y: 0.05, width: 0.9, height: 0.9, confidence: 0.95 },
};
function setup(clickX = 510, clickY = 510) {
  const draws = []; const canvases = [];
  const video = { currentTime: 999 };
  const selection = { ok: true, dataUrl: 'frozen-frame', width: 1000, height: 1000, sourceWidth: 1000, sourceHeight: 1000,
    currentTime: 10, paused: true, crop: { x: 0, y: 0, width: 1000, height: 1000, clickX, clickY } };
  const module = loadModule(new URL('../lib/frame-capture.ts', import.meta.url).pathname, {
    Image: class { src = ''; async decode() {} },
    document: { createElement() {
      const canvas = { width: 0, height: 0, getContext: () => ({ drawImage(image, ...args) { draws.push({ src: image.src, args }); } }),
        toDataURL: () => `crop-${canvas.width}x${canvas.height}` };
      canvases.push(canvas); return canvas;
    } },
  });
  return { ...module, selection, video, draws, canvases };
}

test('small target surrounded by a larger salient object is cropped to the click-selected extent', async () => {
  const s = setup();
  const selected = await s.cropFrozenSelection(s.selection, s.validatedTargetBox(scene.small, s.selection));
  assert.ok(selected.width < 100 && selected.height < 140, 'large surrounding object is excluded');
  assert.equal(selected.crop.clickX, 510);
  assert.equal(selected.crop.clickY, 510);
  assert.equal(selected.currentTime, 10, 'uses frozen clicked frame even if playback changed');
  assert.equal(s.draws[0].src, 'frozen-frame');
  assert.ok(s.canvases.every(c => c.width === 0 && c.height === 0));
});

test('the same geometry path retains a large clicked object rather than forcing a tiny crop', async () => {
  const s = setup(150, 200);
  const selected = await s.cropFrozenSelection(s.selection, s.validatedTargetBox(scene.large, s.selection));
  assert.ok(selected.width > 900 && selected.height > 900);
  assert.equal(selected.crop.clickX, 150);
  assert.equal(selected.crop.clickY, 200);
});

test('off-center clicks survive clamping; a box around another object is refused', () => {
  const s = setup(980, 30);
  assert.deepEqual(JSON.parse(JSON.stringify(s.selectionPoint(s.selection))), { x: 0.98, y: 0.03 });
  const focus = s.focusBox(s.selection);
  assert.ok(focus.x <= 0.98 && focus.x + focus.width >= 0.98);
  assert.ok(focus.y <= 0.03 && focus.y + focus.height >= 0.03);
  assert.throws(() => s.validatedTargetBox(scene.small, s.selection));
  assert.throws(() => s.validatedTargetBox({ ...scene.large, confidence: 0.5 }, s.selection));
  assert.throws(() => s.validatedTargetBox({ ...scene.large, width: NaN }, s.selection));
});

test('a smaller video under the click wins over an unrelated large visible player', () => {
  const video = (left, top, width, height) => ({
    videoWidth: 640, videoHeight: 480, readyState: 4, currentTime: 1, paused: true, currentSrc: 'same-origin',
    getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }),
  });
  const large = video(0, 0, 800, 600); const small = video(850, 0, 200, 150);
  let drawn;
  const module = loadModule(new URL('../lib/frame-capture.ts', import.meta.url).pathname, {
    HTMLMediaElement: { HAVE_CURRENT_DATA: 2 }, window: { innerWidth: 1200, innerHeight: 900 },
    getComputedStyle: () => ({ opacity: '1', visibility: 'visible', display: 'block' }),
    document: { querySelectorAll: () => [large, small], createElement: () => ({
      width: 0, height: 0, getContext: () => ({ drawImage(v) { drawn = v; } }), toDataURL: () => 'pixels',
    }) },
  });
  const result = module.captureSelectionAtClientPoint(950, 75);
  assert.equal(result.ok, true);
  assert.equal(drawn, small);
});

test('click coordinates follow object-fit cover rather than treating clipped pixels as letterboxing', () => {
  const video = {
    videoWidth: 1600, videoHeight: 900, readyState: 4, currentTime: 1, paused: true, currentSrc: 'same-origin',
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800, right: 800, bottom: 800 }),
  };
  const module = loadModule(new URL('../lib/frame-capture.ts', import.meta.url).pathname, {
    HTMLMediaElement: { HAVE_CURRENT_DATA: 2 }, window: { innerWidth: 1200, innerHeight: 900 },
    getComputedStyle: () => ({ opacity: '1', visibility: 'visible', display: 'block', objectFit: 'cover', objectPosition: '50% 50%' }),
    document: { querySelectorAll: () => [video], createElement: () => ({
      width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: () => 'pixels',
    }) },
  });
  const result = module.captureSelectionAtClientPoint(400, 400);
  assert.equal(result.ok, true);
  assert.equal(result.crop.clickX, 800, 'the centre client point maps to the centre decoded pixel');
  assert.equal(result.crop.clickY, 450);
});
