import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { LIBRARY_ASSETS } from './librarySeed.js';
import { HENSHIN_TEMPLATES } from './henshinSeed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.ATLAS_DATA_DIR
  ? path.resolve(process.env.ATLAS_DATA_DIR)
  : path.resolve(here, '../data');
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
    progress INTEGER NOT NULL DEFAULT 0,
    result TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  );

  -- 变身演出生成台 --------------------------------------------------------
  -- 1) 模板定义（内置只读：三个截然不同的镜头顺序 / 布局 / 动画逻辑）
  CREATE TABLE IF NOT EXISTS henshin_templates (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    layout TEXT NOT NULL,
    renderer TEXT NOT NULL,
    accent TEXT NOT NULL,
    definition TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  -- 2) 用户配置：每个项目至多一份（唯一约束），切模板即整份替换
  CREATE TABLE IF NOT EXISTS henshin_configs (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    template_slug TEXT NOT NULL REFERENCES henshin_templates(slug),
    config TEXT NOT NULL,
    updated_by TEXT NOT NULL REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  -- 3) 资源引用：异步处理的音频 / 符号 / 遮罩资源
  CREATE TABLE IF NOT EXISTS henshin_resources (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    task_id TEXT REFERENCES async_tasks(id),
    status TEXT NOT NULL DEFAULT 'pending',
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  -- 4) 生成版本：每次「发布」都快照一份不可变的演出定义
  CREATE TABLE IF NOT EXISTS henshin_renderings (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    template_slug TEXT NOT NULL REFERENCES henshin_templates(slug),
    name TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    task_id TEXT REFERENCES async_tasks(id),
    status TEXT NOT NULL DEFAULT 'rendering',
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    UNIQUE(project_id, version_number)
  );
  CREATE INDEX IF NOT EXISTS idx_henshin_resources_project ON henshin_resources(project_id);
  CREATE INDEX IF NOT EXISTS idx_henshin_renderings_project ON henshin_renderings(project_id);
  CREATE INDEX IF NOT EXISTS idx_async_tasks_project ON async_tasks(project_id);

  -- 战斗素材库（内置，只读）
  CREATE TABLE IF NOT EXISTS library_assets (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    svg TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  -- 十秒动作片段：version 是乐观锁版本号，用于拦截多标签页并发覆盖
  CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    duration REAL NOT NULL DEFAULT 10,
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS clip_layers (
    id TEXT PRIMARY KEY,
    clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    asset_id TEXT NOT NULL REFERENCES library_assets(id),
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS clip_keyframes (
    id TEXT PRIMARY KEY,
    layer_id TEXT NOT NULL REFERENCES clip_layers(id) ON DELETE CASCADE,
    time REAL NOT NULL,
    easing TEXT NOT NULL DEFAULT 'linear',
    x REAL NOT NULL DEFAULT 0,
    y REAL NOT NULL DEFAULT 0,
    scale REAL NOT NULL DEFAULT 1,
    rotation REAL NOT NULL DEFAULT 0,
    opacity REAL NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS clip_camera_actions (
    id TEXT PRIMARY KEY,
    clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_keyframes_layer ON clip_keyframes(layer_id);
  CREATE INDEX IF NOT EXISTS idx_camera_clip ON clip_camera_actions(clip_id);
  CREATE INDEX IF NOT EXISTS idx_layers_clip ON clip_layers(clip_id);
`);

const categoryColumns = db.prepare('PRAGMA table_info(categories)').all();
if (!categoryColumns.some((column) => column.name === 'kind')) db.exec("ALTER TABLE categories ADD COLUMN kind TEXT NOT NULL DEFAULT ''");

// 既有数据库的 async_tasks 迁移：异步资源处理需要可查询的进度 / 结果
{
  const taskColumns = db.prepare('PRAGMA table_info(async_tasks)').all().map((column) => column.name);
  if (!taskColumns.includes('progress')) db.exec('ALTER TABLE async_tasks ADD COLUMN progress INTEGER NOT NULL DEFAULT 0');
  if (!taskColumns.includes('result')) db.exec('ALTER TABLE async_tasks ADD COLUMN result TEXT');
  if (!taskColumns.includes('error')) db.exec('ALTER TABLE async_tasks ADD COLUMN error TEXT');
  if (!taskColumns.includes('updated_at')) db.exec("ALTER TABLE async_tasks ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
}

// 素材库以种子数据为准（内置只读，按 id 对齐，SVG 更新后重启即生效）
{
  const upsertAsset = db.prepare('INSERT INTO library_assets (id, type, name, tags, svg, sort_order) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET type = excluded.type, name = excluded.name, tags = excluded.tags, svg = excluded.svg, sort_order = excluded.sort_order');
  db.exec('BEGIN');
  try {
    LIBRARY_ASSETS.forEach((asset, index) => upsertAsset.run(asset.id, asset.type, asset.name, asset.tags, asset.svg, index));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

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

// 变身模板以种子定义为准（内置只读，重启即对齐）
{
  const upsertTemplate = db.prepare(`INSERT INTO henshin_templates (slug, name, subtitle, description, layout, renderer, accent, definition, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET name = excluded.name, subtitle = excluded.subtitle, description = excluded.description,
      layout = excluded.layout, renderer = excluded.renderer, accent = excluded.accent, definition = excluded.definition, sort_order = excluded.sort_order`);
  db.exec('BEGIN');
  try {
    HENSHIN_TEMPLATES.forEach((template, index) => {
      const { slug, name, subtitle, description, layout, renderer, accent } = template;
      upsertTemplate.run(slug, name, subtitle, description, layout, renderer, accent, JSON.stringify(template), index);
    });
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export default db;
