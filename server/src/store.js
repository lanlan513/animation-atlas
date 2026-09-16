import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, process.env.ATLAS_DATA_DIR || '../data');
fs.mkdirSync(dataDir, { recursive: true });

const storeFile = path.join(dataDir, 'store.json');

function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function emptyStore() {
  return { users: [], categories: [], projects: [], drafts: {}, versions: [], assets: [], tasks: [] };
}

function load() {
  try { return { ...emptyStore(), ...JSON.parse(fs.readFileSync(storeFile, 'utf8')) }; }
  catch { return emptyStore(); }
}

let state = load();
let saveTimer = null;

export function persist(immediate = false) {
  if (immediate) { atomicWrite(storeFile, JSON.stringify(state)); return; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => atomicWrite(storeFile, JSON.stringify(state)), 120);
}

const now = () => new Date().toISOString();

const labs = [
  ['sakuga-spark', 'Sakuga Spark', '日漫', '高能关键帧与冲击节奏实验。', '#f2674a', '✦', 1],
  ['panel-punch', 'Panel Punch', '美漫', '漫画节奏、强切与图形转场实验。', '#f4b942', '▦', 2],
  ['frame-mold', 'FrameMold', '定格动画', '一帧一帧建立形状语言。', '#8bd5ca', '◈', 3],
  ['pixelpulse', 'PixelPulse', '像素动画', '微小像素、强烈节拍与清晰循环。', '#74a9ff', '▥', 4],
  ['inkdrift', 'InkDrift', '水墨动画', '像呼吸一样流动的有机线条。', '#c69cff', '〰', 5],
  ['motion-rift', 'Motion Rift', '实验动画', '拉伸、拖影与姿态之间的空间弯折。', '#ff7eb6', '◒', 6]
];

if (state.categories.length === 0) {
  state.categories = labs.map(([slug, name, kind, description, accent, glyph, sortOrder]) => ({
    id: crypto.randomUUID(), slug, name, kind, description, accent, glyph, sortOrder
  }));
  persist(true);
}

export const store = {
  // ---- users ----
  createUser({ email = null, passwordHash = null, displayName, isGuest = 1 }) {
    const user = { id: crypto.randomUUID(), email, password_hash: passwordHash, display_name: displayName, is_guest: isGuest, created_at: now() };
    state.users.push(user); persist();
    return user;
  },
  findUser(id) { return state.users.find((u) => u.id === id) || null; },
  findUserByEmail(email) { return state.users.find((u) => u.email === String(email).toLowerCase()) || null; },

  // ---- categories ----
  listCategories() { return [...state.categories].sort((a, b) => a.sortOrder - b.sortOrder); },
  findCategoryBySlug(slug) { return state.categories.find((c) => c.slug === slug) || null; },

  // ---- projects ----
  createProject({ ownerId, categoryId, name, description = '' }) {
    const project = { id: crypto.randomUUID(), owner_id: ownerId, category_id: categoryId, name, description, status: 'draft', created_at: now(), updated_at: now() };
    state.projects.push(project);
    state.drafts[project.id] = { id: crypto.randomUUID(), project_id: project.id, content: JSON.stringify({ nodes: [], settings: {} }), revision: 1, updated_at: now() };
    persist();
    return project;
  },
  findProject(id, ownerId) { return state.projects.find((p) => p.id === id && p.owner_id === ownerId) || null; },
  decorateProject(p) {
    const c = state.categories.find((cat) => cat.id === p.category_id) || {};
    const d = state.drafts[p.id];
    return {
      id: p.id, name: p.name, description: p.description, status: p.status,
      createdAt: p.created_at, updatedAt: p.updated_at,
      categorySlug: c.slug, categoryName: c.name, categoryKind: c.kind, accent: c.accent, glyph: c.glyph,
      draftRevision: d?.revision, draftUpdatedAt: d?.updated_at
    };
  },
  listProjects(ownerId) {
    return state.projects.filter((p) => p.owner_id === ownerId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((p) => this.decorateProject(p));
  },
  touchProject(id) { const p = state.projects.find((x) => x.id === id); if (p) { p.updated_at = now(); persist(); } },

  // ---- drafts ----
  getDraft(projectId) {
    const d = state.drafts[projectId];
    return d ? { content: JSON.parse(d.content), revision: d.revision, updatedAt: d.updated_at } : null;
  },
  saveDraft(projectId, content) {
    const d = state.drafts[projectId];
    if (!d) return null;
    d.content = JSON.stringify(content); d.revision += 1; d.updated_at = now();
    this.touchProject(projectId); persist();
    return { revision: d.revision, updatedAt: d.updated_at };
  },

  // ---- versions ----
  listVersions(projectId) {
    return state.versions.filter((v) => v.project_id === projectId)
      .sort((a, b) => b.version_number - a.version_number)
      .map((v) => ({ id: v.id, versionNumber: v.version_number, createdAt: v.created_at, createdBy: v.created_by }));
  },
  createVersion(projectId, createdBy) {
    const d = state.drafts[projectId];
    const latest = state.versions.filter((v) => v.project_id === projectId).reduce((m, v) => Math.max(m, v.version_number), 0);
    const version = { id: crypto.randomUUID(), project_id: projectId, version_number: latest + 1, content: d?.content || '{}', created_by: createdBy, created_at: now() };
    state.versions.push(version); persist();
    return { id: version.id, versionNumber: version.version_number };
  },

  // ---- assets / tasks ----
  createAsset({ projectId, ownerId, filename, mimeType, storageKey }) {
    const asset = { id: crypto.randomUUID(), project_id: projectId, owner_id: ownerId, filename, mime_type: mimeType, storage_key: storageKey, status: 'pending', created_at: now() };
    state.assets.push(asset); persist();
    return { id: asset.id, filename: asset.filename, status: asset.status };
  },
  createTask({ projectId, requestedBy, type, payload }) {
    const task = { id: crypto.randomUUID(), project_id: projectId, requested_by: requestedBy, type, payload: JSON.stringify(payload || {}), status: 'queued', created_at: now() };
    state.tasks.push(task); persist();
    return { id: task.id, status: task.status };
  }
};

export const dataRoot = dataDir;
