import { devLog } from './devLog';

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
// 2. Every few chunks, decode the ENTIRE buffer with
//    AudioContext.decodeAudioData() — this always works
//    because chunk #1 contains the full WebM header
// 3. Play only the NEW portion (from where we left off)
//    using AudioBufferSourceNode scheduled at precise times
//
// This approach:
// • Works on ALL browsers (Chrome, Safari, Firefox, mobile)
// • Doesn't require MSE support
// • Handles autoplay by pre-creating AudioContext
// • Has ~600ms latency (3 chunks) — acceptable for radio
//
// Used by:
//   - usePanicAudio.ts (panic broadcast + talk-back)
//   - useRadio.ts      (PTT radio channels)
// ============================================================

export class StreamPlayer {
  private audioContext: AudioContext | null = null;
  private allChunks: Uint8Array[] = [];
  private totalBytes = 0;
  private mimeType: string = 'audio/webm;codecs=opus';
  private chunkCount = 0;

  /** How many seconds of audio we've already scheduled for playback */
  private playedUpTo = 0;

  /** When playback started (AudioContext.currentTime) */
  private playbackStartTime = 0;

  /** Whether we've started scheduling audio */
  private isPlaying = false;

  /** Track active source nodes for cleanup */
  private activeSources: AudioBufferSourceNode[] = [];

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
      devLog('[StreamPlayer] Audio pre-warmed successfully');
    } catch {
      console.warn('[StreamPlayer] Pre-warm failed (no user gesture?)');
    }
  }

  /** Initialize the player with a specific mime type */
  init(mimeType?: string) {
    if (this.audioContext) return; // Already active

    if (mimeType) this.mimeType = mimeType;

    try {
      this.audioContext = new AudioContext();
      // Resume in case it was created in a suspended state
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }
      devLog('[StreamPlayer] AudioContext created, state:', this.audioContext.state);
    } catch (err) {
      console.error('[StreamPlayer] Failed to create AudioContext:', err);
    }
  }

  /** Append a base64-encoded audio chunk to the stream */
  appendChunk(base64: string) {
    // Decode base64 → binary
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    // Store the chunk
    this.allChunks.push(bytes);
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

    // Log first few chunks for diagnostics
    if (this.chunkCount <= 3) {
      devLog('[StreamPlayer] Chunk #' + this.chunkCount +
        ' received, size:', bytes.length, 'bytes, total:', this.totalBytes,
        'bytes, ctx state:', this.audioContext?.state);
    }

    // Decode and play every 2 chunks (~400ms of audio)
    // Also decode on first chunk for minimum latency
    if (this.chunkCount === 1 || this.chunkCount % 2 === 0) {
      this.decodeAndPlay();
    }
  }

  /** Combine all chunks, decode with Web Audio API, play new portion */
  private async decodeAndPlay() {
    if (!this.audioContext) return;

    // Combine all chunks into a single buffer
    const combined = new Uint8Array(this.totalBytes);
    let offset = 0;
    for (const chunk of this.allChunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    try {
      // decodeAudioData() can decode a complete WebM file (all chunks
      // concatenated form a valid WebM since chunk #1 has the header)
      const arrayBuffer = combined.buffer.slice(
        combined.byteOffset,
        combined.byteOffset + combined.byteLength
      );
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

      // Calculate what's new
      const totalDuration = audioBuffer.duration;
      const newDuration = totalDuration - this.playedUpTo;

      if (newDuration <= 0.01) return; // Nothing new to play

      if (this.chunkCount <= 3) {
        devLog('[StreamPlayer] Decoded:', totalDuration.toFixed(2) + 's total,',
          newDuration.toFixed(2) + 's new, playing from', this.playedUpTo.toFixed(2) + 's');
      }

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
    } catch (err) {
      // decodeAudioData can fail if the buffer is too short or malformed
      // This is expected on the very first chunk sometimes — just wait
      // for more data
      if (this.chunkCount <= 2) {
        devLog('[StreamPlayer] Decode deferred (need more data), chunks:', this.chunkCount);
      } else {
        console.warn('[StreamPlayer] decodeAudioData failed:', err);
      }
    }
  }

  /** End the stream and clean up all resources */
  destroy() {
    // Stop all active source nodes
    for (const src of this.activeSources) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    this.activeSources = [];

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
    }

    this.audioContext = null;
    this.allChunks = [];
    this.totalBytes = 0;
    this.chunkCount = 0;
    this.playedUpTo = 0;
    this.playbackStartTime = 0;
    this.isPlaying = false;
  }
}
