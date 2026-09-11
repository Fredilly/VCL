export type FrameCaptureFailureCode =
  | 'NO_VIDEO'
  | 'VIDEO_NOT_READY'
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
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
    return 0;
  }

  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);

  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function findPrimaryVisibleVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
  if (videos.length === 0) return null;

  return (
    videos
      .map((video) => ({ video, area: visibleArea(video) }))
      .filter(({ area }) => area > 0)
      .sort((a, b) => b.area - a.area)[0]?.video ?? null
  );
}

export function capturePrimaryVideoFrame(maxDimension = 1280): FrameCaptureResult {
  const video = findPrimaryVisibleVideo();
  if (!video) {
    return {
      ok: false,
      code: 'NO_VIDEO',
      message: 'No visible HTML5 video was found on this page.',
    };
  }

  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0 || video.videoHeight === 0) {
    return {
      ok: false,
      code: 'VIDEO_NOT_READY',
      message: 'The video is present but its current frame is not ready yet.',
    };
  }

  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    return {
      ok: false,
      code: 'CAPTURE_FAILED',
      message: 'Canvas rendering is unavailable in this browser context.',
    };
  }

  try {
    context.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.86);

    return {
      ok: true,
      dataUrl,
      width,
      height,
      sourceWidth,
      sourceHeight,
      currentTime: video.currentTime,
      paused: video.paused,
    };
  } catch (error) {
    const blocked = error instanceof DOMException && error.name === 'SecurityError';
    return {
      ok: false,
      code: blocked ? 'CAPTURE_BLOCKED' : 'CAPTURE_FAILED',
      message: blocked
        ? 'Direct frame capture is blocked for this video by browser or origin protections.'
        : `Frame capture failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
