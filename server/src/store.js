// FrameMold 的轻量文档存储：单用户本地工具，所有数据在内存中维护，
// 通过「写临时文件 + rename」原子落盘，避免写到一半的 JSON 损坏项目进度。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const dataDir = path.resolve(here, '../data');
export const mediaDir = path.join(dataDir, 'media');
fs.mkdirSync(mediaDir, { recursive: true });

const DB_FILE = path.join(dataDir, 'animation-atlas.json');

const emptyData = () => ({ users: {}, categories: [], projects: {} });
let data;
try {
  data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (typeof data !== 'object' || data === null) throw new Error('bad shape');
} catch {
  data = emptyData();
}
data.users ||= {};
data.categories ||= [];
data.projects ||= {};

// 落盘做短防抖：连续拍摄几十帧时不会每帧都刷磁盘，但退出前一定会 flush。
let flushTimer = null;
let flushChain = Promise.resolve();
function scheduleFlush() {
  if (flushTimer) return flushChain;
  flushChain = new Promise((resolve) => {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      try {
        const tmp = `${DB_FILE}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data));
        fs.renameSync(tmp, DB_FILE);
      } catch (error) {
        console.error('[store] 落盘失败：', error.message);
      }
      resolve();
    }, 80);
  });
  return flushChain;
}

export function flushNow() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  try {
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, DB_FILE);
  } catch (error) {
    console.error('[store] 同步落盘失败：', error.message);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { flushNow(); process.exit(0); });
}

const LABS = [
  ['sakuga-spark', 'Sakuga Spark', '日漫', '高能关键帧与冲击节奏实验。', '#f2674a', '✦', 1],
  ['panel-punch', 'Panel Punch', '美漫', '漫画节奏、强切与图形转场实验。', '#f4b942', '▦', 2],
  ['frame-mold', 'FrameMold', '定格动画', '黏土逐帧拍摄台：一帧一帧校正模型的位置。', '#8bd5ca', '◈', 3],
  ['pixelpulse', 'PixelPulse', '像素动画', '微小像素、强烈节拍与清晰循环。', '#74a9ff', '▥', 4],
  ['inkdrift', 'InkDrift', '水墨动画', '像呼吸一样流动的有机线条。', '#c69cff', '〰', 5],
  ['motion-rift', 'Motion Rift', '实验动画', '拉伸、拖影与姿态之间的空间弯折。', '#ff7eb6', '◒', 6]
];

if (data.categories.length === 0) {
  data.categories = LABS.map(([slug, name, kind, description, accent, glyph, sortOrder]) => ({ id: crypto.randomUUID(), slug, name, kind, description, accent, glyph, sortOrder }));
  scheduleFlush();
} else {
  // 保证实验室元信息（名称、描述、配色）跟代码保持同步。
  for (const lab of LABS) {
    const [slug, name, kind, description, accent, glyph, sortOrder] = lab;
    const category = data.categories.find((item) => item.slug === slug);
    if (category) Object.assign(category, { name, kind, description, accent, glyph, sortOrder });
  }
}

const now = () => new Date().toISOString();

// ---------- users ----------
export function createGuestUser() {
  const id = crypto.randomUUID();
  const user = { id, email: null, passwordHash: null, displayName: `Guest ${id.slice(0, 4).toUpperCase()}`, isGuest: true, createdAt: now() };
  data.users[id] = user;
  scheduleFlush();
  return user;
}
export function createUser({ email, passwordHash, displayName }) {
  const id = crypto.randomUUID();
  const user = { id, email, passwordHash, displayName, isGuest: false, createdAt: now() };
  data.users[id] = user;
  scheduleFlush();
  return user;
}
export const findUser = (id) => (id && data.users[id]) || null;
export const findUserByEmail = (email) => Object.values(data.users).find((user) => user.email === email) || null;

// ---------- projects ----------
export const listCategories = () => data.categories;
export const getCategory = (slug) => data.categories.find((category) => category.slug === slug) || null;

export function listProjects(ownerId) {
  return Object.values(data.projects)
    .filter((project) => project.ownerId === ownerId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function createProject({ ownerId, categorySlug, name, description = '' }) {
  const id = crypto.randomUUID();
  const timestamp = now();
  const project = {
    id, ownerId, categorySlug, name, description, status: 'draft',
    createdAt: timestamp, updatedAt: timestamp,
    frames: [],
    draft: { content: { settings: {} }, revision: 1, updatedAt: timestamp },
    versions: []
  };
  data.projects[id] = project;
  fs.mkdirSync(path.join(mediaDir, id), { recursive: true });
  scheduleFlush();
  return project;
}

export const getProject = (id) => data.projects[id] || null;

export function touchProject(project) { project.updatedAt = now(); scheduleFlush(); }

export function deleteProject(id) {
  const project = data.projects[id];
  if (!project) return false;
  delete data.projects[id];
  fs.rmSync(path.join(mediaDir, id), { recursive: true, force: true });
  scheduleFlush();
  return true;
}

// ---------- frames ----------
export const projectUsage = (project) =>
  project.frames.reduce((total, frame) => total + frame.imageBytes + frame.thumbBytes, 0);

export const globalUsage = () =>
  Object.values(data.projects).reduce((total, project) => total + projectUsage(project), 0);

export function saveDraft(project, content) {
  project.draft = { content, revision: (project.draft?.revision || 0) + 1, updatedAt: now() };
  project.updatedAt = project.draft.updatedAt;
  scheduleFlush();
  return project.draft;
}

export { scheduleFlush as persist };
