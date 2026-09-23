export type FrameCaptureFailureCode =
  | 'NO_VIDEO'
  | 'VIDEO_NOT_READY'
  | 'CLICK_OUTSIDE_VIDEO'
  | 'CAPTURE_BLOCKED'
  | 'CAPTURE_FAILED';

export type FrameCaptureResult =
  | {
      ok: true;
      dataUrl: string;
      width: number;
      height: number;
      sourceWidth: number;
      sourceHeight: number;
      currentTime: number;
      paused: boolean;
      crop?: {
        x: number;
        y: number;
        width: number;
        height: number;
        clickX: number;
        clickY: number;
      };
    }
  | {
      ok: false;
      code: FrameCaptureFailureCode;
      message: string;
    };

// In-memory source binding only; neither media URLs nor pixels are persisted.
const selectionSources = new WeakMap<object, { video: HTMLVideoElement; src: string }>();
export function selectionSource(selection: object) { return selectionSources.get(selection); }

type Selection = Extract<FrameCaptureResult, { ok: true }>;
export type SelectionBox = { x: number; y: number; width: number; height: number };

export function selectionPoint(selection: Selection) {
  const crop = selection.crop;
  if (!crop) throw new Error('The click position is unavailable. Select the object again.');
  return { x: (crop.clickX - crop.x) / crop.width, y: (crop.clickY - crop.y) / crop.height };
}

export function focusBox(selection: Selection): SelectionBox {
  const point = selectionPoint(selection);
  const size = 0.24;
  return { x: Math.max(0, Math.min(1 - size, point.x - size / 2)),
    y: Math.max(0, Math.min(1 - size, point.y - size / 2)), width: size, height: size };
}

// Crop the frozen selected pixels, not whatever frame the video displays after
// the localization request. Keep absolute source coordinates for nearby frames.
export async function cropFrozenSelection(selection: Selection, box: SelectionBox): Promise<Selection> {
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.x < 0 || box.y < 0 ||
    box.width <= 0 || box.height <= 0 || box.x + box.width > 1.001 || box.y + box.height > 1.001 || !selection.crop) {
    throw new Error('Invalid target crop');
  }
  const image = new Image(); image.src = selection.dataUrl;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(selection.width * box.width));
  canvas.height = Math.max(1, Math.round(selection.height * box.height));
  try {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas rendering is unavailable');
    context.drawImage(image, box.x * selection.width, box.y * selection.height,
      box.width * selection.width, box.height * selection.height, 0, 0, canvas.width, canvas.height);
    const crop = selection.crop;
    const result: Selection = { ...selection, width: canvas.width, height: canvas.height,
      dataUrl: canvas.toDataURL('image/jpeg', 0.9),
      crop: { ...crop, x: crop.x + box.x * crop.width, y: crop.y + box.y * crop.height,
        width: box.width * crop.width, height: box.height * crop.height } };
    const source = selectionSource(selection);
    if (source) selectionSources.set(result, source);
    return result;
  } finally { canvas.width = 0; canvas.height = 0; image.src = ''; }
}

export function validatedTargetBox(value: unknown, selection: Selection): SelectionBox {
  const b = value as SelectionBox & { confidence: number };
  const point = selectionPoint(selection);
  if (!b || ![b.x, b.y, b.width, b.height, b.confidence].every(Number.isFinite) || b.confidence < 0.8 || b.confidence > 1 ||
    b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0 || b.x + b.width > 1.001 || b.y + b.height > 1.001 ||
    point.x < b.x || point.y < b.y || point.x > b.x + b.width || point.y > b.y + b.height) {
    throw new Error('Could not isolate the clicked object. Adjust the crop and try again.');
  }
  // Small proportional padding retains boundaries without expanding back to the
  // surrounding scene. The same rule applies to every object size/category.
  const x = Math.max(0, b.x - b.width * 0.04); const y = Math.max(0, b.y - b.height * 0.04);
  return { x, y, width: Math.min(1, b.x + b.width * 1.04) - x, height: Math.min(1, b.y + b.height * 1.04) - y };
}

function visibleArea(video: HTMLVideoElement): number {
  const rect = video.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return 0;

  const style = getComputedStyle(video);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return 0;

  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function objectPositionOffset(value: string | undefined, freeSpace: number): number {
  if (!value) return freeSpace / 2;
  if (value.endsWith('%')) {
    const percent = Number.parseFloat(value);
    return Number.isFinite(percent) ? freeSpace * percent / 100 : freeSpace / 2;
  }
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? pixels : freeSpace / 2;
}

// Map client coordinates to the decoded video pixels. Replaced video elements may
// use object-fit: cover/none/scale-down, so rect/source aspect-ratio math alone
// is not reliable outside the common contain layout.
export function displayedVideoBounds(video: HTMLVideoElement) {
  const rect = video.getBoundingClientRect();
  const style = getComputedStyle(video);
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const fit = style.objectFit || 'fill';
  const contain = Math.min(rect.width / sourceWidth, rect.height / sourceHeight);
  const cover = Math.max(rect.width / sourceWidth, rect.height / sourceHeight);
  const scale = fit === 'cover' ? cover : fit === 'none' ? 1 : fit === 'scale-down' ? Math.min(1, contain) : contain;
  const width = fit === 'fill' ? rect.width : sourceWidth * scale;
  const height = fit === 'fill' ? rect.height : sourceHeight * scale;
  const position = (style.objectPosition || '50% 50%').trim().split(/\s+/);
  const left = rect.left + objectPositionOffset(position[0], rect.width - width);
  const top = rect.top + objectPositionOffset(position[1] ?? position[0], rect.height - height);
  return { left, top, width, height, scaleX: sourceWidth / width, scaleY: sourceHeight / height };
}

export function findPrimaryVisibleVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
  return videos
    .map((video) => ({ video, area: visibleArea(video) }))
    .filter(({ area }) => area > 0)
    .sort((a, b) => b.area - a.area)[0]?.video ?? null;
}

