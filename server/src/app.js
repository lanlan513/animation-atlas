import crypto from 'node:crypto';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { store, dataRoot } from './store.js';
import * as inkdrift from './inkdrift-store.js';

export function createApp() {
  const app = express();
  fs.mkdirSync(`${dataRoot}/uploads`, { recursive: true });
  const upload = multer({ dest: `${dataRoot}/uploads/`, limits: { fileSize: 25 * 1024 * 1024 } });
  const allowedOrigins = new Set([process.env.CLIENT_ORIGIN || 'http://localhost:5173', 'http://127.0.0.1:5173']);
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)) }));
  app.use(express.json({ limit: '8mb' }));

  const publicUser = (user) => ({ id: user.id, displayName: user.display_name, email: user.email, isGuest: Boolean(user.is_guest) });

  function requireUser(req, res, next) {
    const user = store.findUser(req.header('x-user-id'));
    if (!user) return res.status(401).json({ error: '身份已失效，请重新进入访客模式。' });
    req.user = user;
    next();
  }

  function requireProjectOwner(req, res, next) {
    const project = store.findProject(req.params.projectId, req.user.id);
    if (!project) return res.status(404).json({ error: '找不到这个项目，或你没有访问权限。' });
    req.project = project;
    next();
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'animation-atlas-api' }));

  app.post('/api/auth/guest', (_req, res) => {
    const id = crypto.randomUUID().slice(0, 4).toUpperCase();
    const user = store.createUser({ displayName: `Guest ${id}`, isGuest: 1 });
    res.status(201).json({ user: publicUser(user) });
  });

  app.post('/api/auth/register', (req, res) => {
    const { email, password, displayName } = req.body || {};
    if (!email || !password || !displayName) return res.status(400).json({ error: '请填写邮箱、密码和显示名称。' });
    if (password.length < 8) return res.status(400).json({ error: '密码至少需要 8 个字符。' });
    if (store.findUserByEmail(email)) return res.status(409).json({ error: '这个邮箱已经注册。' });
    const user = store.createUser({ email: email.toLowerCase(), passwordHash: bcrypt.hashSync(password, 10), displayName: displayName.trim(), isGuest: 0 });
    res.status(201).json({ user: publicUser(user) });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    const user = store.findUserByEmail(email || '');
    if (!user || !bcrypt.compareSync(password || '', user.password_hash || '')) return res.status(401).json({ error: '邮箱或密码不正确。' });
    res.json({ user: publicUser(user) });
  });

  app.get('/api/auth/me', requireUser, (req, res) => res.json({ user: publicUser(req.user) }));

  app.get('/api/categories', (_req, res) => res.json({ categories: store.listCategories() }));

  app.get('/api/projects', requireUser, (req, res) => res.json({ projects: store.listProjects(req.user.id) }));

  app.post('/api/projects', requireUser, (req, res) => {
    const { name, categorySlug, description = '' } = req.body || {};
    const category = store.findCategoryBySlug(categorySlug);
    if (!name?.trim() || !category) return res.status(400).json({ error: '项目名称和实验室入口不能为空。' });
    const project = store.createProject({ ownerId: req.user.id, categoryId: category.id, name: name.trim(), description: description.trim() });
    res.status(201).json({ project: { ...store.decorateProject(project), draftRevision: 1 } });
  });

  app.get('/api/projects/:projectId', requireUser, requireProjectOwner, (req, res) => {
    res.json({ project: { ...store.decorateProject(req.project), draft: store.getDraft(req.project.id) } });
  });

  app.put('/api/projects/:projectId/drafts', requireUser, requireProjectOwner, (req, res) => {
    const content = req.body?.content;
    if (!content || typeof content !== 'object') return res.status(400).json({ error: '草稿内容必须是对象。' });
    const saved = store.saveDraft(req.project.id, content);
    res.json({ saved: true, revision: saved.revision, updatedAt: saved.updatedAt });
  });

  app.get('/api/projects/:projectId/versions', requireUser, requireProjectOwner, (req, res) => {
    res.json({ versions: store.listVersions(req.project.id) });
  });

  app.post('/api/projects/:projectId/versions', requireUser, requireProjectOwner, (req, res) => {
    res.status(201).json({ version: store.createVersion(req.project.id, req.user.id) });
  });

  app.post('/api/projects/:projectId/assets', requireUser, requireProjectOwner, upload.single('asset'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '没有收到资源文件。' });
    const asset = store.createAsset({ projectId: req.project.id, ownerId: req.user.id, filename: req.file.originalname, mimeType: req.file.mimetype, storageKey: req.file.path });
    res.status(201).json({ asset });
  });

  app.post('/api/projects/:projectId/tasks', requireUser, requireProjectOwner, (req, res) => {
    const task = store.createTask({ projectId: req.project.id, requestedBy: req.user.id, type: req.body?.type || 'render-preview', payload: req.body?.payload || {} });
    res.status(202).json({ task });
  });

  // ---------------- InkDrift：分段操作存储 ----------------

  // 画卷元信息：版本号 + 段索引(含 x 范围) + 缩略图时间，客户端据此懒加载。
  app.get('/api/projects/:projectId/inkdrift', requireUser, requireProjectOwner, (req, res) => {
    const meta = inkdrift.getMeta(req.project.id);
    res.json({ version: meta.version, opCount: meta.opCount, segments: meta.segments, thumbAt: meta.thumbAt || null, updatedAt: meta.updatedAt });
  });

  // 拉取操作：after=本地版本；x0/x1 视口范围(全局操作如 undo 始终返回)。
  app.get('/api/projects/:projectId/inkdrift/ops', requireUser, requireProjectOwner, (req, res) => {
    const after = Math.max(0, Number(req.query.after) || 0);
    const x0 = req.query.x0 != null ? Number(req.query.x0) : null;
    const x1 = req.query.x1 != null ? Number(req.query.x1) : null;
    const result = inkdrift.getOps(req.project.id, { after, x0, x1 });
    res.json(result);
  });

  // 追加一段操作(断网补传也走这里)：baseVersion 不一致返回 409 + 当前版本。
  app.post('/api/projects/:projectId/inkdrift/segments', requireUser, requireProjectOwner, (req, res) => {
    const { baseVersion, ops } = req.body || {};
    if (!Number.isInteger(baseVersion) || !Array.isArray(ops)) return res.status(400).json({ error: '需要 baseVersion 与 ops 数组。' });
    try {
      const result = inkdrift.appendSegment(req.project.id, baseVersion, ops);
      store.touchProject(req.project.id);
      res.status(201).json(result);
    } catch (err) {
      if (err.code === 'CONFLICT') return res.status(409).json({ error: '画布版本已变化，请先同步。', currentVersion: err.currentVersion });
      if (err.code === 'TOO_LARGE') return res.status(413).json({ error: err.message });
      throw err;
    }
  });

  // 缩略图：客户端空闲时把视口快照传上来，用于列表页与超长画卷的快速预览。
  app.put('/api/projects/:projectId/inkdrift/thumbnail', requireUser, requireProjectOwner, (req, res) => {
    const dataUrl = req.body?.dataUrl || '';
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) return res.status(400).json({ error: '缩略图必须是 PNG dataURL。' });
    const buffer = Buffer.from(match[1], 'base64');
    if (buffer.length > 2 * 1024 * 1024) return res.status(413).json({ error: '缩略图过大。' });
    inkdrift.saveThumbnail(req.project.id, buffer);
    res.json({ saved: true });
  });

  app.get('/api/projects/:projectId/inkdrift/thumbnail.png', requireUser, requireProjectOwner, (req, res) => {
    const buffer = inkdrift.getThumbnail(req.project.id);
    if (!buffer) return res.status(404).json({ error: '还没有缩略图。' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(buffer);
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: '服务器暂时无法完成这个请求。' });
  });

  return app;
}
