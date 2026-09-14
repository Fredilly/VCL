import { selectionSource, type FrameCaptureResult } from './frame-capture';

type Selection = Extract<FrameCaptureResult, { ok: true }>;
export type NearbyFrame = { id: 'previous' | 'next'; timestamp: number; offset: number; dataUrl: string };
export type NearbyCapture = { frames: NearbyFrame[]; attempts: { id: string; offset: number; status: string }[]; limitation?: string; mode?: 'detached' | 'player'; restored?: boolean };
const busyPlayers = new WeakSet<HTMLVideoElement>();

function detachedSource(src: string): boolean {
  const url = new URL(src, location.href);
  return /^https?:$/.test(url.protocol) && url.origin === location.origin;
}

function waitFor(video: EventTarget, event: string, action: () => void, signal: AbortSignal): Promise<void> {
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
    const timer = setTimeout(() => finish('capture_timeout'), 4000);
    video.addEventListener(event, ready, { once: true });
    video.addEventListener('error', failed, { once: true });
    video.addEventListener('encrypted', protectedMedia, { once: true });
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    try { action(); } catch { failed(); }
  });
}

// Register before seeking: on a paused MSE player, seeked and presentation can
// arrive in either order. Never sample the old compositor frame after a seek.
async function seekFrame(video: HTMLVideoElement, timestamp: number, signal: AbortSignal): Promise<number> {
  if (Math.abs(video.currentTime - timestamp) < 0.001 && !video.seeking) return video.currentTime;
  if (!video.requestVideoFrameCallback) {
    await waitFor(video, 'seeked', () => { video.currentTime = timestamp; }, signal);
    return video.currentTime;
  }
  let callback = 0;
  let presented: number | undefined;
  const frameReady = new EventTarget();
  const received: VideoFrameRequestCallback = (_now, metadata) => {
    if (Math.abs(metadata.mediaTime - timestamp) <= 0.1) {
      presented = metadata.mediaTime;
      frameReady.dispatchEvent(new Event('ready'));
    } else callback = video.requestVideoFrameCallback(received);
  };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) controller.abort();
  const ready = waitFor(frameReady, 'ready', () => {
    callback = video.requestVideoFrameCallback(received);
  }, controller.signal);
  try {
    await Promise.all([ready, waitFor(video, 'seeked', () => { video.currentTime = timestamp; }, controller.signal)]);
    return presented!;
  } finally {
    controller.abort();
    video.cancelVideoFrameCallback(callback);
    signal.removeEventListener('abort', cancel);
  }
}

export function nearbyCaptureLimitation(selection: Selection): string | undefined {
  const source = selectionSource(selection);
  if (!source || !selection.crop || source.video.currentSrc !== source.src || !source.video.isConnected) return 'source_changed';
  if (source.video.mediaKeys) return 'protected_media';
  if (source.video.srcObject || !Number.isFinite(source.video.duration)) return 'live_or_stream_source';
  try {
    const url = new URL(source.src, location.href);
    if (!/^(https?:|blob:)$/.test(url.protocol)) return 'nearby_capture_not_permitted_for_source';
    if (!detachedSource(source.src)) {
      if (!source.video.paused) return 'pause_video_first';
      if (source.video.seeking || Math.abs(source.video.currentTime - selection.currentTime) > 0.1) return 'playback_position_changed';
    }
  } catch { return 'nearby_capture_not_permitted_for_source'; }
}

export async function captureNearbyFrames(selection: Selection, signal: AbortSignal): Promise<NearbyCapture> {
  const result: NearbyCapture = { frames: [], attempts: [] };
  result.limitation = nearbyCaptureLimitation(selection);
  if (result.limitation || signal.aborted) return result;
  const source = selectionSource(selection)!;
  const detached = detachedSource(source.src);
  const decoder = detached ? document.createElement('video') : source.video;
  result.mode = detached ? 'detached' : 'player';
  if (busyPlayers.has(source.video)) { result.limitation = 'capture_in_progress'; return result; }
  busyPlayers.add(source.video);
  const originalTime = source.video.currentTime;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  let expectedTime = originalTime;
  let userChangedPlayback = false;
  const changed = () => {
    if (!decoder.paused || Math.abs(decoder.currentTime - expectedTime) > 0.15) {
      userChangedPlayback = true; controller.abort();
    }
  };
  const sourceValid = () => source.video.isConnected && source.video.currentSrc === source.src && !source.video.mediaKeys;
  if (detached) { decoder.preload = 'auto'; decoder.muted = true; decoder.playsInline = true; }
  else { decoder.addEventListener('play', changed); decoder.addEventListener('seeking', changed); }
  try {
    if (detached) await waitFor(decoder, 'loadeddata', () => { decoder.src = source.src; decoder.load(); }, controller.signal);
    for (const offset of [-0.5, 0.5] as const) {
      const id = offset < 0 ? 'previous' : 'next';
      if (controller.signal.aborted || !sourceValid()) throw new Error('source_changed_or_cancelled');
      const timestamp = selection.currentTime + offset;
      const attempt = { id, offset, status: 'outside_seekable_range' };
      result.attempts.push(attempt);
      if (timestamp < 0 || timestamp >= decoder.duration || !Array.from({ length: decoder.seekable.length }, (_, index) => index)
        .some((index) => timestamp >= decoder.seekable.start(index) && timestamp <= decoder.seekable.end(index))) continue;
      try {
        expectedTime = timestamp;
        const presentedTime = await seekFrame(decoder, timestamp, controller.signal);
        if (controller.signal.aborted || decoder.mediaKeys || !sourceValid()) throw new Error('source_changed_or_cancelled');
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
          result.frames.push({ id, timestamp: presentedTime, offset: presentedTime - selection.currentTime, dataUrl });
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
    signal.removeEventListener('abort', cancel);
    if (detached) { decoder.removeAttribute('src'); decoder.load(); decoder.remove(); }
    else {
      decoder.removeEventListener('play', changed); decoder.removeEventListener('seeking', changed);
      // Cancellation still restores our seek; a user's own play/seek takes priority.
      if (sourceValid() && !userChangedPlayback) {
        try {
          await seekFrame(decoder, originalTime, new AbortController().signal);
          result.restored = Math.abs(decoder.currentTime - originalTime) < 0.1 && decoder.paused;
        } catch { result.restored = false; }
        if (!result.restored) { result.frames.length = 0; result.limitation = 'playback_restore_failed'; }
      }
    }
    busyPlayers.delete(source.video);
    if (signal.aborted || userChangedPlayback || !sourceValid()) result.frames.length = 0;
  }
  return result;
}
