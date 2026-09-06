// ============================================================
// RMPG Flex — Stream Player (Audio Playback for Radio/Panic)
// ============================================================
// Plays incoming WebM/Opus audio chunks in near-real-time.
//
// Strategy: AudioContext + decodeAudioData
// ─────────────────────────────────────────
// Instead of MSE (which has fragile sourceopen timing,
// autoplay quirks, and SourceBuffer compatibility issues),
// we use the Web Audio API directly:
//
// 1. Accumulate all received chunks into a growing buffer
// 2. On every chunk, decode the ENTIRE buffer with
//    AudioContext.decodeAudioData() — this always works
//    because chunk #1 contains the full WebM header
// 3. Play only the NEW portion (from where we left off)
//    using AudioBufferSourceNode scheduled at precise times
//
// Latency design:
// • A concurrency guard (decoding flag) ensures at most ONE
//   decodeAudioData call is in flight at a time. If a chunk
//   arrives while decoding, pendingDecode is set so the
//   latest buffer is decoded the moment the current one
//   finishes — no chunk is dropped, no two decoders race.
// • Every chunk triggers a decode attempt, giving ~250ms
//   max receive-to-play latency instead of the old ~500ms.
//
// Used by:
//   - usePanicAudio.ts (panic broadcast + talk-back)
//   - useRadio.ts      (PTT radio channels)
// ============================================================

// Module-level shared AudioContext pool. Chrome caps hardware AudioContexts
// at ~6; creating a new one per radio transmission (StreamPlayer.init) was
// exhausting that cap during connectivity flapping with active radio traffic,
// causing a hard crash (white screen). Instances now borrow from this pool
// and return on destroy.
let _sharedAudioCtx: AudioContext | null = null;
let _sharedAudioCtxRefCount = 0;

function acquireSharedAudioContext(): AudioContext | null {
  try {
    if (!_sharedAudioCtx || _sharedAudioCtx.state === 'closed') {
      _sharedAudioCtx = new AudioContext();
      _sharedAudioCtxRefCount = 0;
    }
    if (_sharedAudioCtx.state === 'suspended') {
      _sharedAudioCtx.resume().catch(() => {});
    }
    _sharedAudioCtxRefCount++;
    return _sharedAudioCtx;
  } catch (err) {
    console.error('[StreamPlayer] Failed to acquire AudioContext:', err);
    return null;
  }
}

function releaseSharedAudioContext(): void {
  _sharedAudioCtxRefCount = Math.max(0, _sharedAudioCtxRefCount - 1);
}

export class StreamPlayer {
  private audioContext: AudioContext | null = null;
  private ownsContext = false;
  private buffer: Uint8Array = new Uint8Array(64 * 1024); // 64KB initial
  private totalBytes = 0;
  private mimeType: string = 'audio/webm;codecs=opus';
  private chunkCount = 0;
  private static readonly MAX_BUFFER_BYTES = 50 * 1024 * 1024; // 50MB cap

  /** How many seconds of audio we've already scheduled for playback */
  private playedUpTo = 0;

  /** When playback started (AudioContext.currentTime) */
  private playbackStartTime = 0;

  /** Whether we've started scheduling audio */
  private isPlaying = false;

  /** Track active source nodes for cleanup */
  private activeSources: AudioBufferSourceNode[] = [];

  /** Guard: true while a decodeAudioData call is in flight */
  private decoding = false;

  /** Set when a chunk arrived while decoding was in progress.
   *  The post-decode path runs one more decode to pick it up. */
  private pendingDecode = false;

  /** Pre-warm the audio system. Call from a user gesture context
   *  (e.g. channel join click) to ensure audio playback is allowed. */
  static preWarm(): void {
    try {
      const ctx = new AudioContext();
      // Create and play a tiny silent buffer to "unlock" audio
      const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
      // Close after a moment — we just needed to unlock audio
      setTimeout(() => ctx.close().catch(() => {}), 100);
    } catch {
      // Pre-warm failed — no user gesture context yet
    }
  }

  /** Initialize the player with a specific mime type */
  init(mimeType?: string) {
    if (this.audioContext) return; // Already active

    if (mimeType) this.mimeType = mimeType;

    this.audioContext = acquireSharedAudioContext();
    this.ownsContext = false;
  }

