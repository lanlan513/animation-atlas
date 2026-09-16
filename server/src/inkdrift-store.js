import fs from 'node:fs';
import path from 'node:path';
import { dataRoot } from './store.js';

// InkDrift 分段存储：每幅画一个目录，操作按段(segment)落盘，
// meta.json 维护版本号(=已提交操作总数)与段索引(含 x 范围)，
// 客户端可按视口范围懒加载，网络恢复后按 baseVersion 补传。

const rootDir = path.join(dataRoot, 'inkdrift');
fs.mkdirSync(rootDir, { recursive: true });

const GLOBAL_KINDS = new Set(['undo', 'redo', 'meta']); // 无空间属性、任何视口都需要的操作

function dir(projectId) { return path.join(rootDir, projectId); }
function metaFile(projectId) { return path.join(dir(projectId), 'meta.json'); }

function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export function getMeta(projectId) {
  try { return JSON.parse(fs.readFileSync(metaFile(projectId), 'utf8')); }
  catch {
    return { version: 0, opCount: 0, segCount: 0, segments: [], recentIds: [], updatedAt: null };
  }
}

function saveMeta(projectId, meta) {
  fs.mkdirSync(path.join(dir(projectId), 'segments'), { recursive: true });
  atomicWrite(metaFile(projectId), JSON.stringify(meta));
}

export class VersionConflict extends Error {
  constructor(currentVersion) {
    super('version conflict');
    this.code = 'CONFLICT';
    this.currentVersion = currentVersion;
  }
}

// 追加一段操作。baseVersion 必须等于当前版本，否则报冲突让客户端先同步。
export function appendSegment(projectId, baseVersion, ops) {
  const meta = getMeta(projectId);
  if (baseVersion !== meta.version) throw new VersionConflict(meta.version);
  if (!Array.isArray(ops) || ops.length === 0) return { version: meta.version, from: meta.version, to: meta.version, appended: 0 };
  if (ops.length > 500) { const e = new Error('segment too large (max 500 ops)'); e.code = 'TOO_LARGE'; throw e; }

  const from = meta.version;
  // 幂等去重：补传/重试可能带上服务端已有的操作，按 id 跳过
  const seen = new Set(meta.recentIds || []);
  const fresh = ops.filter((op) => !op.id || !seen.has(op.id));
  if (fresh.length === 0) return { version: meta.version, from: meta.version, to: meta.version, appended: 0 };
  const stamped = fresh.map((op, i) => ({ ...op, seq: from + i + 1 }));
  let xMin = Infinity; let xMax = -Infinity; let hasGlobal = false;
  for (const op of stamped) {
    if (op.bbox) { xMin = Math.min(xMin, op.bbox[0]); xMax = Math.max(xMax, op.bbox[2]); }
    if (GLOBAL_KINDS.has(op.kind) || !op.bbox) hasGlobal = true;
  }
  const segId = String(meta.segCount + 1).padStart(6, '0');
  const seg = {
    segId, from, to: from + stamped.length,
    xMin: xMin === Infinity ? null : xMin, xMax: xMax === -Infinity ? null : xMax,
    hasGlobal, ts: Date.now(), ops: stamped
  };
  fs.mkdirSync(path.join(dir(projectId), 'segments'), { recursive: true });
  atomicWrite(path.join(dir(projectId), 'segments', `${segId}.json`), JSON.stringify(seg));

  meta.version += stamped.length;
  meta.opCount = meta.version;
  meta.segCount += 1;
  meta.updatedAt = new Date().toISOString();
  meta.segments.push({ segId, from: seg.from, to: seg.to, xMin: seg.xMin, xMax: seg.xMax, hasGlobal: seg.hasGlobal });
  meta.recentIds = [...(meta.recentIds || []), ...stamped.map((op) => op.id).filter(Boolean)].slice(-3000);
  saveMeta(projectId, meta);
  return { version: meta.version, from: seg.from, to: seg.to, appended: stamped.length };
}

// 读取操作：after 之后的全部；可选 x0/x1 视口过滤(全局操作始终带上)。
export function getOps(projectId, { after = 0, x0 = null, x1 = null } = {}) {
  const meta = getMeta(projectId);
  const ranged = x0 != null && x1 != null;
  const out = [];
  for (const segInfo of meta.segments) {
    if (segInfo.to <= after) continue;
    // 段级预过滤：整段都在视口外且不含全局操作，就不必读文件了
    const segInRange = !ranged || segInfo.xMin == null ||
      (segInfo.xMax >= x0 && segInfo.xMin <= x1);
    if (!segInRange && !segInfo.hasGlobal) continue;
    const seg = JSON.parse(fs.readFileSync(path.join(dir(projectId), 'segments', `${segInfo.segId}.json`), 'utf8'));
    for (const op of seg.ops) {
      if (op.seq <= after) continue;
      // 操作级过滤：有包围盒且不在视口内的跳过；无包围盒的全局操作(undo/redo/meta)始终带上
      if (ranged && op.bbox && !(op.bbox[2] >= x0 && op.bbox[0] <= x1)) continue;
      out.push(op);
    }
  }
  out.sort((a, b) => a.seq - b.seq);
  return { version: meta.version, ops: out };
}

export function saveThumbnail(projectId, buffer) {
  fs.mkdirSync(dir(projectId), { recursive: true });
  atomicWrite(path.join(dir(projectId), 'thumbnail.png'), buffer);
  const meta = getMeta(projectId);
  meta.thumbAt = new Date().toISOString();
  saveMeta(projectId, meta);
}

export function getThumbnail(projectId) {
  const file = path.join(dir(projectId), 'thumbnail.png');
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}
