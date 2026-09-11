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

export function findPrimaryVisibleVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
  return videos
    .map((video) => ({ video, area: visibleArea(video) }))
    .filter(({ area }) => area > 0)
    .sort((a, b) => b.area - a.area)[0]?.video ?? null;
}

function ensureReady(video: HTMLVideoElement): FrameCaptureResult | null {
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
  cropFraction = 0.34,
  maxDimension = 640,
): FrameCaptureResult {
  const video = findPrimaryVisibleVideo();
  if (!video) return { ok: false, code: 'NO_VIDEO', message: 'No visible HTML5 video was found on this page.' };
  const notReady = ensureReady(video);
  if (notReady) return notReady;

  const rect = video.getBoundingClientRect();
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const displayScale = Math.min(rect.width / sourceWidth, rect.height / sourceHeight);
  const displayedWidth = sourceWidth * displayScale;
  const displayedHeight = sourceHeight * displayScale;
  const contentLeft = rect.left + (rect.width - displayedWidth) / 2;
  const contentTop = rect.top + (rect.height - displayedHeight) / 2;

  if (clientX < contentLeft || clientX > contentLeft + displayedWidth || clientY < contentTop || clientY > contentTop + displayedHeight) {
    return {
      ok: false,
      code: 'CLICK_OUTSIDE_VIDEO',
      message: 'Click directly on the visible video image, not the surrounding page or letterbox area.',
    };
  }

  const clickX = Math.min(sourceWidth - 1, Math.max(0, (clientX - contentLeft) / displayScale));
  const clickY = Math.min(sourceHeight - 1, Math.max(0, (clientY - contentTop) / displayScale));
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
    return {
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
  } catch (error) {
    return captureError(error);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
