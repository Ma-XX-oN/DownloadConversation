/**
 * DC #333 proposed V2: render one requested 21-frame pulse sequence locally.
 *
 * This provider intentionally does not manage IndexedDB, cross-tab election,
 * object URLs, lifecycle observers, favicon <link> elements or background work.
 * DC #334 owns all storage and synchronization; DC #335 owns projection.
 */

const BASE_COLOURS = Object.freeze({
  processing: Object.freeze([255, 255, 0]),
  completed: Object.freeze([144, 238, 144]),
  acknowledged: Object.freeze([255, 255, 255]),
  error: Object.freeze([255, 0, 0])
});
const RING_COLOURS = Object.freeze([
  '#00cc00', '#55cc00', '#aacc00', '#ffcc00', '#ff7700', '#ff0000'
]);
const MAX_DIMENSION = 512;
const MAX_SOURCE_URI_LENGTH = 1024 * 1024;

/** A stable error that signals the caller to retain its original favicon. */
export class FaviconRenderError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'FaviconRenderError';
  }
}

/** Returns a standardized AbortError without requiring DOMException. */
function aborted() {
  const error = new Error('Favicon pulse generation cancelled or theme changed');
  error.name = 'AbortError';
  return error;
}

/** Observe active colour scheme; never infer it from the favicon URL. */
export function activeFaviconTheme() {
  if (typeof matchMedia !== 'function') {
    throw new FaviconRenderError('Browser colour-scheme observation unavailable');
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Map the 40 equally spaced ten-second cycle positions to 21 PNG indices. */
export function pulseFrameForSlot(slot) {
  if (!Number.isFinite(slot)) throw new TypeError('Invalid pulse slot');
  const normalized = ((Math.floor(slot) % 40) + 40) % 40;
  return Math.min(normalized, 40 - normalized);
}

/** Require exactly one original URL, theme, colour, and progress step. */
function validateRequest(request) {
  if (!request || typeof request !== 'object') {
    throw new TypeError('Favicon sequence request must be an object');
  }
  const {originalUrl, theme, base, progressStep, signal} = request;
  if (typeof originalUrl !== 'string' || !originalUrl ||
    originalUrl.length > MAX_SOURCE_URI_LENGTH) {
    throw new TypeError('Original favicon URL must be a bounded nonempty string');
  }
  let url;
  try { url = new URL(originalUrl, document.baseURI); }
  catch { throw new TypeError('Invalid original favicon URL'); }
  if (!['http:', 'https:'].includes(url.protocol) &&
    !(url.protocol === 'data:' && /^data:image\/(?:png|webp|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,/i.test(originalUrl))) {
    throw new TypeError('Unsupported original favicon URL protocol');
  }
  if (!['light', 'dark'].includes(theme)) throw new TypeError('Invalid theme');
  if (!Object.hasOwn(BASE_COLOURS, base)) throw new TypeError('Invalid base colour');
  if (!Number.isInteger(progressStep) || progressStep < 0 || progressStep > 6) {
    throw new TypeError('Progress step must be an integer from zero through six');
  }
  if (signal !== undefined && (typeof signal?.aborted !== 'boolean' ||
    typeof signal?.addEventListener !== 'function')) {
    throw new TypeError('Invalid AbortSignal');
  }
  return {originalUrl: url.href, theme, base, progressStep, signal};
}

/** Abort if cancelled, navigated into another scheme, or caller stale. */
function ensureCurrent(theme, signal) {
  if (signal?.aborted || activeFaviconTheme() !== theme) throw aborted();
}

/** Load the original captured URL; never replace it with an alternate asset. */
function loadImage(originalUrl, theme, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      signal?.removeEventListener('abort', onAbort);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else resolve(image);
    };
    const onAbort = () => {
      image.src = '';
      finish(aborted());
    };
    image.onload = () => {
      try { ensureCurrent(theme, signal); finish(); }
      catch (error) { finish(error); }
    };
    image.onerror = () => finish(new FaviconRenderError(
      'Original favicon image failed to decode or load'));
    signal?.addEventListener('abort', onAbort, {once:true});
    try {
      ensureCurrent(theme, signal);
      image.src = originalUrl;
    } catch (error) { finish(error); }
  });
}

/** Exact legacy near-white pixel recolour, preserving nonwhite pixels. */
function recolour(data, rgb) {
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const red = data[i], green = data[i + 1], blue = data[i + 2];
    if (Math.min(red, green, blue) < 240 ||
      Math.max(red, green, blue) - Math.min(red, green, blue) > 16) continue;
    const intensity = (red + green + blue) / (3 * 255);
    data[i] = Math.round(rgb[0] * intensity);
    data[i + 1] = Math.round(rgb[1] * intensity);
    data[i + 2] = Math.round(rgb[2] * intensity);
  }
}

