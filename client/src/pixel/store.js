// PixelPulse client store: working model + undo/redo + incremental commit queue.
//
// The server is never sent a full canvas: local edits become sparse ops and
// are appended to a persistent queue, flushed in debounced batches. Every
// mutation is an op — even undo/redo (compensating commits), so other tabs and
// devices converge on the same commit log. If the server is ahead (another tab
// or work done while offline), a 409 triggers server-first rebase via the
// shared rebaseQueuedOps() transform.

import {
  applyOp, applyOps, cloneModel, invertOp, buildPalDeleteOp,
  makeIdFactory, clientNumFromId, maxSeqOfIds, TRANSPARENT,
  buildFrameAddOp, buildFrameDupOp, buildFrameDelOp, buildFrameDirOp,
  buildResizeOp, buildSettingsOp, unpackPixels, packPixels, slotById, getFrame,
  rebaseQueuedOps, PixelError
} from '../../../shared/pixel-core.js';
import { api } from '../api.js';

const UNDO_ENTRY_LIMIT = 200;
const UNDO_MEMORY_LIMIT = 4 * 1024 * 1024; // 4 MB of serialized history entries
const FLUSH_DEBOUNCE_MS = 600;

const pendingKey = (projectId) => `pixelpulse-pending-${projectId}`;
const seqKey = (userId) => `pixelpulse-seq-${userId}`;

export class PixelStore extends EventTarget {
  constructor({ model, version, userId, pending = null }) {
    super();
    this.userId = userId;
    this.serverVersion = version;
    this.baseModel = cloneModel(model);
    this.model = cloneModel(model);
    this.queue = [];
    this.clientSeq = Number(localStorage.getItem(seqKey(userId)) || 0);
    this.undoStack = [];
    this.redoStack = [];
    this.undoMemory = 0;
    this.syncState = navigator.onLine ? 'idle' : 'offline';
    this.forceOffline = false;
    this.flushing = null;
    this.flushTimer = null;
    this.notice = '';
    this.droppedCount = 0;

    // Live-drag gesture state.
    this.gesture = null; // Map(frameId -> Map(key -> cell)) or null
    this.gestureLabel = '';

    // Mint ids above every id already present from previous sessions.
    const clientNum = clientNumFromId(userId);
    const maxSeq = maxSeqOfIds([
      ...model.frames.map((f) => f.id),
      ...model.palette.map((s) => s.id)
    ], clientNum);
    this.idFactory = makeIdFactory(clientNum, Math.max(maxSeq, this.clientSeq));

    if (pending && pending.queue?.length) {
      this.hydratePending(pending);
      // Reopened project with an unsynced queue from a previous session:
      // actually upload it (debounced), don't just sit on the bytes.
      if (this.online) this.scheduleFlush();
    }

    window.addEventListener('online', () => { this.emit({ type: 'sync' }); this.flush(); });
    window.addEventListener('offline', () => { this.setSyncState('offline'); });
  }

  // ---------- pending (offline/crash) persistence ----------

  persistPending() {
    const key = pendingKey(this.model.id);
    if (this.queue.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify({
      baseVersion: this.serverVersion,
      baseModel: this.baseModel,
      clientSeq: this.clientSeq,
      queue: this.queue
    }));
  }

  hydratePending(pending) {
    this.baseModel = pending.baseModel;
    this.serverVersion = pending.baseVersion;
    this.clientSeq = Math.max(this.clientSeq, pending.clientSeq);
    this.queue = pending.queue;
    this.model = applyOps(cloneModel(this.baseModel), this.queue);
    if (this.queue.length) this.syncState = navigator.onLine ? 'queued' : 'offline';
  }

