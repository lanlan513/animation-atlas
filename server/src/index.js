import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import * as store from './store.js';
import { HttpError, ingestFrame, removeFrameFiles, cloneFrameFiles, MAX_INPUT_BYTES } from './image.js';
import { withLock } from './mutex.js';

const app = express();
const port = Number(process.env.PORT || 4000);

// 每个项目的素材配额（正片 + 缩略图）；另有全局限额兜底。
export const PROJECT_QUOTA = Number(process.env.PROJECT_QUOTA_MB || 250) * 1024 * 1024;
export const GLOBAL_QUOTA = Number(process.env.GLOBAL_QUOTA_MB || 2048) * 1024 * 1024;
const DEFAULT_FRAME_MS = 130;
const MIN_MS = 40;
const MAX_MS = 5000;

const allowedOrigins = new Set([process.env.CLIENT_ORIGIN || 'http://localhost:5173', 'http://127.0.0.1:5173']);
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)) }));
app.use(express.json({ limit: '1mb' }));

// 原始上传只进内存，复检管线处理完即释放，绝不直接落盘。
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_INPUT_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return callback(null, true);
    callback(new HttpError(415, '只支持 JPEG / PNG / WebP 图片。'));
  }
});

// ---------- 序列化 ----------
const publicUser = (user) => ({ id: user.id, displayName: user.displayName, email: user.email, isGuest: user.isGuest });

function publicCategory(category) {
  return { id: category.id, slug: category.slug, name: category.name, kind: category.kind, description: category.description, accent: category.accent, glyph: category.glyph, sortOrder: category.sortOrder };
}

const categoryBySlug = (slug) => store.getCategory(slug);

function publicFrame(frame, projectId) {
  return {
    id: frame.id,
    order: frame.order,
    durationMs: frame.durationMs,
    width: frame.width,
    height: frame.height,
    imageBytes: frame.imageBytes,
    thumbBytes: frame.thumbBytes,
    sourceFormat: frame.sourceFormat,
    createdAt: frame.createdAt,
    imageUrl: `/media/${projectId}/${encodeURIComponent(frame.file)}`,
    thumbUrl: `/media/${projectId}/${encodeURIComponent(frame.thumbFile)}`
  };
}

function publicProject(project, { detail = false } = {}) {
  const category = categoryBySlug(project.categorySlug) || {};
  const base = {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    categorySlug: project.categorySlug,
    categoryName: category.name,
    categoryKind: category.kind,
    accent: category.accent,
    glyph: category.glyph,
    frameCount: project.frames.length,
    durationMs: project.frames.reduce((sum, frame) => sum + frame.durationMs, 0),
    usageBytes: store.projectUsage(project),
    quotaBytes: PROJECT_QUOTA,
    draftRevision: project.draft?.revision || 0,
    draftUpdatedAt: project.draft?.updatedAt || null
  };
  if (detail) {
    base.frames = project.frames
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((frame) => publicFrame(frame, project.id));
    base.draft = project.draft ? { content: project.draft.content, revision: project.draft.revision, updatedAt: project.draft.updatedAt } : null;
  }
  return base;
}

// ---------- 鉴权 / 归属 ----------
function requireUser(req, res, next) {
  const user = store.findUser(req.header('x-user-id'));
  if (!user) return res.status(401).json({ error: '身份已失效，请重新进入访客模式。' });
  req.user = user;
  next();
}

function requireProjectOwner(req, res, next) {
  const project = store.getProject(req.params.projectId);
  if (!project || project.ownerId !== req.user.id) {
    return res.status(404).json({ error: '找不到这个项目，或你没有访问权限。' });
  }
  req.project = project;
  next();
}

const clampMs = (value, fallback = DEFAULT_FRAME_MS) => {
  const ms = Math.round(Number(value));
  return Number.isFinite(ms) && ms >= MIN_MS && ms <= MAX_MS ? ms : fallback;
};