function ensureReady(video: HTMLVideoElement): FrameCaptureResult | null {
  if (video.mediaKeys) return { ok: false, code: 'CAPTURE_BLOCKED', message: 'Protected video is unsupported.' };
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0 || video.videoHeight === 0) {
    return { ok: false, code: 'VIDEO_NOT_READY', message: 'The video is present but its current frame is not ready yet.' };
  }
  return null;
}

function captureError(error: unknown): FrameCaptureResult {
  const blocked = error instanceof DOMException && error.name === 'SecurityError';
  return {
    ok: false,
    code: blocked ? 'CAPTURE_BLOCKED' : 'CAPTURE_FAILED',
    message: blocked
      ? 'Direct frame capture is blocked for this video by browser or origin protections.'
      : `Frame capture failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  };
}

export function capturePrimaryVideoFrame(maxDimension = 1280): FrameCaptureResult {
  const video = findPrimaryVisibleVideo();
  if (!video) return { ok: false, code: 'NO_VIDEO', message: 'No visible HTML5 video was found on this page.' };
  const notReady = ensureReady(video);
  if (notReady) return notReady;

  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return { ok: false, code: 'CAPTURE_FAILED', message: 'Canvas rendering is unavailable in this browser context.' };

  try {
    context.drawImage(video, 0, 0, width, height);
    return {
      ok: true,
      dataUrl: canvas.toDataURL('image/jpeg', 0.86),
      width,
      height,
      sourceWidth,
      sourceHeight,
      currentTime: video.currentTime,
      paused: video.paused,
    };
  } catch (error) {
    return captureError(error);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function captureSelectionAtClientPoint(
  clientX: number,
  clientY: number,
  cropFraction = 0.5,
  maxDimension = 640,
): FrameCaptureResult {
  // A smaller video under the click wins over a larger player elsewhere.
  const video = Array.from(document.querySelectorAll<HTMLVideoElement>('video')).filter(v => {
    const r = v.getBoundingClientRect();
    return visibleArea(v) > 0 && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }).sort((a, b) => visibleArea(a) - visibleArea(b))[0];
  if (!video) return { ok: false, code: 'NO_VIDEO', message: 'No visible HTML5 video was found on this page.' };
  const notReady = ensureReady(video);
  if (notReady) return notReady;

  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const displayed = displayedVideoBounds(video);

  if (clientX < displayed.left || clientX > displayed.left + displayed.width || clientY < displayed.top || clientY > displayed.top + displayed.height) {
    return {
      ok: false,
      code: 'CLICK_OUTSIDE_VIDEO',
      message: 'Click directly on the visible video image, not the surrounding page or letterbox area.',
    };
  }

  const clickX = Math.min(sourceWidth - 1, Math.max(0, (clientX - displayed.left) * displayed.scaleX));
  const clickY = Math.min(sourceHeight - 1, Math.max(0, (clientY - displayed.top) * displayed.scaleY));
  const cropSize = Math.max(96, Math.round(Math.min(sourceWidth, sourceHeight) * cropFraction));
  const cropWidth = Math.min(sourceWidth, cropSize);
  const cropHeight = Math.min(sourceHeight, cropSize);
  const x = Math.round(Math.min(sourceWidth - cropWidth, Math.max(0, clickX - cropWidth / 2)));
  const y = Math.round(Math.min(sourceHeight - cropHeight, Math.max(0, clickY - cropHeight / 2)));
  const outputScale = Math.min(1, maxDimension / Math.max(cropWidth, cropHeight));
  const width = Math.max(1, Math.round(cropWidth * outputScale));
  const height = Math.max(1, Math.round(cropHeight * outputScale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return { ok: false, code: 'CAPTURE_FAILED', message: 'Canvas rendering is unavailable in this browser context.' };

  try {
    context.drawImage(video, x, y, cropWidth, cropHeight, 0, 0, width, height);
    const result: FrameCaptureResult = {
      ok: true,
      dataUrl: canvas.toDataURL('image/jpeg', 0.9),
      width,
      height,
      sourceWidth,
      sourceHeight,
      currentTime: video.currentTime,
      paused: video.paused,
      crop: { x, y, width: cropWidth, height: cropHeight, clickX: Math.round(clickX), clickY: Math.round(clickY) },
    };
    selectionSources.set(result, { video, src: video.currentSrc });
    return result;
  } catch (error) {
    return captureError(error);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}


export function validatedAutoFocusBox(value: unknown, selection: Selection): SelectionBox | null {
  const b = value as SelectionBox & { confidence: number };
  const point = selectionPoint(selection);
  if (!b || ![b.x, b.y, b.width, b.height, b.confidence].every(Number.isFinite) ||
    b.confidence < 0.92 || b.confidence > 1 || b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0 ||
    b.x + b.width > 1.001 || b.y + b.height > 1.001 ||
    point.x < b.x || point.y < b.y || point.x > b.x + b.width || point.y > b.y + b.height) return null;

  const area = b.width * b.height;
  if (area < 0.006 || area > 0.85 || b.width < 0.06 || b.height < 0.06) return null;

  const padX = b.width * 0.14;
  const padY = b.height * 0.14;
  const x = Math.max(0, b.x - padX);
  const y = Math.max(0, b.y - padY);
  const right = Math.min(1, b.x + b.width + padX);
  const bottom = Math.min(1, b.y + b.height + padY);
  return { x, y, width: right - x, height: bottom - y };
}
