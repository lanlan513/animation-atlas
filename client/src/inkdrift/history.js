// 操作日志：追加式(append-only)，undo/redo 本身也是操作。
// 这样的好处：撤销后重新绘制不会产生分支冲突，断网补传只是继续追加，
// 服务端永远是一条线性日志，客户端重放即可得到一致画面。

let localSeq = 0;
export function localId(prefix = 'op') {
  localSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${localSeq.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export class OpLog {
  constructor() {
    this.ops = [];          // 全部操作(含 undo/redo)，按到达顺序
    this.seenSeqs = new Set();
    this.ids = new Set();   // 按 op id 去重：本地未确认的操作被范围拉取带回时不重复
    this.undone = new Set(); // 当前处于撤销状态的目标 op id
  }

  get version() {
    let max = 0;
    for (const op of this.ops) if (op.seq > max) max = op.seq;
    return max;
  }

  // 追加一条操作并维护撤销状态。返回是否为新操作。
  append(op) {
    if (op.seq != null && this.seenSeqs.has(op.seq)) return false;
    if (op.id && this.ids.has(op.id)) return false;
    if (op.seq != null) this.seenSeqs.add(op.seq);
    if (op.id) this.ids.add(op.id);
    this.ops.push(op);
    if (op.kind === 'undo') this.undone.add(op.target);
    else if (op.kind === 'redo') this.undone.delete(op.target);
    return true;
  }

  appendRemote(ops) {
    let added = 0;
    for (const op of ops) if (this.append(op)) added += 1;
    return added;
  }

  isUndone(id) { return this.undone.has(id); }

  // 当前有效(可见)的绘画操作：笔画与元素，排除被撤销的
  effectiveOps() {
    return this.ops.filter((op) =>
      (op.kind === 'stroke' || op.kind === 'element') && !this.undone.has(op.id));
  }

  // 撤销：找到最近一条仍有效的可绘制操作，生成 undo 操作
  createUndo() {
    for (let i = this.ops.length - 1; i >= 0; i -= 1) {
      const op = this.ops[i];
      if ((op.kind === 'stroke' || op.kind === 'element') && !this.undone.has(op.id)) {
        return { id: localId('undo'), kind: 'undo', target: op.id };
      }
    }
    return null;
  }

  // 重做：找到最近一条尚未被 redo 的 undo 目标
  createRedo() {
    const redoable = new Set();
    for (const op of this.ops) {
      if (op.kind === 'undo') redoable.add(op.target);
      else if (op.kind === 'redo') redoable.delete(op.target);
    }
    // 按撤销发生的逆序找最近一个
    for (let i = this.ops.length - 1; i >= 0; i -= 1) {
      const op = this.ops[i];
      if (op.kind === 'undo' && redoable.has(op.target)) {
        return { id: localId('redo'), kind: 'redo', target: op.target };
      }
    }
    return null;
  }

  canUndo() { return this.createUndo() != null; }
  canRedo() { return this.createRedo() != null; }
}

// 计算操作包围盒(世界坐标)，供瓦片索引与服务端 x 范围过滤
export function opBBox(op) {
  if (op.kind === 'stroke' && op.pts?.length) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    const pad = (op.style?.size || 12) * 1.6 + 8;
    for (const p of op.pts) {
      if (p[0] < x0) x0 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[0] > x1) x1 = p[0];
      if (p[1] > y1) y1 = p[1];
    }
    if (op.bleeds) for (const b of op.bleeds) {
      x0 = Math.min(x0, b[0] - b[2]); y0 = Math.min(y0, b[1] - b[2]);
      x1 = Math.max(x1, b[0] + b[2]); y1 = Math.max(y1, b[1] + b[2]);
    }
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }
  if (op.kind === 'element') return op.bbox || null;
  return null;
}