/** Draw the legacy five-minute pie beneath the logo, and ring above. */
function compositeProgress(ctx, width, height, step) {
  if (step < 1) return;
  const size = Math.min(width, height);
  const centerX = width / 2, centerY = height / 2;
  const start = -Math.PI / 2, end = start + Math.PI * 2 * step / 6;
  ctx.globalCompositeOperation = 'destination-over';
  try {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.fillStyle = RING_COLOURS[step - 1];
    ctx.arc(centerX, centerY, size * 0.49, start, end);
    ctx.closePath();
    ctx.fill();
  } finally {
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.beginPath();
  ctx.strokeStyle = RING_COLOURS[step - 1];
  ctx.lineWidth = Math.max(1, size * 0.12);
  ctx.arc(centerX, centerY, size * 0.43, start, end);
  ctx.stroke();
}

/** Export one complete PNG Blob asynchronously without data URLs. */
function pngBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => {
        if (!blob || blob.type !== 'image/png' || blob.size < 32) {
          reject(new FaviconRenderError('PNG encoding returned an invalid Blob'));
        } else resolve(blob);
      }, 'image/png');
    } catch (error) {
      reject(new FaviconRenderError('Canvas PNG encoding unavailable', {
        cause:error
      }));
    }
  });
}

/** Let UI/timers process between frames rather than synchronously looping. */
function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Render exactly one requested 21-frame pulse sequence, with no side effects.
 *
 * @param {{originalUrl:string,theme:'light'|'dark',
 *   base:'processing'|'completed'|'acknowledged'|'error',
 *   progressStep:number,signal?:AbortSignal}} request - One sequence key.
 * @returns {Promise<{originalUrl:string,theme:string,base:string,
 *   progressStep:number,width:number,height:number,frames:Blob[]}>}
 */
export async function renderFaviconPulseSequence(request) {
  const key = validateRequest(request);
  ensureCurrent(key.theme, key.signal);
  const image = await loadImage(key.originalUrl, key.theme, key.signal);
  ensureCurrent(key.theme, key.signal);
  const width = image.naturalWidth, height = image.naturalHeight;
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
    width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new FaviconRenderError('Original favicon dimensions outside safe bounds');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  if (!ctx || typeof canvas.toBlob !== 'function') {
    throw new FaviconRenderError('Required browser Canvas PNG API unavailable');
  }
  try {
    ctx.drawImage(image, 0, 0, width, height);
    const base = ctx.getImageData(0, 0, width, height);
    recolour(base.data, BASE_COLOURS[key.base]);
    ctx.putImageData(base, 0, 0);
    if (key.base !== 'error') {
      compositeProgress(ctx, width, height, key.progressStep);
    }
    const composite = ctx.getImageData(0, 0, width, height);
    const frames = [];
    let priorAlphas = null;
    for (let frame = 0; frame <= 20; frame++) {
      await yieldToBrowser();
      ensureCurrent(key.theme, key.signal);
      const opacity = 0.75 + 0.25 * Math.cos(2 * Math.PI * frame / 40);
      const next = ctx.createImageData(width, height);
      next.data.set(composite.data);
      const currentAlphas = new Uint8Array(width * height);
      let differs = frame === 0;
      for (let i = 3; i < next.data.length; i += 4) {
        const alpha = Math.round(next.data[i] * opacity);
        next.data[i] = alpha;
        const index = (i - 3) / 4;
        currentAlphas[index] = alpha;
        if (priorAlphas && priorAlphas[index] !== alpha) differs = true;
      }
      if (!differs) {
        throw new FaviconRenderError(
          'Source alpha precision cannot represent 21 distinct pulse frames');
      }
      priorAlphas = currentAlphas;
      ctx.putImageData(next, 0, 0);
      const blob = await pngBlob(canvas);
      ensureCurrent(key.theme, key.signal);
      frames.push(blob);
    }
    // Only return all 21 complete Blobs. Failed requests expose no partial set.
    return {originalUrl:key.originalUrl,theme:key.theme,base:key.base,
      progressStep:key.progressStep,width,height,frames};
  } catch (error) {
    if (error?.name === 'AbortError' || error instanceof FaviconRenderError) {
      throw error;
    }
    throw new FaviconRenderError('Original favicon pixels unavailable', {
      cause:error
    });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
