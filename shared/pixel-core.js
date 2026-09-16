// PixelPulse shared core: pure data model + op algebra, used by server and client.
//
// A bitmap is an Int32Array of slot ids; -1 (TRANSPARENT) means empty.
// Slot/frame ids are derived per-device: seq * 2^20 + clientNum, so ids minted
// on different devices while offline never collide.

export const TRANSPARENT = -1;
const ID_BASE = 1 << 20;

// Counter-clockwise from south, standard top-down RPG order.
export const DIRECTIONS = [
  'down', 'downLeft', 'left', 'upLeft', 'up', 'upRight', 'right', 'downRight'
];
export const DIR_LABELS = {
  down: '下 ↓', downLeft: '左下 ↙', left: '左 ←', upLeft: '左上 ↖',
  up: '上 ↑', upRight: '右上 ↗', right: '右 →', downRight: '右下 ↘'
};

// Sweetie-16 inspired starter palette.
const DEFAULT_COLORS = [
  '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57',
  '#ffcd75', '#a7f070', '#41a6f6', '#b0a9e6'
];

export class PixelError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function assert(cond, message) {
  if (!cond) throw new PixelError(message);
}

// ---------- id factories ----------

export function clientNumFromId(clientId) {
  return (Number(String(clientId).split('-')[0]) >>> 0) % ID_BASE || 1;
}

export function makeIdFactory(clientNum, startSeq = 0) {
  const base = (clientNum >>> 0) % ID_BASE || 1;
  let seq = Math.max(0, startSeq | 0);
  return () => (++seq) * ID_BASE + base;
}

export function maxSeqOfIds(ids, clientNum) {
  let maxSeq = 0;
  for (const id of ids) {
    if (id % ID_BASE === clientNum) maxSeq = Math.max(maxSeq, Math.floor(id / ID_BASE));
  }
  return maxSeq;
}

// ---------- bitmap <-> base64 ----------

export function packPixels(pixels) {
  const bytes = new Uint8Array(pixels.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < pixels.length; i++) view.setInt32(i * 4, pixels[i], true);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function unpackPixels(data, expectedLength) {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  assert(bytes.length === expectedLength * 4, '像素矩阵长度与画布尺寸不一致。');
  const view = new DataView(bytes.buffer);
  const pixels = new Int32Array(expectedLength);
  for (let i = 0; i < expectedLength; i++) pixels[i] = view.getInt32(i * 4, true);
  return pixels;
}

export function emptyPixels(width, height) {
  return new Int32Array(width * height).fill(TRANSPARENT);
}

// ---------- model ----------

export function createProject({ id, name, width = 16, height = 16, now, idFactory }) {
  const nextId = idFactory || (() => Date.now());
  const palette = DEFAULT_COLORS.map((color) => ({ id: nextId(), color, locked: false }));
  const frame = { id: nextId(), dir: 'down', data: packPixels(emptyPixels(width, height)) };
  return {
    id,
    name: name || '未命名走路循环',
    width,
    height,
    palette,
    frames: [frame],
    exportConfig: { scale: 4, layout: 'sheet', fps: 8, lastExport: null },
    createdAt: now,
    updatedAt: now
  };
}

export function cloneModel(model) {
  return {
    ...model,
    palette: model.palette.map((s) => ({ ...s })),
    frames: model.frames.map((f) => ({ ...f })),
    exportConfig: { ...model.exportConfig, lastExport: model.exportConfig.lastExport ? { ...model.exportConfig.lastExport } : null }
  };
}

export function getFrame(model, frameId) {
  return model.frames.find((f) => f.id === frameId) || null;
}

export function framesInDir(model, dir) {
  return model.frames.filter((f) => f.dir === dir);
}

export function slotById(model, slotId) {
  return model.palette.find((s) => s.id === slotId) || null;
}

function repackFrame(model, frameId, mutate) {
  const frame = getFrame(model, frameId);
  assert(frame, `帧 ${frameId} 不存在。`);
  const pixels = unpackPixels(frame.data, model.width * model.height);
  mutate(pixels);
  frame.data = packPixels(pixels);
}

// Frames are always stored grouped by DIRECTIONS order, dir groups contiguous.
function insertFrameByDirIndex(model, frame, dirIndex) {
  const same = framesInDir(model, frame.dir);
  if (dirIndex >= same.length) {
    const nextDirIndex = DIRECTIONS.indexOf(frame.dir) + 1;
    const nextFrame = model.frames.find((f) => DIRECTIONS.indexOf(f.dir) >= nextDirIndex);
    if (nextFrame) model.frames.splice(model.frames.indexOf(nextFrame), 0, frame);
    else model.frames.push(frame);
  } else {
    model.frames.splice(model.frames.indexOf(same[dirIndex]), 0, frame);
  }
}

function moveInArray(list, from, to) {
  assert(Number.isInteger(from) && from >= 0 && from < list.length, '移动起点越界。');
  const [item] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(to, list.length)), 0, item);
}

