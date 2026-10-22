const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

/** Use the browser's media pipeline, avoiding full-file reads or audio decoding. */
export function probeAudio(source: File | string, signal: AbortSignal): Promise<number> {
  if (source instanceof File) {
    if (!/\.(mp3|wav|ogg|m4a)$/i.test(source.name)) {
      return Promise.reject(new Error("Choose an MP3, WAV, Ogg, or M4A audio file."));
    }
    if (!source.size || source.size > MAX_AUDIO_BYTES) {
      return Promise.reject(new Error("Choose a non-empty audio file no larger than 100 MiB."));
    }
  } else {
    let url: URL;
    try { url = new URL(source); } catch {
      return Promise.reject(new Error("Enter a direct HTTP or HTTPS audio URL."));
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      return Promise.reject(new Error("Use an HTTP or HTTPS audio URL without embedded credentials."));
    }
  }

  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    const objectUrl = source instanceof File ? URL.createObjectURL(source) : null;
    let settled = false;
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      const duration = audio.duration;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      audio.oncanplay = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (error) reject(error);
      else resolve(duration);
    }
    function abort() { finish(new DOMException("Audio check cancelled", "AbortError")); }
    const timer = setTimeout(() => finish(new Error("Audio took too long to load. Check your connection or try a different source.")), 30000);
    audio.oncanplay = () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        finish(new Error("Choose an audio file with a finite, positive duration. Live streams are not supported."));
      } else finish();
    };
    audio.onerror = () => finish(new Error("Could not load audio. Choose a supported file or check that the URL points directly to playable audio."));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    audio.preload = "auto";
    audio.src = objectUrl ?? String(source);
    audio.load();
  });
}
