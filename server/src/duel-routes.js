// Panel Punch — Hero Duel API router. All verdicts are produced here on the
// server; the client only ever submits setups and renders what comes back.

import express from 'express';
import { duelStore } from './duel-store.js';

// Sliding-window limiter: high-frequency submissions are rejected with 429
// before they can queue engine work or writes.
const WINDOW_MS = 10_000;
const MAX_SUBMITS_PER_WINDOW = 8;
const hits = new Map(); // userId -> number[] (timestamps)

function prune(userId, now) {
  const list = (hits.get(userId) || []).filter((t) => now - t < WINDOW_MS);
  hits.set(userId, list);
  return list;
}

function submitLimiter(req, res, next) {
  const now = Date.now();
  const list = prune(req.user.id, now);
  if (list.length >= MAX_SUBMITS_PER_WINDOW) {
    const retryAfterMs = WINDOW_MS - (now - list[0]);
    res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
    return res.status(429).json({
      error: '提交过于频繁，规则引擎需要喘口气。请稍候再试。',
      retryAfterMs
    });
  }
  list.push(now);
  next();
}

// Periodically drop idle users so the limiter map cannot grow without bound.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [userId, list] of hits) {
    if (!list.length || now - list[list.length - 1] >= WINDOW_MS) hits.delete(userId);
  }
}, 60_000);
sweeper.unref?.();

export function duelRoutes(requireGuest) {
  const router = express.Router();
  router.use(requireGuest);

  // Submit a setup -> server engine runs -> new immutable record.
  router.post('/', submitLimiter, async (req, res, next) => {
    try {
      const record = await duelStore.create(req.user, req.body?.setup);
      res.status(201).json({ record });
    } catch (error) {
      next(error);
    }
  });

  // Own traceable history (newest first).
  router.get('/', (req, res) => {
    res.json({ records: duelStore.listOwn(req.user.id) });
  });

  // Public wall: published results from every user, read-only.
  router.get('/public', (req, res) => {
    res.json({ records: duelStore.listPublic() });
  });

  router.get('/:id', (req, res) => {
    const record = duelStore.load(req.params.id, req.user.id);
    if (!record) return res.status(404).json({ error: '找不到这场对决，或它尚未公开。' });
    res.json({ record });
  });

  // Restore any historical setup as a NEW record (lineage via restoredFrom).
  router.post('/:id/restore', submitLimiter, async (req, res, next) => {
    try {
      const result = await duelStore.restore(req.params.id, req.user);
      if (result.missing) return res.status(404).json({ error: '找不到这条历史记录。' });
      res.status(201).json({ record: result.record });
    } catch (error) {
      next(error);
    }
  });

  // Publish/unpublish — owner only; nobody can edit another user's record.
  router.post('/:id/publish', async (req, res, next) => {
    try {
      const result = await duelStore.setPublic(req.params.id, req.user.id, req.body?.isPublic);
      if (result.missing) return res.status(404).json({ error: '找不到这场对决，或无权修改。' });
      res.json({ record: result.record });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