// ---------- 基础接口 ----------
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'framemold-api' }));

app.post('/api/auth/guest', (_req, res) => {
  res.status(201).json({ user: publicUser(store.createGuestUser()) });
});

app.post('/api/auth/register', (req, res) => {
  const { email, password, displayName } = req.body || {};
  if (!email || !password || !displayName) return res.status(400).json({ error: '请填写邮箱、密码和显示名称。' });
  if (password.length < 8) return res.status(400).json({ error: '密码至少需要 8 个字符。' });
  const normalizedEmail = String(email).toLowerCase();
  if (store.findUserByEmail(normalizedEmail)) return res.status(409).json({ error: '这个邮箱已经注册。' });
  const user = store.createUser({ email: normalizedEmail, passwordHash: bcrypt.hashSync(password, 10), displayName: String(displayName).trim() });
  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = store.findUserByEmail(String(email || '').toLowerCase());
  if (!user || !user.passwordHash || !bcrypt.compareSync(String(password || ''), user.passwordHash)) {
    return res.status(401).json({ error: '邮箱或密码不正确。' });
  }
  res.json({ user: publicUser(user) });
});

app.get('/api/auth/me', requireUser, (req, res) => res.json({ user: publicUser(req.user) }));

app.get('/api/categories', (_req, res) => {
  res.json({ categories: store.listCategories().map(publicCategory) });
});

// ---------- 项目 ----------
app.get('/api/projects', requireUser, (req, res) => {
  res.json({ projects: store.listProjects(req.user.id).map((project) => publicProject(project)) });
});

app.post('/api/projects', requireUser, (req, res) => {
  const { name, categorySlug, description = '' } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: '项目名称不能为空。' });
  if (!categoryBySlug(categorySlug)) return res.status(400).json({ error: '请选择一个实验室入口。' });
  const project = store.createProject({
    ownerId: req.user.id,
    categorySlug,
    name: String(name).trim(),
    description: String(description || '').trim()
  });
  res.status(201).json({ project: publicProject(project, { detail: true }) });
});

app.get('/api/projects/:projectId', requireUser, requireProjectOwner, (req, res) => {
  res.json({ project: publicProject(req.project, { detail: true }) });
});

app.delete('/api/projects/:projectId', requireUser, requireProjectOwner, (req, res) => {
  store.deleteProject(req.project.id);
  res.json({ deleted: true });
});

// ---------- 草稿（编辑器设置 / 时间尺状态，重开项目时完整还原）----------
app.put('/api/projects/:projectId/drafts', requireUser, requireProjectOwner, (req, res) => {
  const content = req.body?.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return res.status(400).json({ error: '草稿内容必须是对象。' });
  }
  if (JSON.stringify(content).length > 100 * 1024) return res.status(413).json({ error: '草稿内容过大。' });
  const draft = store.saveDraft(req.project, content);
  res.json({ saved: true, revision: draft.revision, updatedAt: draft.updatedAt });
});

// ---------- 版本快照（沿用 Atlas 的 API 边界）----------
app.get('/api/projects/:projectId/versions', requireUser, requireProjectOwner, (req, res) => {
  res.json({ versions: (req.project.versions || []).map((v) => ({ id: v.id, versionNumber: v.versionNumber, createdAt: v.createdAt, createdBy: v.createdBy })) });
});

app.post('/api/projects/:projectId/versions', requireUser, requireProjectOwner, (req, res) => {
  const latest = (req.project.versions || []).reduce((max, v) => Math.max(max, v.versionNumber), 0);
  const version = {
    id: crypto.randomUUID(),
    versionNumber: latest + 1,
    content: JSON.stringify({ frames: req.project.frames, draft: req.project.draft?.content || {} }),
    createdBy: req.user.id,
    createdAt: new Date().toISOString()
  };
  req.project.versions.push(version);
  store.touchProject(req.project);
  res.status(201).json({ version: { id: version.id, versionNumber: version.versionNumber } });
});

