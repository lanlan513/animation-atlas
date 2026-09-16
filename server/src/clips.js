import crypto from 'node:crypto';
import db from './db.js';
import { CLIP_DURATION, LIMITS, validateClip, withDefaults } from './clipSchema.js';

export class ValidationError extends Error {
  constructor(errors) {
    super(errors[0]?.message || '片段校验失败。');
    this.errors = errors;
  }
}

export class VersionConflictError extends Error {
  constructor(serverVersion, serverClip) {
    super('片段已在其他标签页被修改，请先刷新。');
    this.serverVersion = serverVersion;
    this.serverClip = serverClip;
  }
}

export function listLibraryAssets() {
  return db.prepare('SELECT id, type, name, tags, svg, sort_order AS sortOrder FROM library_assets ORDER BY sort_order').all();
}

const assetTypeMap = () => new Map(db.prepare('SELECT id, type FROM library_assets').all().map((row) => [row.id, row.type]));

export function getClipByProject(projectId) {
  const row = db.prepare('SELECT * FROM clips WHERE project_id = ?').get(projectId);
  if (!row) return null;
  return assembleClip(row);
}

function assembleClip(row) {
  const layers = db.prepare('SELECT * FROM clip_layers WHERE clip_id = ? ORDER BY sort_order').all(row.id).map((layer) => ({
    id: layer.id,
    name: layer.name,
    type: layer.type,
    assetId: layer.asset_id,
    keyframes: db.prepare('SELECT id, time, easing, x, y, scale, rotation, opacity FROM clip_keyframes WHERE layer_id = ? ORDER BY time').all(layer.id)
  }));
  const cameraActions = db.prepare('SELECT * FROM clip_camera_actions WHERE clip_id = ? ORDER BY start_time, sort_order').all(row.id)
    .map((action) => ({ id: action.id, type: action.type, start: action.start_time, end: action.end_time, params: JSON.parse(action.params) }));
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    updatedAt: row.updated_at,
    clip: { name: row.name, duration: row.duration, layers, cameraActions }
  };
}

/**
 * 乐观锁保存。
 * @param {string} projectId
 * @param {object} payload { expectedVersion, clip }
 * @returns {{ version:number, clip:object, updatedAt:string }}
 */
export function saveClip(projectId, payload) {
  const expectedVersion = payload?.expectedVersion;
  const clip = payload?.clip;

  if (expectedVersion !== undefined && (!Number.isInteger(expectedVersion) || expectedVersion < 0)) {
    throw new ValidationError([{ code: 'BAD_VERSION', message: '版本号必须是非负整数。', path: 'expectedVersion' }]);
  }
  if (JSON.stringify(clip || {}).length > LIMITS.maxBodyBytes) {
    throw new ValidationError([{ code: 'CONFIG_TOO_LARGE', message: `片段配置过大（上限 ${LIMITS.maxBodyBytes} 字节）。`, path: null }]);
  }

  const { valid, errors } = validateClip(clip, assetTypeMap());
  if (!valid) throw new ValidationError(errors);
  const normalized = withDefaults(clip);

  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT * FROM clips WHERE project_id = ?').get(projectId);
    let clipId;
    let nextVersion;
    if (existing) {
      if (expectedVersion === undefined || expectedVersion !== existing.version) {
        const server = assembleClip(existing);
        db.exec('ROLLBACK');
        throw new VersionConflictError(existing.version, server.clip);
      }
      clipId = existing.id;
      nextVersion = existing.version + 1;
    } else {
      if (expectedVersion !== undefined && expectedVersion !== 0) {
        db.exec('ROLLBACK');
        throw new VersionConflictError(0, null);
      }
      clipId = crypto.randomUUID();
      nextVersion = 1;
      db.prepare('INSERT INTO clips (id, project_id, name, duration, version) VALUES (?, ?, ?, ?, ?)')
        .run(clipId, projectId, normalized.name, CLIP_DURATION, nextVersion);
    }

    if (existing) {
      db.prepare('DELETE FROM clip_keyframes WHERE layer_id IN (SELECT id FROM clip_layers WHERE clip_id = ?)').run(clipId);
      db.prepare('DELETE FROM clip_layers WHERE clip_id = ?').run(clipId);
      db.prepare('DELETE FROM clip_camera_actions WHERE clip_id = ?').run(clipId);
    }

    const insertLayer = db.prepare('INSERT INTO clip_layers (id, clip_id, name, type, asset_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
    const insertKeyframe = db.prepare('INSERT INTO clip_keyframes (id, layer_id, time, easing, x, y, scale, rotation, opacity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    normalized.layers.forEach((layer, layerIndex) => {
      insertLayer.run(layer.id, clipId, layer.name, layer.type, layer.assetId, layerIndex);
      layer.keyframes.forEach((kf) => {
        insertKeyframe.run(kf.id, layer.id, kf.time, kf.easing, kf.x, kf.y, kf.scale, kf.rotation, kf.opacity);
      });
    });

    const insertAction = db.prepare('INSERT INTO clip_camera_actions (id, clip_id, type, start_time, end_time, params, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
    normalized.cameraActions.forEach((action, index) => {
      insertAction.run(action.id, clipId, action.type, action.start, action.end, JSON.stringify(action.params), index);
    });

    const now = new Date().toISOString();
    db.prepare('UPDATE clips SET name = ?, version = ?, updated_at = ? WHERE id = ?').run(normalized.name, nextVersion, now, clipId);
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, projectId);
    db.exec('COMMIT');

    return { version: nextVersion, updatedAt: now, clip: normalized };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* 事务可能已因冲突提前回滚 */ }
    throw error;
  }
}
