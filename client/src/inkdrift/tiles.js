// 瓦片管理器：把超长画卷切成 512×512 世界单位的瓦片，
// 每片是离屏 Canvas(2x 超采样)，懒创建 + LRU 回收，
// 撤销/重做后只重建受影响瓦片 —— 解决超长画卷加载与重绘慢的问题。

import { renderElement } from './elements.js';

export const TILE = 512;
const SS = 2;              // 超采样倍率
const MAX_TILES = 48;      // LRU 上限，超出回收最久未用的瓦片

export class TileManager {
  constructor(worldWidth, worldHeight, brush) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.brush = brush;
    this.tiles = new Map();   // key "col,row" -> {canvas, ctx, used}
    this.dirty = new Set();   // 待重建的瓦片 key
    this.tick = 0;
    this.effectiveOps = [];   // 由外部(history)同步，用于重建
  }

  key(col, row) { return `${col},${row}`; }

  keysForBBox(bbox) {
    if (!bbox) return [];
    const c0 = Math.max(0, Math.floor(bbox[0] / TILE));
    const r0 = Math.max(0, Math.floor(bbox[1] / TILE));
    const c1 = Math.min(Math.ceil(this.worldWidth / TILE) - 1, Math.floor(bbox[2] / TILE));
    const r1 = Math.min(Math.ceil(this.worldHeight / TILE) - 1, Math.floor(bbox[3] / TILE));
    const keys = [];
    for (let c = c0; c <= c1; c += 1) for (let r = r0; r <= r1; r += 1) keys.push(this.key(c, r));
    return keys;
  }

  ensure(key) {
    let tile = this.tiles.get(key);
    if (!tile) {
      const canvas = document.createElement('canvas');
      canvas.width = TILE * SS; canvas.height = TILE * SS;
      tile = { canvas, ctx: canvas.getContext('2d'), used: 0 };
      this.tiles.set(key, tile);
      this.evictIfNeeded();
      this.rebuildTile(key); // 新瓦片也要补上该区域已有的操作
    }
    tile.used = ++this.tick;
    return tile;
  }

  evictIfNeeded() {
    if (this.tiles.size <= MAX_TILES) return;
    let oldestKey = null; let oldest = Infinity;
    for (const [k, t] of this.tiles) if (t.used < oldest) { oldest = t.used; oldestKey = k; }
    if (oldestKey) this.tiles.delete(oldestKey);
  }

  // 把一条操作烘焙进它覆盖的所有瓦片
  bakeOp(op) {
    for (const key of this.keysForBBox(op.bbox)) {
      const tile = this.ensure(key);
      this.drawOpInto(tile, op, key);
    }
  }

  drawOpInto(tile, op, key) {
    const [col, row] = key.split(',').map(Number);
    const ctx = tile.ctx;
    ctx.save();
    ctx.setTransform(SS, 0, 0, SS, -col * TILE * SS, -row * TILE * SS);
    if (op.kind === 'stroke') this.brush.renderStroke(ctx, op, 1);
    else if (op.kind === 'element') renderElement(ctx, op, 1, 0);
    ctx.restore();
  }

  // 标记区域需要重建(撤销/重做/远端同步后调用)
  invalidateBBox(bbox) {
    for (const key of this.keysForBBox(bbox)) this.dirty.add(key);
  }

  rebuildTile(key) {
    const tile = this.tiles.get(key);
    if (!tile) return;
    const [col, row] = key.split(',').map(Number);
    tile.ctx.save();
    tile.ctx.setTransform(1, 0, 0, 1, 0, 0);
    tile.ctx.clearRect(0, 0, TILE * SS, TILE * SS);
    tile.ctx.restore();
    const x0 = col * TILE; const y0 = row * TILE;
    const x1 = x0 + TILE; const y1 = y0 + TILE;
    for (const op of this.effectiveOps) {
      const b = op.bbox;
      if (!b || b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) continue;
      this.drawOpInto(tile, op, key);
    }
  }

  flushDirty() {
    if (this.dirty.size === 0) return;
    for (const key of this.dirty) this.rebuildTile(key);
    this.dirty.clear();
  }

  // 把可见瓦片合成到视口。view: {scrollX, viewW, viewH, scale, dpr}
  composite(ctx, view) {
    this.flushDirty();
    const { scrollX, viewW, viewH, scale, dpr } = view;
    const c0 = Math.max(0, Math.floor(scrollX / TILE));
    const c1 = Math.min(Math.ceil(this.worldWidth / TILE) - 1, Math.floor((scrollX + viewW / scale) / TILE));
    const rows = Math.ceil(this.worldHeight / TILE);
    for (let c = c0; c <= c1; c += 1) {
      for (let r = 0; r < rows; r += 1) {
        const tile = this.tiles.get(this.key(c, r));
        if (!tile) continue; // 没内容的瓦片不创建
        tile.used = ++this.tick;
        const dx = (c * TILE - scrollX) * scale;
        const dy = r * TILE * scale;
        ctx.drawImage(tile.canvas, dx * dpr, dy * dpr, TILE * scale * dpr, TILE * scale * dpr);
      }
    }
  }
}
