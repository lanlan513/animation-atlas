import crypto from 'node:crypto';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import db from './db.js';
import { registerComicRoutes } from './comic.js';

const app = express();
const port = Number(process.env.PORT || 4000);
fs.mkdirSync('server/data/uploads', { recursive: true });
const upload = multer({ dest: 'server/data/uploads/', limits: { fileSize: 25 * 1024 * 1024 } });
const allowedOrigins = new Set([process.env.CLIENT_ORIGIN || 'http://localhost:5173', 'http://127.0.0.1:5173']);
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)) }));
app.use(express.json({ limit: '2mb' }));

const publicUser = (user) => ({ id: user.id, displayName: user.display_name, email: user.email, isGuest: Boolean(user.is_guest) });
const findUser = (id) => id && db.prepare('SELECT * FROM users WHERE id = ?').get(id);

function requireUser(req, res, next) {
  const user = findUser(req.header('x-user-id'));
  if (!user) return res.status(401).json({ error: '身份已失效，请重新进入访客模式。' });
  req.user = user;
  next();
}

function requireProjectOwner(req, res, next) {
  const project = db.prepare('SELECT p.*, c.slug AS category_slug, c.name AS category_name, c.kind AS category_kind, c.accent, c.glyph FROM projects p JOIN categories c ON c.id = p.category_id WHERE p.id = ? AND p.owner_id = ?').get(req.params.projectId, req.user.id);
  if (!project) return res.status(404).json({ error: '找不到这个项目，或你没有访问权限。' });
  req.project = project;
  next();
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'animation-atlas-api' }));

app.post('/api/auth/guest', (_req, res) => {
  const id = crypto.randomUUID();
  const displayName = `Guest ${id.slice(0, 4).toUpperCase()}`;
  db.prepare('INSERT INTO users (id, display_name, is_guest) VALUES (?, ?, 1)').run(id, displayName);
  res.status(201).json({ user: publicUser(findUser(id)) });
});

app.post('/api/auth/register', (req, res) => {
  const { email, password, displayName } = req.body || {};
  if (!email || !password || !displayName) return res.status(400).json({ error: '请填写邮箱、密码和显示名称。' });
  if (password.length < 8) return res.status(400).json({ error: '密码至少需要 8 个字符。' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase())) return res.status(409).json({ error: '这个邮箱已经注册。' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, email, password_hash, display_name, is_guest) VALUES (?, ?, ?, ?, 0)').run(id, email.toLowerCase(), bcrypt.hashSync(password, 10), displayName.trim());
  res.status(201).json({ user: publicUser(findUser(id)) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email?.toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash || '')) return res.status(401).json({ error: '邮箱或密码不正确。' });
  res.json({ user: publicUser(user) });
});

app.get('/api/auth/me', requireUser, (req, res) => res.json({ user: publicUser(req.user) }));

app.get('/api/categories', (_req, res) => res.json({ categories: db.prepare('SELECT * FROM categories ORDER BY sort_order').all() }));

app.get('/api/projects', requireUser, (req, res) => {
  const projects = db.prepare(`SELECT p.id, p.name, p.description, p.status, p.created_at AS createdAt, p.updated_at AS updatedAt,
      c.slug AS categorySlug, c.name AS categoryName, c.kind AS categoryKind, c.accent, c.glyph,
      d.revision AS draftRevision, d.updated_at AS draftUpdatedAt
    FROM projects p JOIN categories c ON c.id = p.category_id LEFT JOIN drafts d ON d.project_id = p.id
    WHERE p.owner_id = ? ORDER BY p.updated_at DESC`).all(req.user.id);
  res.json({ projects });
});

app.post('/api/projects', requireUser, (req, res) => {
  const { name, categorySlug, description = '' } = req.body || {};
  const category = db.prepare('SELECT * FROM categories WHERE slug = ?').get(categorySlug);
  if (!name?.trim() || !category) return res.status(400).json({ error: '项目名称和实验室入口不能为空。' });
  const id = crypto.randomUUID();
  const draftId = crypto.randomUUID();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO projects (id, owner_id, category_id, name, description) VALUES (?, ?, ?, ?, ?)').run(id, req.user.id, category.id, name.trim(), description.trim());
    db.prepare('INSERT INTO drafts (id, project_id, content) VALUES (?, ?, ?)').run(draftId, id, JSON.stringify({ nodes: [], settings: {} }));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.status(201).json({ project: db.prepare(`SELECT p.id, p.name, p.description, p.status, p.created_at AS createdAt, p.updated_at AS updatedAt, c.slug AS categorySlug, c.name AS categoryName, c.kind AS categoryKind, c.accent, c.glyph, 1 AS draftRevision FROM projects p JOIN categories c ON c.id = p.category_id WHERE p.id = ?`).get(id) });
});

app.get('/api/projects/:projectId', requireUser, requireProjectOwner, (req, res) => {
  const draft = db.prepare('SELECT content, revision, updated_at AS updatedAt FROM drafts WHERE project_id = ?').get(req.project.id);
  res.json({ project: { ...req.project, draft: draft ? { ...draft, content: JSON.parse(draft.content) } : null } });
});

app.put('/api/projects/:projectId/drafts', requireUser, requireProjectOwner, (req, res) => {
  const content = req.body?.content;
  if (!content || typeof content !== 'object') return res.status(400).json({ error: '草稿内容必须是对象。' });
  const current = db.prepare('SELECT revision FROM drafts WHERE project_id = ?').get(req.project.id);
  const revision = (current?.revision || 0) + 1;
  const now = new Date().toISOString();
  db.prepare('UPDATE drafts SET content = ?, revision = ?, updated_at = ? WHERE project_id = ?').run(JSON.stringify(content), revision, now, req.project.id);
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, req.project.id);
  res.json({ saved: true, revision, updatedAt: now });
});

