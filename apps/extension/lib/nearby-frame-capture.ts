import { selectionSource, type FrameCaptureResult } from './frame-capture';

type Selection = Extract<FrameCaptureResult, { ok: true }>;
export type NearbyFrame = { id: 'previous' | 'next'; timestamp: number; offset: number; dataUrl: string };
export type NearbyCapture = { frames: NearbyFrame[]; attempts: { id: string; offset: number; status: string }[]; limitation?: string };

function waitFor(video: HTMLVideoElement, event: string, action: () => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: string) => {
      clearTimeout(timer);
      video.removeEventListener(event, ready);
      video.removeEventListener('error', failed);
      video.removeEventListener('encrypted', protectedMedia);
      signal.removeEventListener('abort', aborted);
      error ? reject(new Error(error)) : resolve();
    };
    const ready = () => finish();
    const failed = () => finish('media_unavailable');
    const protectedMedia = () => finish('protected_media');
    const aborted = () => finish('cancelled');
    const timer = setTimeout(() => finish('capture_timeout'), 2000);
    video.addEventListener(event, ready, { once: true });
    video.addEventListener('error', failed, { once: true });
    video.addEventListener('encrypted', protectedMedia, { once: true });
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    try { action(); } catch { failed(); }
  });
}

export function nearbyCaptureLimitation(selection: Selection): string | undefined {
  const source = selectionSource(selection);
  if (!source || !selection.crop || source.video.currentSrc !== source.src || !source.video.isConnected) return 'source_changed';
  if (source.video.mediaKeys) return 'protected_media';
  if (source.video.srcObject || !Number.isFinite(source.video.duration)) return 'live_or_stream_source';
  // This spike permits ordinary same-origin media only. No stream extraction,
  // cross-origin credential copying, tab capture, or platform-specific workaround.
  try {
    const url = new URL(source.src, location.href);
    if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin) return 'nearby_capture_not_permitted_for_source';
  } catch { return 'nearby_capture_not_permitted_for_source'; }
}

export async function captureNearbyFrames(selection: Selection, signal: AbortSignal): Promise<NearbyCapture> {
  const result: NearbyCapture = { frames: [], attempts: [] };
  result.limitation = nearbyCaptureLimitation(selection);
  if (result.limitation || signal.aborted) return result;
  const source = selectionSource(selection)!;
  const decoder = document.createElement('video');
  decoder.preload = 'auto'; decoder.muted = true; decoder.playsInline = true;
  // Detached, paused decoder: never seek, play, or pause the user's player.
  try {
    await waitFor(decoder, 'loadeddata', () => { decoder.src = source.src; decoder.load(); }, signal);
    for (const offset of [-0.5, 0.5] as const) {
      const id = offset < 0 ? 'previous' : 'next';
      if (signal.aborted || nearbyCaptureLimitation(selection)) throw new Error('source_changed_or_cancelled');
      const timestamp = selection.currentTime + offset;
      const attempt = { id, offset, status: 'outside_seekable_range' };
      result.attempts.push(attempt);
      if (timestamp < 0 || timestamp >= decoder.duration || !Array.from({ length: decoder.seekable.length }, (_, index) => index)
        .some((index) => timestamp >= decoder.seekable.start(index) && timestamp <= decoder.seekable.end(index))) continue;
      try {
        await waitFor(decoder, 'seeked', () => { decoder.currentTime = timestamp; }, signal);
        if (signal.aborted || decoder.mediaKeys || nearbyCaptureLimitation(selection)) throw new Error('source_changed_or_cancelled');
        if (decoder.videoWidth !== selection.sourceWidth || decoder.videoHeight !== selection.sourceHeight ||
          Math.abs(decoder.currentTime - timestamp) > 0.1) throw new Error('frame_geometry_or_time_changed');
        const canvas = document.createElement('canvas');
        canvas.width = selection.width; canvas.height = selection.height;
        try {
          const context = canvas.getContext('2d', { alpha: false });
          if (!context) throw new Error('canvas_unavailable');
          const crop = selection.crop!;
          context.drawImage(decoder, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let min = 255; let max = 0;
          for (let index = 0; index < pixels.length; index += 64) {
            const brightness = (pixels[index]! + pixels[index + 1]! + pixels[index + 2]!) / 3;
            min = Math.min(min, brightness); max = Math.max(max, brightness);
          }
          if (max - min < 8) { attempt.status = 'blank_crop'; continue; }
          const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
          if (dataUrl === selection.dataUrl || result.frames.some((frame) => frame.dataUrl === dataUrl)) { attempt.status = 'duplicate_crop'; continue; }
          result.frames.push({ id, timestamp: decoder.currentTime, offset: decoder.currentTime - selection.currentTime, dataUrl });
          attempt.status = 'captured';
        } finally { canvas.width = 0; canvas.height = 0; }
      } catch {
        attempt.status = 'capture_failed';
        // A capture/security failure ends this bounded attempt; no alternate capture path.
        break;
      }
    }
  } catch { result.limitation = 'nearby_capture_failed'; }
  finally {
    decoder.removeAttribute('src'); decoder.load(); decoder.remove();
    if (signal.aborted || nearbyCaptureLimitation(selection)) result.frames.length = 0;
  }
  return result;
}
