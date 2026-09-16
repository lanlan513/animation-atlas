// Pixel renderer: an offscreen canvas holds the bitmap at native resolution;
// the visible canvas draws it scaled with image smoothing DISABLED, so the
// browser never anti-aliases a pixel. Painting only marks changed cells and
// the main loop redraws the union dirty rect (scaled), never the whole canvas.

import { useEffect, useRef, useCallback } from 'react';
import { TRANSPARENT, unpackPixels, getFrame } from '../../../shared/pixel-core.js';

export default function PixelCanvas({
  store, frameId, cell, tool, mirror, onion, showGrid, onPaintStart, onPaintMove, onPaintEnd, onPickColor
}) {
  const canvasRef = useRef(null);
  const nativeRef = useRef(null); // native-resolution offscreen
  const dirtyRef = useRef({ frameId: null, rect: null });
  const rafRef = useRef(0);
  const drawingRef = useRef(false);
  const lastCellRef = useRef(null);
  const propsRef = useRef({});

  propsRef.current = { store, frameId, cell, tool, mirror, onion, showGrid, onPaintStart, onPaintMove, onPaintEnd, onPickColor };

  const size = () => {
    const { width, height } = propsRef.current.store.model;
    return cell * width;
  };

  // Build/rebuild the native buffer when frame or dimensions change.
  const rebuildNative = useCallback((full = true) => {
    const { store: s, frameId: fid } = propsRef.current;
    const model = s.model;
    const frame = getFrame(model, fid);
    if (!frame) return;
    if (!nativeRef.current || nativeRef.current.width !== model.width || nativeRef.current.height !== model.height) {
      nativeRef.current = document.createElement('canvas');
      nativeRef.current.width = model.width;
      nativeRef.current.height = model.height;
    }
    const buffer = nativeRef.current;
    const ctx = buffer.getContext('2d');
    const pixels = unpackPixels(frame.data, model.width * model.height);
    if (full) {
      ctx.clearRect(0, 0, model.width, model.height);
    }
    const rect = full ? { x: 0, y: 0, w: model.width, h: model.height } : dirtyRef.current.rect;
    paintCellsToContext(ctx, rect, pixels, model);
    scheduleDraw();
  }, []);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      draw();
    });
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { store: s, frameId: fid, onion: onionCfg, cell: cellSize, showGrid: gridOn } = propsRef.current;
    const model = s.model;
    const ctx = canvas.getContext('2d');
    const cssSize = cellSize * model.width;
    if (canvas.width !== cssSize || canvas.height !== cellSize * model.height) {
      canvas.width = cssSize;
      canvas.height = cellSize * model.height;
      ctx.imageSmoothingEnabled = false;
    }

    const rect = dirtyRef.current.rect || { x: 0, y: 0, w: model.width, h: model.height };
    // Transparent-cell checkerboard.
    ctx.imageSmoothingEnabled = false;
    // Full redraw is cheap at 32x32 * cell; but honor dirty rect for big grids.
    const full = rect.x === 0 && rect.y === 0 && rect.w === model.width && rect.h === model.height;
    if (full) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawChecker(ctx, model, cellSize);
      if (onionCfg?.enabled) drawOnion(ctx, model, fid, cellSize, onionCfg);
      ctx.drawImage(nativeRef.current, 0, 0, canvas.width, canvas.height);
      drawMirrorGuides(ctx, model, cellSize, propsRef.current.mirror);
      if (gridOn) drawGrid(ctx, model, cellSize);
    } else {
      const sx = Math.max(0, rect.x - 1) * cellSize;
      const sy = Math.max(0, rect.y - 1) * cellSize;
      const sw = Math.min(model.width, rect.w + 2) * cellSize;
      const sh = Math.min(model.height, rect.h + 2) * cellSize;
      ctx.clearRect(sx, sy, sw, sh);
      drawChecker(ctx, model, cellSize, sx, sy, sw, sh);
      if (onionCfg?.enabled) drawOnion(ctx, model, fid, cellSize, onionCfg, sx, sy, sw, sh);
      ctx.drawImage(nativeRef.current, 0, 0, canvas.width, canvas.height);
      drawMirrorGuides(ctx, model, cellSize, propsRef.current.mirror);
      if (gridOn) drawGrid(ctx, model, cellSize, sx, sy, sw, sh);
    }
  }, []);

  // Redraw whole canvas on view-only changes (frame switch, onion, grid, resize).
  const forceFull = useCallback(() => {
    dirtyRef.current = { frameId: propsRef.current.frameId, rect: null };
    rebuildNative(true);
  }, [rebuildNative]);

  useEffect(() => {
    const unsub = store.subscribe((event) => {
      const hint = event.detail;
      if (hint.type === 'sync' || hint.type === 'notice') return;
      if (hint.type === 'resize') { forceFull(); return; }
      const visibleFrame = propsRef.current.frameId;
      if (hint.type === 'paint' && hint.frameId === visibleFrame && dirtyRef.current.frameId === visibleFrame) {
        // Only the active frame's own paints can use the narrow dirty path;
        // onion skins overlay neighbors, so anything structural is full.
        dirtyRef.current = { frameId: visibleFrame, rect: hint.rect };
        rebuildNative(false);
      } else {
        forceFull();
      }
    });
    forceFull();
    return unsub;
  }, [store, forceFull, rebuildNative]);

  useEffect(() => { forceFull(); }, [frameId, onion, mirror, showGrid, cell, forceFull]);

  // ---------- pointer interaction ----------

  const eventToCell = (event) => {
    const canvas = canvasRef.current;
    const rectBox = canvas.getBoundingClientRect();
    const { store: s } = propsRef.current;
    const x = Math.floor((event.clientX - rectBox.left) / rectBox.width * s.model.width);
    const y = Math.floor((event.clientY - rectBox.top) / rectBox.height * s.model.height);
    if (x < 0 || y < 0 || x >= s.model.width || y >= s.model.height) return null;
    return [x, y];
  };

  const onPointerDown = (event) => {
    const pos = eventToCell(event);
    if (!pos) return;
    event.preventDefault();
    canvasRef.current.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastCellRef.current = pos;
    const { tool, onPaintStart, onPickColor, store: s, frameId: fid } = propsRef.current;
    if (event.button === 2 || tool === 'picker') {
      const frame = getFrame(s.model, fid);
      const pixels = unpackPixels(frame.data, s.model.width * s.model.height);
      const value = pixels[pos[1] * s.model.width + pos[0]];
      onPickColor?.(value === TRANSPARENT ? null : value);
      drawingRef.current = false;
      return;
    }
    // Fill is a click-level atomic op handled entirely by onPaintStart (it
    // opens and closes its own gesture); pencil/eraser aggregate a drag.
    if (tool === 'fill') {
      onPaintStart?.(pos, event);
      drawingRef.current = false;
      return;
    }
    s.beginGesture(tool === 'eraser' ? '擦除' : '绘制');
    onPaintStart?.(pos, event);
  };

  const applyAt = (pos, prev, event) => {
    const { tool, onPaintMove } = propsRef.current;
    if (tool !== 'pencil' && tool !== 'eraser') return;
    const stroke = prev ? rasterize(prev, pos) : [pos];
    onPaintMove?.(stroke, { tool, shiftKey: event?.shiftKey });
  };

  const onPointerMove = (event) => {
    if (!drawingRef.current) return;
    const pos = eventToCell(event);
    if (!pos) return;
    const prev = lastCellRef.current;
    if (prev && prev[0] === pos[0] && prev[1] === pos[1]) return;
    lastCellRef.current = pos;
    applyAt(pos, prev, event);
  };

  const endStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const { store: s } = propsRef.current;
    s.endGesture();
  };

  return (
    <canvas
      ref={canvasRef}
      className="pixel-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endStroke}
      onPointerCancel={() => { drawingRef.current = false; propsRef.current.store.cancelGesture(); }}
      onPointerLeave={(e) => { if (e.buttons === 0) drawingRef.current = false; }}
      onContextMenu={(e) => e.preventDefault()}
      style={{ imageRendering: 'pixelated', touchAction: 'none', cursor: 'crosshair' }}
    />
  );
}

