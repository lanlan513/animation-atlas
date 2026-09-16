import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { db } from './db.js';
import {
  createProject, makeIdFactory, clientNumFromId,
  applyOps, cloneModel
} from '../../shared/pixel-core.js';

const app = express();
const port = Number(process.env.PORT || 4000);
const allowedOrigins = new Set([
  process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  'http://127.0.0.1:5173'
]);
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)) }));
app.use(express.json({ limit: '8mb' }));

function getUser(req, res) {
  const user = db.getUser(req.header('x-user-id'));
  if (!user) {
    res.status(401).json({ error: '身份已失效，请刷新页面重新进入访客模式。' });
    return null;
  }
  return user;
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'pixelpulse-api' }));

app.post('/api/auth/guest', async (_req, res, next) => {
  try {
    const user = await db.createGuest();
    res.status(201).json({ user: { id: user.id, displayName: `Guest ${user.id.slice(0, 4).toUpperCase()}`, isGuest: true } });
  } catch (error) { next(error); }
});

app.get('/api/auth/me', (req, res) => {
  const user = db.getUser(req.header('x-user-id'));
  if (!user) return res.status(401).json({ error: '身份已失效。' });
  res.json({ user: { id: user.id, displayName: `Guest ${user.id.slice(0, 4).toUpperCase()}`, isGuest: true } });
});

app.get('/api/projects', (req, res, next) => {
  try {
    const user = getUser(req, res);
    if (!user) return;
    res.json({ projects: db.listProjects(user.id) });
  } catch (error) { next(error); }
});

app.post('/api/projects', (req, res, next) => {
  try {
    const user = getUser(req, res);
    if (!user) return;
    const { name, width, height } = req.body || {};
    const w = Math.trunc(Number(width)) || 16;
    const h = Math.trunc(Number(height)) || 16;
    if (w < 4 || h < 4 || w > 128 || h > 128) {
      return res.status(400).json({ error: '画布尺寸必须在 4–128 像素之间。' });
    }
    const now = new Date().toISOString();
    const state = createProject({
      id: crypto.randomUUID(),
      name: typeof name === 'string' ? name.slice(0, 80) : '',
      width: w,
      height: h,
      now,
      idFactory: makeIdFactory(clientNumFromId(user.id))
    });
    db.createProject(user.id, state).then((record) => {
      res.status(201).json({ project: record, state });
    }).catch(next);
  } catch (error) { next(error); }
});

app.get('/api/projects/:id', (req, res, next) => {
  try {
    const user = getUser(req, res);
    if (!user) return;
    const record = db.getRecord(req.params.id);
    if (!record || record.ownerId !== user.id) return res.status(404).json({ error: '找不到这个项目。' });
    const entry = db.loadProject(record.id);
    res.json({ project: record, state: entry.state, version: entry.version });
  } catch (error) { next(error); }
});

// Incremental commit: body is { baseVersion, ops, clientId, clientSeq }.
// The server never receives a full canvas upload; paint ops are sparse cells.
app.post('/api/projects/:id/commits', async (req, res, next) => {
  try {
    const user = getUser(req, res);
    if (!user) return;
    const record = db.getRecord(req.params.id);
    if (!record || record.ownerId !== user.id) return res.status(404).json({ error: '找不到这个项目。' });

    const { baseVersion, ops, clientId, clientSeq } = req.body || {};
    if (!Number.isInteger(baseVersion) || baseVersion < 0) {
      return res.status(400).json({ error: '缺少 baseVersion。' });
    }
    if (!Array.isArray(ops) || ops.length === 0) {
      return res.status(400).json({ error: '提交必须包含至少一个操作。' });
    }
    if (ops.length > 2000) {
      return res.status(413).json({ error: '单次提交操作过多，请分批同步。' });
    }

    // Validate eagerly against a clone so malformed batches never half-apply.
    const current = db.loadProject(record.id);
    if (!current) return res.status(404).json({ error: '项目状态缺失。' });
    try {
      applyOps(cloneModel(current.state), ops);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message });
    }

    const result = await db.commit(record.id, {
      baseVersion,
      ops,
      clientId: typeof clientId === 'string' ? clientId : null,
      clientSeq: Number.isInteger(clientSeq) ? clientSeq : null
    });

    if (result.missing) return res.status(404).json({ error: '项目状态缺失。' });
    if (result.conflict) {
      return res.status(409).json({
        error: '项目已在其他地方被更新。',
        serverVersion: result.serverVersion,
        resync: result.resync,
        catchUp: result.catchUp,
        project: result.project
      });
    }
    res.status(200).json({ saved: true, version: result.version, duplicate: Boolean(result.duplicate) });
  } catch (error) { next(error); }
});

// Full resync: current state plus any commits since a version (used when the
// local log gap has been compacted away on the server).
app.get('/api/projects/:id/sync', (req, res, next) => {
  try {
    const user = getUser(req, res);
    if (!user) return;
    const record = db.getRecord(req.params.id);
    if (!record || record.ownerId !== user.id) return res.status(404).json({ error: '找不到这个项目。' });
    const since = Math.max(0, Number(req.query.since) || 0);
    const entry = db.loadProject(record.id);
    res.json({
      version: entry.version,
      state: entry.state,
      commits: db.readCommits(record.id, since)
    });
  } catch (error) { next(error); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: '服务器暂时无法完成这个请求。' });
});

app.listen(port, () => console.log(`PixelPulse API listening on http://localhost:${port}`));