// ---------- 存储配额 ----------
app.get('/api/projects/:projectId/quota', requireUser, requireProjectOwner, (req, res) => {
  res.json({
    usageBytes: store.projectUsage(req.project),
    quotaBytes: PROJECT_QUOTA,
    globalUsageBytes: store.globalUsage(),
    globalQuotaBytes: GLOBAL_QUOTA,
    frameCount: req.project.frames.length
  });
});

// ---------- 帧：上传 / 复制 / 删除 / 批量更新 / 重排 ----------
app.post('/api/projects/:projectId/frames', requireUser, requireProjectOwner, upload.single('frame'), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, '没有收到帧图片。');
    const projected = store.projectUsage(req.project) + req.file.size;
    if (projected > PROJECT_QUOTA) {
      throw new HttpError(413, `项目存储配额（${Math.round(PROJECT_QUOTA / 1024 / 1024)}MB）即将用尽，请先删除一些帧。`);
    }
    if (store.globalUsage() + req.file.size > GLOBAL_QUOTA) {
      throw new HttpError(507, '服务器总存储配额已用尽，请清理项目后再试。');
    }
    // 同项目串行：连拍下的 order/order 索引不能互相覆盖。
    const result = await withLock(`project:${req.project.id}`, async () => {
      const processed = await ingestFrame(req.file.buffer, req.project.id);
      const maxOrder = req.project.frames.reduce((max, frame) => Math.max(max, frame.order), -1);
      const frame = {
        id: crypto.randomUUID(),
        order: maxOrder + 1,
        durationMs: clampMs(req.body?.durationMs),
        ...processed
      };
      req.project.frames.push(frame);
      store.touchProject(req.project);
      return frame;
    });
    res.status(201).json({ frame: publicFrame(result, req.project.id), usageBytes: store.projectUsage(req.project), quotaBytes: PROJECT_QUOTA });
  } catch (error) { next(error); }
});

app.post('/api/projects/:projectId/frames/:frameId/duplicate', requireUser, requireProjectOwner, (req, res, next) => {
  try {
    withLock(`project:${req.project.id}`, () => {
      const index = req.project.frames.findIndex((frame) => frame.id === req.params.frameId);
      if (index === -1) throw new HttpError(404, '找不到要复制的帧。');
      const source = req.project.frames[index];
      if (store.projectUsage(req.project) + source.imageBytes + source.thumbBytes > PROJECT_QUOTA) {
        throw new HttpError(413, `项目存储配额（${Math.round(PROJECT_QUOTA / 1024 / 1024)}MB）即将用尽，请先删除一些帧。`);
      }
      // 磁盘上复制一份独立文件，再做 order 重排：新帧插在源帧后面。
      const files = cloneFrameFiles(req.project.id, source);
      req.project.frames.forEach((frame) => { if (frame.order > source.order) frame.order += 1; });
      const copy = { ...source, ...files, id: crypto.randomUUID(), order: source.order + 1, createdAt: new Date().toISOString() };
      req.project.frames.push(copy);
      store.touchProject(req.project);
      res.status(201).json({
        frame: publicFrame(copy, req.project.id),
        frames: req.project.frames.slice().sort((a, b) => a.order - b.order).map((f) => ({ id: f.id, order: f.order })),
        usageBytes: store.projectUsage(req.project),
        quotaBytes: PROJECT_QUOTA
      });
    }).catch(next);
  } catch (error) { next(error); }
});

app.delete('/api/projects/:projectId/frames/:frameId', requireUser, requireProjectOwner, (req, res, next) => {
  withLock(`project:${req.project.id}`, () => {
    const index = req.project.frames.findIndex((frame) => frame.id === req.params.frameId);
    if (index === -1) throw new HttpError(404, '找不到要删除的帧。');
    const [removed] = req.project.frames.splice(index, 1);
    req.project.frames.forEach((frame) => { if (frame.order > removed.order) frame.order -= 1; });
    removeFrameFiles(req.project.id, removed);
    store.touchProject(req.project);
    res.json({ deleted: removed.id, usageBytes: store.projectUsage(req.project), quotaBytes: PROJECT_QUOTA });
  }).catch(next);
});