// ---------- drawing helpers ----------

function colorFor(model, slotId) {
  if (slotId === TRANSPARENT) return null;
  return model.palette.find((s) => s.id === slotId)?.color || null;
}

function paintCellsToContext(ctx, rect, pixels, model) {
  const { width } = model;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const value = pixels[y * width + x];
      const color = colorFor(model, value);
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      } else {
        ctx.clearRect(x, y, 1, 1);
      }
    }
  }
}

function drawChecker(ctx, model, cell, clipX = 0, clipY = 0, clipW = null, clipH = null) {
  const w = clipW ?? cell * model.width;
  const h = clipH ?? cell * model.height;
  ctx.save();
  ctx.beginPath();
  ctx.rect(clipX, clipY, w, h);
  ctx.clip();
  ctx.fillStyle = '#23252d';
  ctx.fillRect(clipX, clipY, w, h);
  ctx.fillStyle = '#292b34';
  const x0 = Math.floor(clipX / cell), y0 = Math.floor(clipY / cell);
  const x1 = Math.ceil((clipX + w) / cell), y1 = Math.ceil((clipY + h) / cell);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if ((x + y) % 2 === 0) ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  ctx.restore();
}

function drawGrid(ctx, model, cell, clipX = 0, clipY = 0, clipW = null, clipH = null) {
  if (cell < 6) return;
  const w = clipW ?? cell * model.width;
  const h = clipH ?? cell * model.height;
  ctx.save();
  ctx.beginPath();
  ctx.rect(clipX, clipY, w, h);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= model.width; x++) {
    ctx.moveTo(x * cell + 0.5, clipY);
    ctx.lineTo(x * cell + 0.5, clipY + h);
  }
  for (let y = 0; y <= model.height; y++) {
    ctx.moveTo(clipX, y * cell + 0.5);
    ctx.lineTo(clipX + w, y * cell + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

function drawMirrorGuides(ctx, model, cell, mode) {
  if (!mode || mode === 'off') return;
  ctx.save();
  ctx.strokeStyle = 'rgba(116,169,255,0.55)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (mode === 'x' || mode === 'xy') {
    const x = model.width % 2 === 0 ? (model.width / 2) * cell : ((model.width - 1) / 2) * cell + cell / 2;
    ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, model.height * cell);
  }
  if (mode === 'y' || mode === 'xy') {
    const y = model.height % 2 === 0 ? (model.height / 2) * cell : ((model.height - 1) / 2) * cell + cell / 2;
    ctx.moveTo(0, y + 0.5); ctx.lineTo(model.width * cell, y + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

function drawOnion(ctx, model, frameId, cell, cfg, clipX, clipY, clipW, clipH) {
  const frames = model.frames;
  const index = frames.findIndex((f) => f.id === frameId);
  if (index < 0) return;
  const drawOne = (f, color, alpha) => {
    const pixels = unpackPixels(f.data, model.width * model.height);
    ctx.save();
    ctx.globalAlpha = alpha;
    const x0 = clipX != null ? Math.floor(clipX / cell) : 0;
    const y0 = clipY != null ? Math.floor(clipY / cell) : 0;
    const x1 = clipW != null ? Math.ceil((clipX + clipW) / cell) : model.width;
    const y1 = clipH != null ? Math.ceil((clipY + clipH) / cell) : model.height;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (pixels[y * model.width + x] !== TRANSPARENT) {
          ctx.fillStyle = color;
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    }
    ctx.restore();
  };
  for (let i = 1; i <= cfg.back; i++) {
    const f = frames[index - i];
    if (f) drawOne(f, cfg.backColor || '#41a6f6', Math.max(0.08, 0.28 - i * 0.07));
  }
  for (let i = 1; i <= cfg.forward; i++) {
    const f = frames[index + i];
    if (f) drawOne(f, cfg.forwardColor || '#ef7d57', Math.max(0.08, 0.22 - i * 0.06));
  }
}

function rasterize(prev, pos) {
  // Bresenham over canvas cells (shared rasterLine is module-scope; inline
  // import via props would be circular, so replicate the tiny walker).
  const cells = [];
  let [x0, y0] = prev;
  const [x1, y1] = pos;
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
