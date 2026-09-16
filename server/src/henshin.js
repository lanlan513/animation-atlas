// 变身演出生成台：配置 / 资源引用 / 生成版本的数据访问。
import crypto from 'node:crypto';
import db from './db.js';
import { HENSHIN_TEMPLATE_BY_SLUG } from './henshinSeed.js';
import {
  configWithDefaults, validateHenshinConfig, validateHenshinResource
} from './henshinSchema.js';
import { HENSHIN_TASK_TYPES, enqueueTask } from './henshinTasks.js';

export class HenshinValidationError extends Error {
  constructor(errors) {
    super(errors[0]?.message || '演出配置校验失败。');
    this.errors = Array.isArray(errors) ? errors : [{ code: 'BAD_REQUEST', message: String(errors), path: null }];
  }
}

// ---------- 模板 ----------
export function listTemplates() {
  return db.prepare('SELECT slug, name, subtitle, description, layout, renderer, accent, definition, sort_order AS sortOrder FROM henshin_templates ORDER BY sort_order').all()
    .map((row) => ({ slug: row.slug, name: row.name, subtitle: row.subtitle, description: row.description, layout: row.layout, renderer: row.renderer, accent: row.accent, ...JSON.parse(row.definition) }));
}

export function getTemplate(slug) {
  const row = db.prepare('SELECT definition FROM henshin_templates WHERE slug = ?').get(slug);
  return row ? JSON.parse(row.definition) : null;
}

// ---------- 用户配置 ----------
export function getConfig(projectId) {
  const row = db.prepare('SELECT * FROM henshin_configs WHERE project_id = ?').get(projectId);
  if (!row) return null;
  const raw = JSON.parse(row.config);
  return {
    templateSlug: row.template_slug,
    config: configWithDefaults(row.template_slug, raw),
    updatedAt: row.updated_at
  };
}

export function saveConfig(projectId, userId, templateSlug, config) {
  const { valid, errors, normalized } = validateHenshinConfig(templateSlug, config);
  if (!valid) throw new HenshinValidationError(errors);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO henshin_configs (project_id, template_slug, config, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET template_slug = excluded.template_slug, config = excluded.config,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(projectId, templateSlug, JSON.stringify(normalized), userId, now);
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, projectId);
  return { templateSlug, config: configWithDefaults(templateSlug, normalized), updatedAt: now };
}

// ---------- 资源引用 ----------
export function listResources(projectId) {
  return db.prepare(`SELECT r.id, r.kind, r.label, r.note, r.status, r.task_id AS taskId, r.created_at AS createdAt,
      t.status AS taskStatus, t.progress AS taskProgress, t.error AS taskError
    FROM henshin_resources r LEFT JOIN async_tasks t ON t.id = r.task_id
    WHERE r.project_id = ? ORDER BY r.created_at DESC`).all(projectId)
    .map((row) => ({ ...row, note: row.note || '', taskError: row.taskError || null }));
}

/**
 * 登记一个资源引用，并异步处理（解码 / 特征提取）。
 * 任务完成时把资源状态从 pending 推进到 ready；失败则 failed（终态对账）。
 */
