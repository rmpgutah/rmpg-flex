// ============================================================
// RMPG Flex — MSE Stream Player
// ============================================================
// Encapsulates MediaSource Extensions playback for a single
// incoming audio stream. Receives chunked WebM/Opus data and
// plays in near-real-time. Falls back to blob accumulation on
// platforms without MSE support.
//
// Used by:
//   - usePanicAudio.ts (panic broadcast + talk-back)
//   - useRadio.ts      (PTT radio channels)
// ============================================================

export class StreamPlayer {
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private chunkQueue: ArrayBuffer[] = [];
  private isSourceOpen = false;
  private mimeType: string = 'audio/webm;codecs=opus';

  /** Initialize the MSE pipeline on first audio chunk */
  init(mimeType?: string) {
    if (this.audioElement) return; // Already active

    if (mimeType) this.mimeType = mimeType;

    // Check MSE support for this mime type
    if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(this.mimeType)) {
      console.warn('[StreamPlayer] MediaSource not supported for', this.mimeType, '— falling back to blob playback');
      return;
    }

    const ms = new MediaSource();
    const audio = new Audio();
    audio.src = URL.createObjectURL(ms);

    ms.addEventListener('sourceopen', () => {
      try {
        const sb = ms.addSourceBuffer(this.mimeType);
        this.sourceBuffer = sb;
        this.isSourceOpen = true;

        sb.addEventListener('updateend', () => {
          this.flushQueue();
        });

        // Feed any chunks that arrived before sourceopen fired
        this.flushQueue();
      } catch (err) {
        console.error('[StreamPlayer] SourceBuffer setup error:', err);
      }
    });

    this.audioElement = audio;
    this.mediaSource = ms;

    // Start playback — catch and ignore autoplay restrictions
    audio.play().catch(() => {});
  }

  /** Append a base64-encoded audio chunk to the stream */
  appendChunk(base64: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    // Initialize MSE on first chunk if not yet done
    if (!this.audioElement) {
      this.init();
    }

    // If MSE isn't available, fall back to simple blob playback
    if (!this.mediaSource) {
      this.fallbackPlay(bytes);
      return;
    }

    this.chunkQueue.push(bytes.buffer as ArrayBuffer);
    this.flushQueue();
  }

  /** Feed queued chunks into SourceBuffer when it's ready */
  private flushQueue() {
    if (!this.sourceBuffer || !this.isSourceOpen) return;
    if (this.sourceBuffer.updating) return;
    if (this.chunkQueue.length === 0) return;

    const chunk = this.chunkQueue.shift()!;
    try {
      this.sourceBuffer.appendBuffer(chunk);
    } catch (err) {
      // QuotaExceededError — remove old buffered data and retry
      if ((err as DOMException).name === 'QuotaExceededError') {
        try {
          const buffered = this.sourceBuffer.buffered;
          if (buffered.length > 0) {
            this.sourceBuffer.remove(0, buffered.end(0) - 2);
          }
        } catch { /* ignore */ }
        // Re-queue the chunk for next updateend
        this.chunkQueue.unshift(chunk);
      }
    }
  }

  /** Fallback for environments without MSE — accumulate and play full blob */
  private accumulatedChunks: Uint8Array[] = [];
  private fallbackAudio: HTMLAudioElement | null = null;

  private fallbackPlay(bytes: Uint8Array) {
    this.accumulatedChunks.push(bytes);

    // Rebuild and play the accumulated audio periodically (every 4 chunks ≈ 2s)
    if (this.accumulatedChunks.length % 4 === 0 || this.accumulatedChunks.length === 1) {
      const totalLen = this.accumulatedChunks.reduce((sum, c) => sum + c.length, 0);
      const combined = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of this.accumulatedChunks) {
        combined.set(c, offset);
        offset += c.length;
      }

      const blob = new Blob([combined], { type: this.mimeType });
      const url = URL.createObjectURL(blob);

      if (this.fallbackAudio) {
        this.fallbackAudio.pause();
        URL.revokeObjectURL(this.fallbackAudio.src);
      }
      this.fallbackAudio = new Audio(url);
      this.fallbackAudio.play().catch(() => {});
    }
  }

  /** End the stream and clean up all resources */
  destroy() {
    if (this.audioElement) {
      this.audioElement.pause();
      if (this.audioElement.src) {
        URL.revokeObjectURL(this.audioElement.src);
      }
      this.audioElement = null;
    }
    if (this.mediaSource && this.mediaSource.readyState === 'open') {
      try {
        this.mediaSource.endOfStream();
      } catch { /* already closed */ }
    }
    if (this.fallbackAudio) {
      this.fallbackAudio.pause();
      URL.revokeObjectURL(this.fallbackAudio.src);
      this.fallbackAudio = null;
    }
    this.mediaSource = null;
    this.sourceBuffer = null;
    this.isSourceOpen = false;
    this.chunkQueue = [];
    this.accumulatedChunks = [];
  }
}
