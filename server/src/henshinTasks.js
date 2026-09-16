// 变身演出台的异步资源处理：队列状态机 queued -> processing -> completed/failed。
// 处理器是异步 setTimeout 流水（模拟解码 / 烘焙管线），每个阶段推进 progress，
// 任何状态都落库，客户端通过 GET tasks/:id 轮询。
import crypto from 'node:crypto';
import db from './db.js';

export const HENSHIN_TASK_TYPES = {
  PROCESS_RESOURCE: 'henshin-process-resource',
  BAKE_RENDERING: 'henshin-bake-rendering'
};
export const TASK_TYPES = new Set([
  HENSHIN_TASK_TYPES.PROCESS_RESOURCE,
  HENSHIN_TASK_TYPES.BAKE_RENDERING,
  'render-preview' // 旧边界保留
]);
export const TASK_STATUSES = ['queued', 'processing', 'completed', 'failed'];

const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class TaskValidationError extends Error {
  constructor(message) { super(message); this.code = 'BAD_TASK'; }
}

export function listHenshinTasks(projectId) {
  return db.prepare(`SELECT id, type, status, progress, result, error, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt
    FROM async_tasks WHERE project_id = ? ORDER BY created_at DESC LIMIT 50`).all(projectId)
    .map((task) => ({ ...task, result: task.result ? JSON.parse(task.result) : null, error: task.error || null }));
}

export function getTask(projectId, taskId) {
  const task = db.prepare(`SELECT id, project_id AS projectId, type, status, progress, result, error,
      created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt
    FROM async_tasks WHERE id = ? AND project_id = ?`).get(taskId, projectId);
  if (!task) return null;
  return { ...task, result: task.result ? JSON.parse(task.result) : null, error: task.error || null };
}

/**
 * 入队一个异步任务并立即开始处理（不 await，接口返回 202）。
 * @param {object} opts
 * @param {Function} [opts.onComplete] 成功流水线结束后调用，返回值合并进任务 result
 * @param {Function} [opts.onError] 失败时调用（用于把关联资源 / 版本对账为终态）
 * @returns {{ id:string, status:'queued' }}
 */
export function enqueueTask({ projectId, userId, type, payload = {}, onComplete, onError }) {
  if (!TASK_TYPES.has(type)) throw new TaskValidationError('未知任务类型。');
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO async_tasks (id, project_id, requested_by, type, payload, status, progress)
    VALUES (?, ?, ?, ?, ?, 'queued', 0)`).run(id, projectId, userId, type, JSON.stringify(payload));
  // 不阻塞响应
  void runTask(id, onComplete, onError);
  return { id, status: 'queued' };
}

function patchTask(id, patch) {
  const entries = Object.entries(patch);
  if (entries.length === 0) return;
  const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([, value]) => value);
  db.prepare(`UPDATE async_tasks SET ${assignments} WHERE id = ?`).run(...values, id);
}

// 三阶段流水线：解码 -> 特征提取 / 烘焙 -> 完成校验
const STAGES = [
  { at: 0.25, label: '解码资源', ms: 140 },
  { at: 0.65, label: '提取节拍特征', ms: 180 },
  { at: 0.92, label: '校验与装配', ms: 160 }
];

async function runTask(taskId, onComplete, onError) {
  const task = db.prepare('SELECT * FROM async_tasks WHERE id = ?').get(taskId);
  if (!task || task.status !== 'queued') return;
  try {
    patchTask(taskId, { status: 'processing', updated_at: nowIso() });
    const payload = JSON.parse(task.payload || '{}');
    // payload.forceError 仅用于演示失败路径与任务查询
    if (payload.forceError === true) {
      await sleep(120);
      throw new Error('资源解码失败：不受支持的容器格式。');
    }
    let result = { stages: [] };
    for (const stage of STAGES) {
      await sleep(stage.ms);
      const progress = Math.round(stage.at * 100);
      result.stages.push({ label: stage.label, progress });
      patchTask(taskId, { progress, result: JSON.stringify(result), updated_at: nowIso() });
    }
    if (onComplete) result = { ...result, ...(await onComplete(payload)) };
    const finished = nowIso();
    patchTask(taskId, { status: 'completed', progress: 100, result: JSON.stringify(result), updated_at: finished, completed_at: finished });
  } catch (error) {
    const finished = nowIso();
    patchTask(taskId, { status: 'failed', progress: 100, error: String(error.message || error), updated_at: finished, completed_at: finished });
    try { await onError?.(error); } catch { /* 对账钩子失败不影响任务终态 */ }
  }
}