  /** Append a base64-encoded audio chunk to the stream */
  appendChunk(base64: string) {
    if (!base64) return;
    // Decode base64 → binary
    let binary: string;
    try { binary = atob(base64); } catch { return; }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    // Store the chunk in the pre-allocated buffer (grow by doubling if needed)
    const needed = this.totalBytes + bytes.length;
    if (needed > StreamPlayer.MAX_BUFFER_BYTES) {
      console.warn('[StreamPlayer] Buffer cap reached, ignoring chunk');
      return;
    }
    if (needed > this.buffer.length) {
      const newSize = Math.min(Math.max(this.buffer.length * 2, needed), StreamPlayer.MAX_BUFFER_BYTES);
      const newBuf = new Uint8Array(newSize);
      newBuf.set(this.buffer.subarray(0, this.totalBytes));
      this.buffer = newBuf;
    }
    this.buffer.set(bytes, this.totalBytes);
    this.totalBytes += bytes.length;
    this.chunkCount++;

    // Initialize AudioContext on first chunk if not pre-initialized
    if (!this.audioContext) {
      this.init();
    }

    // Resume AudioContext if suspended (autoplay policy)
    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }

    // Decode on every chunk. If a decode is already running, set a
    // pending flag so the latest buffer is decoded once it finishes —
    // no two decoders run concurrently and no chunk is silently dropped.
    if (this.decoding) {
      this.pendingDecode = true;
    } else {
      this.decodeAndPlay();
    }
  }

  /** Combine all chunks, decode with Web Audio API, play new portion */
  private async decodeAndPlay() {
    if (!this.audioContext) return;
    this.decoding = true;
    this.pendingDecode = false;

    // Snapshot byte length at decode start so we play exactly what we
    // decoded even if more bytes arrive mid-await.
    const snapshotBytes = this.totalBytes;
    const combined = this.buffer.subarray(0, snapshotBytes);

    try {
      // decodeAudioData() can decode a complete WebM file (all chunks
      // concatenated form a valid WebM since chunk #1 has the header)
      const arrayBuffer = combined.buffer.slice(
        combined.byteOffset,
        combined.byteOffset + combined.byteLength
      ) as ArrayBuffer;
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

      // Calculate what's new
      const totalDuration = audioBuffer.duration;
      const newDuration = totalDuration - this.playedUpTo;

      if (newDuration > 0.01) {
        // Create a source node for the new portion
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);

        // Schedule playback of just the new portion
        if (!this.isPlaying) {
          // First decode — start playing immediately
          this.playbackStartTime = this.audioContext.currentTime;
          this.isPlaying = true;
          source.start(0, this.playedUpTo);
        } else {
          // Schedule the new audio to start where the last decode left off
          const scheduledTime = this.playbackStartTime + this.playedUpTo;
          const now = this.audioContext.currentTime;

          if (scheduledTime > now) {
            // Schedule in the future (ideal — seamless continuation)
            source.start(scheduledTime, this.playedUpTo);
          } else {
            // We're behind — skip ahead to stay close to real-time
            const skipAmount = now - scheduledTime;
            const newOffset = this.playedUpTo + skipAmount;
            if (newOffset < totalDuration) {
              source.start(0, newOffset);
            }
          }
        }

        this.activeSources.push(source);
        this.playedUpTo = totalDuration;

        // Clean up finished sources
        source.onended = () => {
          const idx = this.activeSources.indexOf(source);
          if (idx !== -1) this.activeSources.splice(idx, 1);
        };
      }
    } catch {
      // decodeAudioData failures on early chunks are expected — need more data.
    } finally {
      this.decoding = false;
      // If a chunk arrived while we were decoding, run one more pass now
      // so it's not stranded in the buffer waiting for the next chunk.
      if (this.pendingDecode) {
        this.decodeAndPlay();
      }
    }
  }

  /** End the stream and clean up all resources */
  destroy() {
    for (const src of this.activeSources) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    this.activeSources = [];

    if (this.audioContext) {
      if (this.ownsContext && this.audioContext.state !== 'closed') {
        this.audioContext.close().catch(() => {});
      } else {
        releaseSharedAudioContext();
      }
    }

    this.audioContext = null;
    this.ownsContext = false;
    this.buffer = new Uint8Array(64 * 1024);
    this.totalBytes = 0;
    this.chunkCount = 0;
    this.playedUpTo = 0;
    this.playbackStartTime = 0;
    this.isPlaying = false;
    this.decoding = false;
    this.pendingDecode = false;
  }
}