  static loadPending(projectId) {
    try {
      const raw = localStorage.getItem(pendingKey(projectId));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  static clearPending(projectId) {
    localStorage.removeItem(pendingKey(projectId));
  }

  // ---------- events ----------

  subscribe(fn) {
    this.addEventListener('change', fn);
    return () => this.removeEventListener('change', fn);
  }

  emit(hint = {}) {
    this.dispatchEvent(new CustomEvent('change', { detail: hint }));
  }

  setSyncState(state) {
    if (this.syncState === state) return;
    this.syncState = state;
    this.emit({ type: 'sync' });
  }

  notify(message) {
    this.notice = message;
    this.emit({ type: 'notice' });
  }

  consumeNotice() {
    const note = this.notice;
    this.notice = '';
    return note;
  }

  get canUndo() { return !this.gesture && this.undoStack.length > 0; }
  get canRedo() { return !this.gesture && this.redoStack.length > 0; }
  get pendingCount() { return this.queue.length; }
  get online() { return !this.forceOffline && navigator.onLine; }

  // ---------- internals ----------

  nextId() { return this.idFactory(); }

  lockedSet() {
    return new Set(this.model.palette.filter((s) => s.locked).map((s) => s.id));
  }

  _enqueue(ops) {
    this.queue.push(...ops);
    this.clientSeq += ops.length;
    localStorage.setItem(seqKey(this.userId), String(this.clientSeq));
    this.persistPending();
    this.scheduleFlush();
  }

  _pushHistory(forward, inverse, label = '操作') {
    const entry = { label, forward, inverse, size: JSON.stringify(forward).length + JSON.stringify(inverse).length };
    this.undoStack.push(entry);
    this.undoMemory += entry.size;
    let dropped = 0;
    while (this.undoStack.length > UNDO_ENTRY_LIMIT ||
           (this.undoStack.length > 1 && this.undoMemory > UNDO_MEMORY_LIMIT)) {
      const old = this.undoStack.shift();
      this.undoMemory -= old.size;
      dropped += 1;
    }
    if (dropped > 0) this.notify(`撤销栈过大，已回收最早 ${dropped} 条历史（已保存的内容不受影响）。`);
  }

  // Apply a committed structural op (or ops), queue it for the server and
  // record one undo entry.
  commit(op, label = '操作') {
    return this.commitAll([op], label);
  }

  commitAll(ops, label = '操作') {
    const inverses = [];
    for (const op of ops) {
      applyOp(this.model, op);
      inverses.push(invertOp(op, this.model));
    }
    this._enqueue(ops);
    this._pushHistory(ops, inverses.reverse(), label);
    this.redoStack = [];
    this.emit(describeHint(ops[ops.length - 1]));
  }

  // Replay compensating ops (undo inverse / redo forward). They are ordinary
  // new commits to the log, but must not themselves create history entries.
  _replay(ops) {
    const applied = [];
    for (const op of ops) {
      try {
        applyOp(this.model, op);
        applied.push(op);
      } catch (error) {
        if (error instanceof PixelError) {
          this.notify(`有一步无法重放（${error.message}），已跳过。`);
        } else throw error;
      }
    }
    if (applied.length) {
      this._enqueue(applied);
      this.emit({ type: 'all' });
    }
  }

  undo() {
    if (!this.canUndo) return;
    const entry = this.undoStack.pop();
    this.undoMemory -= entry.size;
    this.redoStack.push(entry);
    this._replay(entry.inverse);
  }

  redo() {
    if (!this.canRedo) return;
    const entry = this.redoStack.pop();
    this.undoStack.push(entry);
    this.undoMemory += entry.size;
    this._replay(entry.forward);
  }

  // ---------- painting ----------

  beginGesture(label = '绘制') {
    this.gesture = new Map();
    this.gestureLabel = label;
  }

  // cells: [[x, y, value], ...]. Old values are captured here (first touch in
  // a gesture wins), so the merged stroke is exactly invertible. Cells over
  // palette-locked pixels are stripped.
  // cells entries are [x, y, value] or [x, y, value, oldValue] (e.g. a flood
  // fill spanning mirror seeds pre-captures each cell's original value).
  paintCells(frameId, cells) {
    const frame = getFrame(this.model, frameId);
    if (!frame) return;
    const { width, height } = this.model;
    const pixels = unpackPixels(frame.data, width * height);
    const locked = this.lockedSet();
    const enriched = [];
    for (const cell of cells) {
      const [x, y, value, capturedOld] = cell;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const idx = y * width + x;
      const current = pixels[idx];
      if (current !== TRANSPARENT && locked.has(current)) continue; // protected
      if (value !== TRANSPARENT && !slotById(this.model, value)) continue;
      if (current === value && capturedOld === undefined) continue;
      enriched.push([x, y, value, capturedOld === undefined ? current : capturedOld]);
      pixels[idx] = value; // later cells in the same call see the new value
    }
    if (enriched.length === 0) return;
    frame.data = packPixels(pixels);

    if (this.gesture) {
      let map = this.gesture.get(frameId);
      if (!map) { map = new Map(); this.gesture.set(frameId, map); }
      for (const cell of enriched) {
        const key = cell[1] * width + cell[0];
        const existing = map.get(key);
        // Preserve the old value captured by the first touch.
        map.set(key, existing ? [cell[0], cell[1], cell[2], existing[3]] : cell);
      }
    } else {
      const op = { t: 'paint', frame: frameId, cells: enriched };
      this._enqueue([op]);
      this._pushHistory([op], [invertOp(op, this.model)], '绘制');
      this.redoStack = [];
    }
    this.emit({
      type: 'paint',
      frameId,
      rect: boundsOf(enriched, width)
    });
  }

  endGesture() {
    if (!this.gesture) return;
    if (this.gesture.size === 0) { this.gesture = null; return; }
    const ops = [];
    const inverses = [];
    for (const [frameId, map] of this.gesture) {
      const cells = [...map.values()];
      const op = { t: 'paint', frame: frameId, cells };
      ops.push(op);
      inverses.push(invertOp(op, this.model));
    }
    this.gesture = null;
    this._enqueue(ops);
    this._pushHistory(ops, inverses.reverse(), this.gestureLabel || '绘制');
    this.redoStack = [];
    this.emit({ type: 'frames' });
  }

  cancelGesture() {
    if (!this.gesture) return;
    // Reverse every live-applied cell using its captured original value.
    const ops = [];
    for (const [frameId, map] of this.gesture) {
      ops.push({ t: 'paint', frame: frameId, cells: [...map.values()].map(([x, y, , old]) => [x, y, old]) });
    }
    this.gesture = null;
    this._replayLiveRevert(ops);
  }

  _replayLiveRevert(ops) {
    for (const op of ops) applyOp(this.model, op);
    this.emit({ type: 'all' });
  }

  // ---------- high level structural helpers ----------

  addBlankFrame(dir) {
    const op = buildFrameAddOp(this.model, { id: this.nextId(), dir });
    this.commit(op, '添加帧');
    return op.frame.id;
  }

  duplicateFrame(frameId, dir = null) {
    const op = buildFrameDupOp(this.model, frameId, { id: this.nextId(), dir });
    this.commit(op, '复制帧');
    return op.frame.id;
  }

  deleteFrame(frameId) {
    if (this.model.frames.length <= 1) return;
    this.commit(buildFrameDelOp(this.model, frameId), '删除帧');
  }

  moveFrameBy(frameId, delta) {
    const frame = getFrame(this.model, frameId);
    if (!frame) return;
    const same = this.model.frames.filter((f) => f.dir === frame.dir);
    const from = same.findIndex((f) => f.id === frameId);
    const to = Math.max(0, Math.min(same.length - 1, from + delta));
    if (to === from) return;
    this.commit({ t: 'frameMove', frame: frameId, dir: frame.dir, from, to }, '移动帧');
  }

  changeFrameDir(frameId, dir) {
    const frame = getFrame(this.model, frameId);
    if (!frame || frame.dir === dir) return;
    this.commit(buildFrameDirOp(this.model, frameId, dir), '更改方向');
  }

  resize(width, height) {
    if (width === this.model.width && height === this.model.height) return;
    this.commit(buildResizeOp(this.model, width, height), '画布尺寸');
  }

  // ---------- palette ----------

  addColor(color) {
    const op = { t: 'palAdd', slot: { id: this.nextId(), color, locked: false } };
    this.commit(op, '添加颜色');
    return op.slot.id;
  }

  deleteColor(slotId) {
    const slot = slotById(this.model, slotId);
    if (!slot) return;
    if (slot.locked) { this.notify('该颜色已锁定，请先解锁再删除。'); return; }
    // Snapshots affected frames BEFORE deletion, so the cascade-to-transparent
    // is reversible and replays identically on every client.
    this.commit(buildPalDeleteOp(this.model, slotId), '删除颜色');
  }

  updateColor(slotId, color) {
    const slot = slotById(this.model, slotId);
    if (!slot || slot.color.toLowerCase() === color.toLowerCase()) return;
    if (slot.locked) { this.notify('该颜色已锁定，请先解锁。'); return; }
    this.commit({ t: 'palUpdate', slot: slotId, color, oldColor: slot.color }, '修改颜色');
  }

  toggleLock(slotId) {
    const slot = slotById(this.model, slotId);
    if (!slot) return;
    this.commit({ t: 'palLock', slot: slotId, locked: !slot.locked }, '锁定颜色');
  }

  moveColor(slotId, to) {
    const from = this.model.palette.findIndex((s) => s.id === slotId);
    if (from < 0 || from === to) return;
    this.commit({ t: 'palMove', slot: slotId, from, to }, '移动颜色');
  }

  rename(name) {
    if (name.trim() && name !== this.model.name) {
      this.commit(buildSettingsOp(this.model, { name }), '重命名');
    }
  }

  saveExportConfig(patch) {
    this.commit(buildSettingsOp(this.model, { exportConfig: patch }), '导出设置');
  }

  // ---------- synchronization ----------

  setForceOffline(value) {
    this.forceOffline = value;
    if (this.online) this.flush();
    this.emit({ type: 'sync' });
  }

  scheduleFlush() {
    if (!this.online) { this.setSyncState('offline'); return; }
    this.setSyncState('queued');
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_DEBOUNCE_MS);
  }

  async flush() {
    if (this.flushing) return this.flushing;
    if (this.queue.length === 0) { this.setSyncState('idle'); return; }
    if (!this.online) { this.setSyncState('offline'); return; }

    this.setSyncState('saving');
    const batch = this.queue.slice();
    const baseVersion = this.serverVersion;
    const lastSeq = this.clientSeq;

    const run = (async () => {
      try {
        const result = await api.commit(this.model.id, {
          baseVersion,
          ops: batch,
          clientId: this.userId,
          clientSeq: lastSeq
        });

        if (result.duplicate) {
          await this.recoverDuplicate(batch.length, result.version);
          return;
        }

        // Advance the base snapshot through exactly the acked batch. Edits
        // made while awaiting remain queued and untouched.
        this.baseModel = applyOps(this.baseModel, batch);
        this.serverVersion = result.version;
        this.queue = this.queue.slice(batch.length);
        this.persistPending();
        this.setSyncState(this.queue.length ? 'queued' : 'saved');
        this.emit({ type: 'sync' });
        if (this.queue.length) this.scheduleFlush();
      } catch (error) {
        if (error.status === 409) {
          await this.recoverFromConflict(error.body);
        } else if (error.networkError) {
          this.setSyncState('offline');
        } else {
          this.setSyncState('error');
          this.notify(error.message);
        }
      } finally {
        // A conflict recovery may have started a follow-up flush run; only
        // clear the guard when no newer run has taken over.
        if (this.flushing === run) this.flushing = null;
      }
    })();
    this.flushing = run;
    return run;
  }

  // Crash-after-ack path: the server already saw this nonce. Pull the full
  // snapshot, fold it under the still-queued remainder.
  async recoverDuplicate(sentLen, serverVersion) {
    try {
      const full = await api.sync(this.model.id, 0);
      const remainder = this.queue.slice(sentLen);
      const { model, ops, dropped } = rebaseQueuedOps(full.state, full.state, [], remainder);
      this.model = model;
      this.queue = ops;
      this.baseModel = cloneModel(full.state);
      this.serverVersion = full.version;
      this.clearHistoryAfterStructuralChange();
      this.persistPending();
      if (dropped.length) this.droppedCount += dropped.length;
      this.setSyncState(this.queue.length ? 'queued' : 'saved');
      this.emit({ type: 'all' });
      if (this.queue.length) this.scheduleFlush();
    } catch (error) {
      this.setSyncState('error');
      this.notify(`重复提交恢复失败：${error.message}`);
    }
  }

  async recoverFromConflict(body) {
    this.setSyncState('recovering');
    let serverModel;
    let serverVersion;
    let baseModel = this.baseModel;
    let serverOps = [];

    try {
      if (body.resync || !Array.isArray(body.catchUp)) {
        // Log window compacted away: full snapshot, no structural transform.
        const full = await api.sync(this.model.id, this.serverVersion);
        serverModel = full.state;
        serverVersion = full.version;
        baseModel = full.state;
      } else {
        serverVersion = body.serverVersion;
        serverOps = body.catchUp.flatMap((commit) => commit.ops);
        serverModel = applyOps(cloneModel(this.baseModel), serverOps);
      }

      const { ops, model, dropped } =
        rebaseQueuedOps(serverModel, baseModel, serverOps, this.queue);

      this.model = model;
      this.queue = ops;
      this.baseModel = cloneModel(serverModel);
      this.serverVersion = serverVersion;
      this.clearHistoryAfterStructuralChange();
      this.persistPending();

      if (dropped.length) {
        const reasons = [...new Set(dropped.map((d) => reasonText(d.reason)))];
        this.droppedCount += dropped.length;
        this.notify(`冲突恢复（服务器优先）：${dropped.length} 个本地操作因${reasons.join('、')}被丢弃，其余已重新排队。`);
      } else {
        this.notify('检测到其他端的更新，已自动合并本地修改（服务器优先）。');
      }
      this.emit({ type: 'all' });
      // Release THIS run's guard before re-entering flush(): the entry guard
      // `if (this.flushing) return this.flushing` would otherwise hand the
      // call our own pending promise and deadlock forever, leaving local edits
      // queued but never uploaded after a conflict recovery.
      this.flushing = null;
      if (this.queue.length && this.online) {
        await this.flush();
      } else {
        this.setSyncState(this.queue.length ? 'offline' : 'saved');
      }
    } catch (error) {
      this.setSyncState('conflict');
      this.notify(`冲突恢复失败：${error.message}。本地修改仍保留在队列中。`);
      this.emit({ type: 'sync' });
    }
  }

  clearHistoryAfterStructuralChange() {
    const cleared = this.undoStack.length + this.redoStack.length;
    this.undoStack = [];
    this.redoStack = [];
    this.undoMemory = 0;
    return cleared;
  }
}

// packPixels is imported from the shared core above.

function reasonText(reason) {
  if (reason === 'frame-deleted') return '帧已在服务器删除';
  if (reason === 'color-deleted') return '颜色已被删除';
  return String(reason);
}

function boundsOf(cells) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (const [x, y] of cells) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function describeHint(op) {
  if (!op) return { type: 'all' };
  if (op.t === 'paint') return { type: 'paint', frameId: op.frame, rect: boundsOf(op.cells) };
  if (op.t === 'palDelete' || op.t === 'batch') return { type: 'all' };
  if (op.t && op.t.startsWith('pal')) return { type: 'palette' };
  if (op.t && op.t.startsWith('frame')) return { type: 'frames' };
  if (op.t === 'resize') return { type: 'resize' };
  return { type: 'all' };
}

export { PixelError };