// 批量调整帧时长：{ frameIds: string[], durationMs: number }，空数组表示全部帧。
app.patch('/api/projects/:projectId/frames', requireUser, requireProjectOwner, (req, res, next) => {
  withLock(`project:${req.project.id}`, () => {
    const { frameIds = null, durationMs } = req.body || {};
    if (!Number.isFinite(Number(durationMs))) throw new HttpError(400, '帧时长必须是数字。');
    const ms = clampMs(durationMs, NaN);
    if (Number.isNaN(ms)) throw new HttpError(422, `帧时长需在 ${MIN_MS}–${MAX_MS} 毫秒之间。`);
    const targets = Array.isArray(frameIds) && frameIds.length > 0
      ? new Set(frameIds)
      : null;
    let touched = 0;
    for (const frame of req.project.frames) {
      if (!targets || targets.has(frame.id)) { frame.durationMs = ms; touched += 1; }
    }
    if (targets && touched === 0) throw new HttpError(404, '没有找到要调整的帧。');
    store.touchProject(req.project);
    res.json({
      updated: touched,
      frames: req.project.frames.slice().sort((a, b) => a.order - b.order).map((frame) => ({ id: frame.id, order: frame.order, durationMs: frame.durationMs }))
    });
  }).catch(next);
});

// 时间尺拖拽排序：{ orders: [{ id, order }, ...] }，必须覆盖全部帧且 order 无重复。
app.put('/api/projects/:projectId/frames/order', requireUser, requireProjectOwner, (req, res, next) => {
  withLock(`project:${req.project.id}`, () => {
    const orders = req.body?.orders;
    if (!Array.isArray(orders)) throw new HttpError(400, 'orders 必须是数组。');
    const byId = new Map(req.project.frames.map((frame) => [frame.id, frame]));
    const nextOrders = [];
    for (const item of orders) {
      const frame = byId.get(item?.id);
      const order = Number(item?.order);
      if (!frame || !Number.isInteger(order) || order < 0) throw new HttpError(400, '排序数据包含无效帧。');
      nextOrders.push(order);
    }
    if (orders.length !== req.project.frames.length || new Set(nextOrders).size !== req.project.frames.length) {
      throw new HttpError(409, '排序数据与当前帧序列不一致，请刷新后重试。');
    }
    for (const item of orders) byId.get(item.id).order = Number(item.order);
    store.touchProject(req.project);
    res.json({
      frames: req.project.frames.slice().sort((a, b) => a.order - b.order).map((frame) => ({ id: frame.id, order: frame.order }))
    });
  }).catch(next);
});

// ---------- 媒体文件：只允许访问本项目目录下的已登记 jpg，防目录穿越 ----------
app.get('/media/:projectId/:file', (req, res, next) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).end();
  const name = req.params.file;
  if (!/^[0-9a-f-]{36}(-thumb)?\.jpg$/i.test(name)) return res.status(400).end();
  const registered = project.frames.some((frame) => frame.file === name || frame.thumbFile === name);
  if (!registered) return res.status(404).end();
  res.sendFile(path.join(store.mediaDir, project.id, name), (error) => {
    if (!error) return;
    if (error.code === 'ENOENT') res.status(404).json({ error: '素材文件已不存在。' });
    else next(error);
  });
});

// ---------- 错误处理 ----------
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `单张图片不能超过 ${MAX_INPUT_BYTES / 1024 / 1024}MB，请在客户端压缩后再拍。` });
    }
    return res.status(400).json({ error: '上传失败，请换一张图片试试。' });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: '请求内容无法解析。' });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: '服务器暂时无法完成这个请求。' });
});

app.listen(port, () => console.log(`FrameMold API listening on http://localhost:${port}`));
