import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 优先使用 Node 22+ 内置的 node:sqlite，旧版本 Node 回退到 better-sqlite3（两者 API 兼容）。
let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  ({ default: DatabaseSync } = await import('better-sqlite3'));
}

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'animation-atlas.db'));
if (typeof db.pragma === 'function') { db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); }
else db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    display_name TEXT NOT NULL,
    is_guest INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL,
    accent TEXT NOT NULL,
    glyph TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    category_id TEXT NOT NULL REFERENCES categories(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    project_id TEXT UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '{}',
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS project_versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, version_number)
  );
  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES users(id),
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS async_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    requested_by TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'queued',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS comic_chapters (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    chapter_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, chapter_number)
  );
  CREATE TABLE IF NOT EXISTS comic_pages (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL REFERENCES comic_chapters(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    width INTEGER NOT NULL DEFAULT 1200,
    height INTEGER NOT NULL DEFAULT 1600,
    background TEXT NOT NULL DEFAULT '{}',
    actors TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(chapter_id, page_number)
  );
  CREATE TABLE IF NOT EXISTS comic_panels (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES comic_pages(id) ON DELETE CASCADE,
    panel_key TEXT NOT NULL,
    reading_order INTEGER NOT NULL DEFAULT 0,
    polygon TEXT NOT NULL DEFAULT '[]',
    focus TEXT NOT NULL DEFAULT '{}',
    art TEXT NOT NULL DEFAULT '{}',
    degraded INTEGER NOT NULL DEFAULT 0,
    issues TEXT NOT NULL DEFAULT '[]',
    UNIQUE(page_id, panel_key)
  );
  CREATE TABLE IF NOT EXISTS comic_beats (
    id TEXT PRIMARY KEY,
    panel_id TEXT NOT NULL REFERENCES comic_panels(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL DEFAULT 0,
    type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    duration_ms INTEGER NOT NULL DEFAULT 900,
    delay_ms INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS comic_progress (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    page_id TEXT,
    panel_id TEXT,
    reading_order INTEGER NOT NULL DEFAULT 0,
    mode TEXT NOT NULL DEFAULT 'free',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, project_id)
  );
`);

const categoryColumns = db.prepare('PRAGMA table_info(categories)').all();
if (!categoryColumns.some((column) => column.name === 'kind')) db.exec("ALTER TABLE categories ADD COLUMN kind TEXT NOT NULL DEFAULT ''");

const labs = [
  ['sakuga-spark', 'Sakuga Spark', '日漫', '高能关键帧与冲击节奏实验。', '#f2674a', '✦', 1],
  ['panel-punch', 'Panel Punch', '美漫', '漫画节奏、强切与图形转场实验。', '#f4b942', '▦', 2],
  ['frame-mold', 'FrameMold', '定格动画', '一帧一帧建立形状语言。', '#8bd5ca', '◈', 3],
  ['pixelpulse', 'PixelPulse', '像素动画', '微小像素、强烈节拍与清晰循环。', '#74a9ff', '▥', 4],
  ['inkdrift', 'InkDrift', '水墨动画', '像呼吸一样流动的有机线条。', '#c69cff', '〰', 5],
  ['motion-rift', 'Motion Rift', '实验动画', '拉伸、拖影与姿态之间的空间弯折。', '#ff7eb6', '◒', 6]
];

const count = db.prepare('SELECT COUNT(*) AS count FROM categories').get().count;
if (count === 0) {
  const insert = db.prepare('INSERT INTO categories (id, slug, name, kind, description, accent, glyph, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  try { labs.forEach((lab) => insert.run(crypto.randomUUID(), ...lab)); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

const updateLab = db.prepare('UPDATE categories SET name = ?, kind = ?, description = ?, accent = ?, glyph = ?, sort_order = ? WHERE slug = ?');
for (const [slug, name, kind, description, accent, glyph, sortOrder] of labs) updateLab.run(name, kind, description, accent, glyph, sortOrder, slug);

export default db;