app.get('/api/projects/:projectId/versions', requireUser, requireProjectOwner, (req, res) => {
  const versions = db.prepare('SELECT id, version_number AS versionNumber, created_at AS createdAt, created_by AS createdBy FROM project_versions WHERE project_id = ? ORDER BY version_number DESC').all(req.project.id);
  res.json({ versions });
});

app.post('/api/projects/:projectId/versions', requireUser, requireProjectOwner, (req, res) => {
  const draft = db.prepare('SELECT content FROM drafts WHERE project_id = ?').get(req.project.id);
  const latest = db.prepare('SELECT MAX(version_number) AS version FROM project_versions WHERE project_id = ?').get(req.project.id).version || 0;
  const version = { id: crypto.randomUUID(), projectId: req.project.id, versionNumber: latest + 1, content: draft?.content || '{}', createdBy: req.user.id };
  db.prepare('INSERT INTO project_versions (id, project_id, version_number, content, created_by) VALUES (?, ?, ?, ?, ?)').run(version.id, version.projectId, version.versionNumber, version.content, version.createdBy);
  res.status(201).json({ version: { id: version.id, versionNumber: version.versionNumber } });
});

app.post('/api/projects/:projectId/assets', requireUser, requireProjectOwner, upload.single('asset'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '没有收到资源文件。' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO assets (id, project_id, owner_id, filename, mime_type, storage_key) VALUES (?, ?, ?, ?, ?, ?)').run(id, req.project.id, req.user.id, req.file.originalname, req.file.mimetype, req.file.path);
  res.status(201).json({ asset: { id, filename: req.file.originalname, status: 'pending' } });
});

app.post('/api/projects/:projectId/tasks', requireUser, requireProjectOwner, (req, res) => {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO async_tasks (id, project_id, requested_by, type, payload) VALUES (?, ?, ?, ?, ?)').run(id, req.project.id, req.user.id, req.body?.type || 'render-preview', JSON.stringify(req.body?.payload || {}));
  res.status(202).json({ task: { id, status: 'queued' } });
});

registerComicRoutes(app, { requireUser, requireProjectOwner });

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: '服务器暂时无法完成这个请求。' });
});

app.listen(port, () => console.log(`Animation Atlas API listening on http://localhost:${port}`));
