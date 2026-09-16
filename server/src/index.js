import express from 'express';
import cors from 'cors';
import { panelStore } from './panel-store.js';
import { duelRoutes } from './duel-routes.js';

const app = express();
const port = Number(process.env.PORT || 4000);
const allowedOrigins = new Set([
  process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  'http://127.0.0.1:5173'
]);

app.use(cors({
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin))
}));
// Maliciously long bodies are rejected before application code allocates them.
app.use(express.json({ limit: '192kb' }));

function requireGuest(req, res, next) {
  const userId = String(req.header('x-user-id') || '');
  const user = panelStore.getUser(userId);
  if (!user) return res.status(401).json({ error: '访客身份已失效，请刷新页面。' });
  req.user = user;
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'panel-punch-api' });
});

app.post('/api/auth/guest', async (_req, res, next) => {
  try {
    res.status(201).json({ user: await panelStore.createGuest() });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', requireGuest, (req, res) => {
  res.json({ user: req.user });
});

app.use('/api/duels', duelRoutes(requireGuest));

app.get('/api/posters', requireGuest, (req, res) => {
  res.json({ posters: panelStore.list(req.user.id) });
});

app.post('/api/posters', requireGuest, async (req, res, next) => {
  try {
    const poster = await panelStore.create(req.user.id, req.body?.poster || {});
    const saved = panelStore.load(poster.id, req.user.id);
    res.status(201).json({ poster: saved.poster, record: poster });
  } catch (error) {
    next(error);
  }
});

app.get('/api/posters/:id', requireGuest, (req, res) => {
  const saved = panelStore.load(req.params.id, req.user.id);
  if (!saved) return res.status(404).json({ error: '找不到这张海报。' });
  res.json({ poster: saved.poster, revision: saved.revision, updatedAt: saved.updatedAt });
});

app.put('/api/posters/:id', requireGuest, async (req, res, next) => {
  try {
    const expected = Number.isFinite(Number(req.header('if-match')))
      ? Number(req.header('if-match'))
      : undefined;
    const result = await panelStore.save(req.params.id, req.user.id, req.body?.poster, expected);
    if (result.missing) return res.status(404).json({ error: '找不到这张海报。' });
    if (result.conflict) {
      return res.status(409).json({
        error: '海报已在其他标签页中更新，页面已加载服务器版本。',
        revision: result.current,
        poster: result.serverPoster
      });
    }
    res.json({ ok: true, revision: result.revision, updatedAt: result.updatedAt, poster: result.poster });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: '内容过大：冲击字和图层参数请保持精简。' });
  }
  if (error instanceof SyntaxError) return res.status(400).json({ error: 'JSON 格式无效。' });
  res.status(500).json({ error: 'Panel Punch 后端暂时无法完成请求。' });
});

app.listen(port, () => console.log(`Panel Punch API listening on http://localhost:${port}`));