// ---------- op application (mutates model in place) ----------

export function applyOp(model, op) {
  if (!op || typeof op !== 'object') throw new PixelError('操作格式无效。');
  switch (op.t) {
    case 'batch':
      op.ops.forEach((child) => applyOp(model, child));
      break;

    case 'paint': {
      assert(getFrame(model, op.frame), '目标帧不存在。');
      const { width, height } = model;
      repackFrame(model, op.frame, (pixels) => {
        for (const cell of op.cells) {
          const [x, y, value] = cell;
          assert(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height, '像素坐标越界。');
          assert(value === TRANSPARENT || slotById(model, value), '使用了调色板之外的颜色。');
          pixels[y * width + x] = value;
        }
      });
      break;
    }

    case 'frameData': {
      const frame = getFrame(model, op.frame);
      assert(frame, '目标帧不存在。');
      const pixels = unpackPixels(op.data, model.width * model.height);
      for (const v of pixels) assert(v === TRANSPARENT || slotById(model, v), '帧数据引用了调色板之外的颜色。');
      frame.data = op.data;
      break;
    }

    case 'frameAdd': {
      assert(DIRECTIONS.includes(op.frame.dir), '方向无效。');
      assert(!getFrame(model, op.frame.id), '帧 id 已存在。');
      const data = op.frame.data ?? packPixels(emptyPixels(model.width, model.height));
      const pixels = unpackPixels(data, model.width * model.height);
      for (const v of pixels) assert(v === TRANSPARENT || slotById(model, v), '新帧引用了调色板之外的颜色。');
      const frame = { id: op.frame.id, dir: op.frame.dir, data };
      const same = framesInDir(model, frame.dir);
      const index = Math.max(0, Math.min(op.index ?? same.length, same.length));
      insertFrameByDirIndex(model, frame, index);
      break;
    }

    case 'frameDel': {
      const index = model.frames.findIndex((f) => f.id === op.frame);
      assert(index >= 0, '要删除的帧不存在。');
      assert(model.frames.length > 1, '至少保留一帧。');
      model.frames.splice(index, 1);
      break;
    }

    case 'frameMove': {
      const frame = getFrame(model, op.frame);
      assert(frame, '要移动的帧不存在。');
      const same = framesInDir(model, op.dir);
      assert(same.some((f) => f.id === op.frame), '要移动的帧不在该方向中。');
      model.frames.splice(model.frames.indexOf(frame), 1);
      const sameAfter = framesInDir(model, op.dir);
      const to = Math.max(0, Math.min(op.to, sameAfter.length));
      insertFrameByDirIndex(model, frame, to);
      break;
    }

    case 'frameDir': {
      const frame = getFrame(model, op.frame);
      assert(frame, '目标帧不存在。');
      assert(DIRECTIONS.includes(op.dir), '方向无效。');
      model.frames.splice(model.frames.indexOf(frame), 1);
      frame.dir = op.dir;
      insertFrameByDirIndex(model, frame, op.index ?? framesInDir(model, op.dir).length);
      break;
    }

    case 'palAdd': {
      assert(/^#[0-9a-f]{6}$/i.test(op.slot.color), '颜色格式无效。');
      assert(!slotById(model, op.slot.id), '色板 id 已存在。');
      const slot = { id: op.slot.id, color: op.slot.color, locked: Boolean(op.slot.locked) };
      if (Number.isInteger(op.index) && op.index >= 0 && op.index < model.palette.length) {
        model.palette.splice(Math.min(op.index, model.palette.length), 0, slot);
      } else {
        model.palette.push(slot);
      }
      break;
    }

    case 'palDelete': {
      const index = model.palette.findIndex((s) => s.id === op.slot);
      assert(index >= 0, '要删除的颜色不存在。');
      model.palette.splice(index, 1);
      const count = model.width * model.height;
      for (const frame of model.frames) {
        const pixels = unpackPixels(frame.data, count);
        let touched = false;
        for (let i = 0; i < pixels.length; i++) {
          if (pixels[i] === op.slot) { pixels[i] = TRANSPARENT; touched = true; }
        }
        if (touched) frame.data = packPixels(pixels);
      }
      break;
    }

    case 'palUpdate': {
      const slot = slotById(model, op.slot);
      assert(slot, '颜色不存在。');
      assert(/^#[0-9a-f]{6}$/i.test(op.color), '颜色格式无效。');
      slot.color = op.color;
      break;
    }

    case 'palLock': {
      const slot = slotById(model, op.slot);
      assert(slot, '颜色不存在。');
      slot.locked = Boolean(op.locked);
      break;
    }

    case 'palMove': {
      const from = model.palette.findIndex((s) => s.id === op.slot);
      assert(from >= 0, '要移动的颜色不存在。');
      moveInArray(model.palette, from, op.to);
      break;
    }

    case 'resize': {
      assert(Number.isInteger(op.width) && Number.isInteger(op.height) &&
        op.width >= 1 && op.height >= 1 && op.width <= 128 && op.height <= 128,
        '尺寸必须在 1–128 之间。');
      assert(Array.isArray(op.frames) && op.frames.length === model.frames.length, 'resize 数据不完整。');
      const count = op.width * op.height;
      for (const item of op.frames) {
        const frame = getFrame(model, item.frame);
        assert(frame, 'resize 引用了不存在的帧。');
        const pixels = unpackPixels(item.data, count);
        for (const v of pixels) assert(v === TRANSPARENT || slotById(model, v), 'resize 数据引用了无效颜色。');
        frame.data = item.data;
      }
      model.width = op.width;
      model.height = op.height;
      break;
    }

    case 'settings': {
      assert(op.patch && typeof op.patch === 'object', '设置补丁无效。');
      if (op.patch.name !== undefined) {
        assert(typeof op.patch.name === 'string' && op.patch.name.trim(), '名称不能为空。');
        model.name = op.patch.name.trim();
      }
      if (op.patch.exportConfig !== undefined) {
        assert(typeof op.patch.exportConfig === 'object', '导出配置无效。');
        model.exportConfig = { ...model.exportConfig, ...op.patch.exportConfig };
      }
      break;
    }

    default:
      throw new PixelError(`未知操作类型：${op.t}`);
  }
  return model;
}

export function applyOps(model, ops) {
  for (const op of ops) applyOp(model, op);
  return model;
}

// ---------- inverse ops ----------
// Inverses are built immediately after applying a local op and are never
// re-inverted. Redo replays the stored forward ops.

export function buildPalDeleteOp(model, slotId) {
  const index = model.palette.findIndex((s) => s.id === slotId);
  assert(index >= 0, '颜色不存在。');
  const slot = model.palette[index];
  const replacements = {};
  for (const frame of model.frames) {
    const pixels = unpackPixels(frame.data, model.width * model.height);
    if (pixels.includes(slotId)) replacements[frame.id] = frame.data;
  }
  return { t: 'palDelete', slot: slotId, index, color: slot.color, locked: slot.locked, replacements };
}

// modelAfter = state immediately after `op` was applied.
export function invertOp(op, modelAfter) {
  switch (op.t) {
    case 'batch':
      return { t: 'batch', ops: [...op.ops].reverse().map((child) => invertOp(child, modelAfter)) };

    case 'paint':
      return {
        t: 'paint',
        frame: op.frame,
        cells: op.cells.map(([x, y, , old]) => [x, y, old === undefined ? TRANSPARENT : old])
      };

    case 'frameData':
      return { t: 'frameData', frame: op.frame, data: op.oldData };

    case 'frameAdd': {
      const index = modelAfter.frames.findIndex((f) => f.id === op.frame.id);
      assert(index >= 0, '新帧不在模型中。');
      return { t: 'frameDel', frame: op.frame.id, index };
    }

    case 'frameDel':
      return { t: 'frameAdd', frame: { id: op.frame, dir: op.dir, data: op.data }, index: op.index };

    case 'frameMove': {
      const current = framesInDir(modelAfter, op.dir).findIndex((f) => f.id === op.frame);
      return { t: 'frameMove', frame: op.frame, dir: op.dir, to: op.from, from: current };
    }

    case 'frameDir':
      return { t: 'frameDir', frame: op.frame, dir: op.oldDir, index: op.oldIndex };

    case 'palAdd':
      return {
        t: 'palDelete',
        slot: op.slot.id,
        index: Number.isInteger(op.index) ? op.index : modelAfter.palette.findIndex((s) => s.id === op.slot.id),
        color: op.slot.color,
        locked: Boolean(op.slot.locked),
        replacements: {}
      };

    case 'palDelete': {
      const restores = Object.entries(op.replacements || {}).map(([frame, data]) => ({
        t: 'frameData', frame: Number(frame), data
      }));
      return {
        t: 'batch',
        ops: [{ t: 'palAdd', slot: { id: op.slot, color: op.color, locked: op.locked }, index: op.index }, ...restores]
      };
    }

    case 'palUpdate':
      return { t: 'palUpdate', slot: op.slot, color: op.oldColor };

    case 'palLock':
      return { t: 'palLock', slot: op.slot, locked: !op.locked };

    case 'palMove': {
      const current = modelAfter.palette.findIndex((s) => s.id === op.slot);
      return { t: 'palMove', slot: op.slot, to: op.from, from: current };
    }

    case 'resize':
      return { t: 'resize', width: op.old.width, height: op.old.height, frames: op.old.frames };

    case 'settings':
      return { t: 'settings', patch: op.old };

    default:
      throw new PixelError(`无法逆操作：${op.t}`);
  }
}

// ---------- drawing helpers ----------

export function rasterLine(x0, y0, x1, y1) {
  const cells = [];
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    cells.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
  return cells;
}

export function mirrorCells(cell, width, height, mode) {
  const [x, y] = cell;
  const raw = [[x, y]];
  if (mode === 'x' || mode === 'xy') raw.push([width - 1 - x, y]);
  if (mode === 'y' || mode === 'xy') raw.push([x, height - 1 - y]);
  if (mode === 'xy') raw.push([width - 1 - x, height - 1 - y]);
  const seen = new Set();
  return raw.filter(([mx, my]) => {
    const key = mx * 512 + my;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Flood fill over a 4-connected equal-valued region. Does not mutate the
// input; a visited mask prevents a cell being enqueued more than once.
export function floodFill(pixels, width, height, x, y, value) {
  if (x < 0 || y < 0 || x >= width || y >= height) return [];
  const target = pixels[y * width + x];
  if (target === value) return [];
  const cells = [];
  const visited = new Uint8Array(width * height);
  const stack = [[x, y]];
  visited[y * width + x] = 1;
  while (stack.length) {
    const [cx, cy] = stack.pop();
    const i = cy * width + cx;
    if (pixels[i] !== target) continue;
    cells.push([cx, cy, value, target]);
    const push = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
      const ni = ny * width + nx;
      if (!visited[ni]) { visited[ni] = 1; stack.push([nx, ny]); }
    };
    push(cx + 1, cy); push(cx - 1, cy); push(cx, cy + 1); push(cx, cy - 1);
  }
  return cells;
}

// ---------- client-side op builders ----------

export function buildFrameAddOp(model, { id, dir, index, data }) {
  return { t: 'frameAdd', frame: { id, dir, data: data ?? null }, index: index ?? null };
}

export function buildFrameDupOp(model, sourceFrameId, { id, dir = null, index = null }) {
  const src = getFrame(model, sourceFrameId);
  assert(src, '源帧不存在。');
  const targetDir = dir ?? src.dir;
  return {
    t: 'frameAdd',
    frame: { id, dir: targetDir, data: src.data },
    index: index ?? (targetDir !== src.dir ? framesInDir(model, targetDir).length : null)
  };
}

export function buildFrameDelOp(model, frameId) {
  const globalIndex = model.frames.findIndex((f) => f.id === frameId);
  const frame = model.frames[globalIndex];
  assert(frame, '帧不存在。');
  return { t: 'frameDel', frame: frameId, dir: frame.dir, index: globalIndex, data: frame.data };
}

export function buildFrameDirOp(model, frameId, newDir) {
  const frame = getFrame(model, frameId);
  assert(frame, '帧不存在。');
  const oldIndex = framesInDir(model, frame.dir).findIndex((f) => f.id === frameId);
  return { t: 'frameDir', frame: frameId, dir: newDir, oldDir: frame.dir, oldIndex };
}

export function buildResizeOp(model, width, height) {
  const oldFrames = model.frames.map((f) => ({ frame: f.id, data: f.data }));
  const frames = model.frames.map((f) => {
    const src = unpackPixels(f.data, model.width * model.height);
    const dst = emptyPixels(width, height);
    const copyW = Math.min(width, model.width);
    const copyH = Math.min(height, model.height);
    for (let y = 0; y < copyH; y++) {
      for (let x = 0; x < copyW; x++) dst[y * width + x] = src[y * model.width + x];
    }
    return { frame: f.id, data: packPixels(dst) };
  });
  return { t: 'resize', width, height, frames, old: { width: model.width, height: model.height, frames: oldFrames } };
}

export function buildSettingsOp(model, patch) {
  const old = {};
  if (patch.name !== undefined) old.name = model.name;
  if (patch.exportConfig !== undefined) old.exportConfig = { ...model.exportConfig };
  return { t: 'settings', patch, old };
}

// ---------- offline rebase (server-first recovery) ----------
//
// Remote structural ops land first; the local queue is transformed against
// the converged server model and replayed. Ops (or cells) whose target was
// deleted remotely are reported in `dropped`.

function moveInIdList(list, id, to) {
  const from = list.indexOf(id);
  if (from < 0) return -1;
  const [item] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(to, list.length)), 0, item);
  return from;
}

export function rebaseQueuedOps(serverModel, baseModel, serverOps, queuedOps) {
  const palOrder = baseModel.palette.map((s) => s.id);
  const dirOrder = new Map(DIRECTIONS.map((d) => [d, framesInDir(baseModel, d).map((f) => f.id)]));

  for (const op of serverOps) {
    if (op.t === 'frameAdd') {
      const list = dirOrder.get(op.frame.dir);
      if (list) list.splice(Math.min(op.index ?? list.length, list.length), 0, op.frame.id);
    } else if (op.t === 'frameDel') {
      for (const list of dirOrder.values()) {
        const i = list.indexOf(op.frame);
        if (i >= 0) { list.splice(i, 1); break; }
      }
    } else if (op.t === 'frameMove') {
      moveInIdList(dirOrder.get(op.dir), op.frame, op.to);
    } else if (op.t === 'frameDir') {
      for (const list of dirOrder.values()) {
        const i = list.indexOf(op.frame);
        if (i >= 0) { list.splice(i, 1); break; }
      }
      dirOrder.get(op.dir)?.push(op.frame);
    } else if (op.t === 'palAdd') {
      palOrder.splice(Math.min(op.index ?? palOrder.length, palOrder.length), 0, op.slot.id);
    } else if (op.t === 'palDelete') {
      const i = palOrder.indexOf(op.slot);
      if (i >= 0) palOrder.splice(i, 1);
    } else if (op.t === 'palMove') {
      moveInIdList(palOrder, op.slot, op.to);
    }
  }

  const localSlots = new Set();
  const localFrames = new Set();
  for (const op of queuedOps) {
    if (op.t === 'palAdd') localSlots.add(op.slot.id);
    if (op.t === 'frameAdd') localFrames.add(op.frame.id);
  }
  const slotAlive = (id, work) => id === TRANSPARENT || Boolean(slotById(work, id)) || localSlots.has(id);
  const frameAlive = (id, work) => Boolean(getFrame(work, id)) || localFrames.has(id);

  const work = cloneModel(serverModel);
  const out = [];
  const dropped = [];
  const drop = (op, reason) => dropped.push({ op, reason });

  for (const raw of queuedOps) {
    try {
      switch (raw.t) {
        case 'paint': {
          if (!frameAlive(raw.frame, work)) { drop(raw, 'frame-deleted'); break; }
          const cells = [];
          for (const cell of raw.cells) {
            const [x, y, v, old] = cell;
            if (!slotAlive(v, work)) continue;
            cells.push([x, y, v, slotAlive(old, work) ? old : TRANSPARENT]);
          }
          if (!cells.length) { drop(raw, 'color-deleted'); break; }
          const op = { ...raw, cells };
          applyOp(work, op);
          out.push(op);
          break;
        }
        case 'frameData':
          if (!frameAlive(raw.frame, work)) { drop(raw, 'frame-deleted'); break; }
          applyOp(work, raw);
          out.push(raw);
          break;
        case 'frameAdd': {
          const list = dirOrder.get(raw.frame.dir);
          const index = raw.index == null ? list.length : Math.min(raw.index, list.length);
          const op = { ...raw, index };
          applyOp(work, op);
          list.splice(index, 0, raw.frame.id);
          out.push(op);
          break;
        }
        case 'frameDel': {
          if (!frameAlive(raw.frame, work)) { drop(raw, 'frame-deleted'); break; }
          applyOp(work, raw);
          for (const list of dirOrder.values()) {
            const i = list.indexOf(raw.frame);
            if (i >= 0) { list.splice(i, 1); break; }
          }
          out.push(raw);
          break;
        }
        case 'frameMove': {
          const list = dirOrder.get(raw.dir);
          const from = moveInIdList(list, raw.frame, raw.to);
          if (from < 0) { drop(raw, 'frame-deleted'); break; }
          const op = { ...raw, from, to: Math.min(raw.to, list.length - 1) };
          applyOp(work, op);
          out.push(op);
          break;
        }
        case 'frameDir': {
          if (!frameAlive(raw.frame, work)) { drop(raw, 'frame-deleted'); break; }
          applyOp(work, raw);
          for (const list of dirOrder.values()) {
            const i = list.indexOf(raw.frame);
            if (i >= 0) { list.splice(i, 1); break; }
          }
          dirOrder.get(raw.dir).push(raw.frame);
          out.push(raw);
          break;
        }
        case 'palAdd':
          applyOp(work, raw);
          palOrder.push(raw.slot.id);
          out.push(raw);
          break;
        case 'palDelete': {
          if (!slotAlive(raw.slot, work)) { drop(raw, 'color-deleted'); break; }
          // Regenerate replacements against the converged state, since
          // remotely-added frames may also reference this color.
          const op = buildPalDeleteOp(work, raw.slot);
          applyOp(work, op);
          const i = palOrder.indexOf(raw.slot);
          if (i >= 0) palOrder.splice(i, 1);
          out.push(op);
          break;
        }
        case 'palUpdate':
        case 'palLock': {
          if (!slotAlive(raw.slot, work)) { drop(raw, 'color-deleted'); break; }
          applyOp(work, raw);
          out.push(raw);
          break;
        }
        case 'palMove': {
          const from = moveInIdList(palOrder, raw.slot, raw.to);
          if (from < 0) { drop(raw, 'color-deleted'); break; }
          const op = { ...raw, from, to: Math.min(raw.to, palOrder.length - 1) };
          applyOp(work, op);
          out.push(op);
          break;
        }
        case 'resize':
        case 'settings':
        case 'batch':
          applyOp(work, raw);
          out.push(raw);
          break;
        default:
          drop(raw, 'unknown');
      }
    } catch (err) {
      drop(raw, `invalid:${err.message}`);
    }
  }

  return { ops: out, model: work, dropped };
}
