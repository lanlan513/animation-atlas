import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'animation-atlas.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

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
`);

const labs = [
  ['sakuga-spark', '作画火花', '高能关键帧与冲击节奏实验。', '#f2674a', '✦', 1],
  ['panel-punch', '分镜重击', '漫画节奏、强切与图形转场实验。', '#f4b942', '▦', 2],
  ['frame-mold', '帧塑', '一帧一帧建立形状语言。', '#8bd5ca', '◈', 3],
  ['pixelpulse', '像素脉冲', '微小像素、强烈节拍与清晰循环。', '#74a9ff', '▥', 4],
  ['inkdrift', '墨迹漂移', '像呼吸一样流动的有机线条。', '#c69cff', '〰', 5],
  ['motion-rift', '动势裂隙', '拉伸、拖影与姿态之间的空间弯折。', '#ff7eb6', '◒', 6]
];

const count = db.prepare('SELECT COUNT(*) AS count FROM categories').get().count;
if (count === 0) {
  const insert = db.prepare('INSERT INTO categories (id, slug, name, description, accent, glyph, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  try { labs.forEach((lab) => insert.run(crypto.randomUUID(), ...lab)); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

const updateLab = db.prepare('UPDATE categories SET name = ?, description = ?, accent = ?, glyph = ?, sort_order = ? WHERE slug = ?');
for (const [slug, name, description, accent, glyph, sortOrder] of labs) updateLab.run(name, description, accent, glyph, sortOrder, slug);

export default db;
