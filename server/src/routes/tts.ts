import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
// Lazy-imported: edge-tts-universal is optional
let Communicate: any = null;
const edgeTtsReady = import('edge-tts-universal').then(mod => {
  Communicate = mod.Communicate;
}).catch(() => { /* edge-tts-universal not installed */ });

const router = Router();
router.use(authenticateToken);

// ─── LRU Cache (max 200 entries) ──────────────────────
const MAX_CACHE = 200;
const cache = new Map<string, Buffer>();

function cacheGet(key: string): Buffer | undefined {
  const val = cache.get(key);
  if (val) {
    // Move to end (most recently used)
    cache.delete(key);
    cache.set(key, val);
  }
  return val;
}

function cacheSet(key: string, val: Buffer): void {
  if (cache.size >= MAX_CACHE) {
    // Evict oldest (first) entry
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, val);
}

// ─── POST /api/tts ────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const { text, urgent } = req.body;

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text is required and must be a string', code: 'TTS_MISSING_TEXT' });
      return;
    }

    if (text.length > 1500) {
      res.status(400).json({ error: 'text must be 1500 characters or less', code: 'TTS_TEXT_TOO_LONG' });
      return;
    }

    const cacheKey = `${urgent ? 'U:' : ''}${text}`;

    // Check cache first
    const cached = cacheGet(cacheKey);
    if (cached) {
      res.set('Content-Type', 'audio/mpeg');
      res.set('X-TTS-Cache', 'HIT');
      res.send(cached);
      return;
    }

    // Voice settings
    const voice = 'en-US-JennyNeural';
    const rate = urgent ? '+15%' : '+5%';
    const pitch = urgent ? '+5Hz' : '+0Hz';
    const volume = urgent ? '+10%' : '+0%';

    await edgeTtsReady;
    if (!Communicate) {
      res.status(503).json({ error: 'TTS service not available (edge-tts-universal not installed)' });
      return;
    }
    const communicate = new Communicate(text, { voice, rate, pitch, volume });
    const buffers: Buffer[] = [];

    for await (const chunk of communicate.stream()) {
      if (chunk.type === 'audio' && chunk.data) {
        buffers.push(chunk.data);
      }
    }

    const audioBuffer = Buffer.concat(buffers);

    if (audioBuffer.length === 0) {
      res.status(502).json({ error: 'TTS engine returned no audio', code: 'TTS_NO_AUDIO' });
      return;
    }

    // Cache the result
    cacheSet(cacheKey, audioBuffer);

    res.set('Content-Type', 'audio/mpeg');
    res.set('X-TTS-Cache', 'MISS');
    res.send(audioBuffer);
  } catch (err: any) {
    console.error('[TTS] Edge-TTS error:', err?.message || err);
    res.status(500).json({ error: 'TTS generation failed', code: 'TTS_GENERATION_ERROR' });
  }
});

export default router;
