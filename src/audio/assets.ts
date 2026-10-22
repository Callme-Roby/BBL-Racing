/**
 * assets.ts — lazy loading + caching of optional audio files (see manifest.ts).
 *
 * Every URL is fetched and decoded at most once. Failures resolve to `null`
 * (the caller then falls back to the procedural sound) and are warned once.
 */

const pending = new Map<string, Promise<AudioBuffer | null>>();
const settled = new Map<string, AudioBuffer | null>();
const warned = new Set<string>();

/** console.warn, but only once per key. */
export function warnOnce(key: string, ...args: unknown[]): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(...args);
}

/** Synchronous peek: the buffer, `null` if it failed, `undefined` if not loaded (yet). */
export function peekBuffer(url: string): AudioBuffer | null | undefined {
  return settled.has(url) ? (settled.get(url) ?? null) : undefined;
}

/** Fetch + decode a file once; resolves to `null` on any error. */
export function loadBuffer(ctx: BaseAudioContext, url: string): Promise<AudioBuffer | null> {
  let p = pending.get(url);
  if (!p) {
    p = fetchAndDecode(ctx, url).then((buf) => {
      settled.set(url, buf);
      return buf;
    });
    pending.set(url, p);
  }
  return p;
}

async function fetchAndDecode(ctx: BaseAudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.arrayBuffer();
    return await decode(ctx, data);
  } catch (err) {
    warnOnce(url, `[audio] could not load "${url}", using the built-in sound instead.`, err);
    return null;
  }
}

/** decodeAudioData, compatible with both the promise and the old callback-only (Safari) forms. */
function decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    const r: Promise<AudioBuffer> | undefined = ctx.decodeAudioData(data, resolve, reject);
    r?.then(resolve, reject);
  });
}