export function registerResource(projectId, userId, input) {
  const { valid, errors } = validateHenshinResource(input);
  if (!valid) throw new HenshinValidationError(errors);
  const id = crypto.randomUUID();
  const task = enqueueTask({
    projectId,
    userId,
    type: HENSHIN_TASK_TYPES.PROCESS_RESOURCE,
    payload: {
      kind: input.kind,
      storageKey: input.storageKey,
      forceError: input.storageKey.startsWith('fail:') // 约定：fail: 前缀用于演示失败路径
    },
    onComplete: () => {
      db.prepare("UPDATE henshin_resources SET status = 'ready' WHERE id = ? AND status = 'pending'").run(id);
      return { resourceId: id, resourceStatus: 'ready' };
    },
    onError: () => {
      db.prepare("UPDATE henshin_resources SET status = 'failed' WHERE id = ? AND status = 'pending'").run(id);
    }
  });
  db.prepare(`INSERT INTO henshin_resources (id, project_id, kind, label, storage_key, note, task_id, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
    .run(id, projectId, input.kind, input.label.trim(), input.storageKey, input.note || '', task.id, userId);
  return { id, kind: input.kind, label: input.label.trim(), status: 'pending', taskId: task.id };
}

// ---------- 生成版本（发布） ----------
export function listRenderings(projectId) {
  return db.prepare(`SELECT g.id, g.version_number AS versionNumber, g.template_slug AS templateSlug, g.name,
      g.status, g.task_id AS taskId, g.created_at AS createdAt, g.completed_at AS completedAt,
      t.progress AS taskProgress, t.error AS taskError
    FROM henshin_renderings g LEFT JOIN async_tasks t ON t.id = g.task_id
    WHERE g.project_id = ? ORDER BY g.version_number DESC`).all(projectId)
    .map((row) => ({ ...row, taskError: row.taskError || null }));
}

export function getRendering(projectId, renderingId) {
  const row = db.prepare(`SELECT g.*, t.progress AS task_progress, t.error AS task_error
    FROM henshin_renderings g LEFT JOIN async_tasks t ON t.id = g.task_id
    WHERE g.id = ? AND g.project_id = ?`).get(renderingId, projectId);
  if (!row) return null;
  return {
    id: row.id,
    versionNumber: row.version_number,
    templateSlug: row.template_slug,
    name: row.name,
    status: row.status,
    snapshot: JSON.parse(row.snapshot),
    taskId: row.task_id,
    taskProgress: row.task_progress ?? 0,
    taskError: row.task_error || null,
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}

/**
 * 发布演出：以当前保存的配置做一份不可变快照，异步烘焙后变为 ready。
 * 只有项目所有者能到达这里（路由层 requireProjectOwner 已保证）。
 */
export function publishRendering(projectId, userId, requestedName) {
  const configRow = db.prepare('SELECT * FROM henshin_configs WHERE project_id = ?').get(projectId);
  if (!configRow) throw new HenshinValidationError([{ code: 'NO_CONFIG', message: '还没有可发布的演出配置，请先保存一版。', path: null }]);
  const template = HENSHIN_TEMPLATE_BY_SLUG.get(configRow.template_slug);
  if (!template) throw new HenshinValidationError([{ code: 'BAD_TEMPLATE', message: '模板定义已失效。', path: null }]);
  const config = configWithDefaults(configRow.template_slug, JSON.parse(configRow.config));

  const name = typeof requestedName === 'string' && requestedName.trim()
    ? requestedName.trim().slice(0, 60)
    : `${template.name} · ${config.characterName}`;

  const latest = db.prepare('SELECT MAX(version_number) AS version FROM henshin_renderings WHERE project_id = ?').get(projectId).version || 0;
  const id = crypto.randomUUID();
  const task = enqueueTask({
    projectId,
    userId,
    type: HENSHIN_TASK_TYPES.BAKE_RENDERING,
    payload: { renderingId: id, version: latest + 1 },
    onComplete: () => {
      const finished = new Date().toISOString();
      db.prepare("UPDATE henshin_renderings SET status = 'ready', completed_at = ? WHERE id = ?").run(finished, id);
      return { renderingId: id, renderingStatus: 'ready', version: latest + 1 };
    },
    onError: () => {
      db.prepare("UPDATE henshin_renderings SET status = 'failed' WHERE id = ? AND status = 'rendering'").run(id);
    }
  });
  const snapshot = {
    templateSlug: configRow.template_slug,
    layout: template.layout,
    renderer: template.renderer,
    config,
    shots: template.shots,
    symbols: template.symbols,
    tracks: template.tracks,
    resources: listResources(projectId).filter((resource) => resource.status === 'ready').map((resource) => ({
      id: resource.id, kind: resource.kind, label: resource.label
    })),
    publishedAt: new Date().toISOString()
  };
  db.prepare(`INSERT INTO henshin_renderings (id, project_id, version_number, template_slug, name, snapshot, task_id, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'rendering', ?)`)
    .run(id, projectId, latest + 1, configRow.template_slug, name, JSON.stringify(snapshot), task.id, userId);
  return { id, versionNumber: latest + 1, name, templateSlug: configRow.template_slug, status: 'rendering', taskId: task.id };
}
