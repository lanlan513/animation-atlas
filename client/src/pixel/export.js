// Lossless rendering for preview + PNG export.
// Every draw goes through putImageData at native resolution first, then a
// scaled drawImage with imageSmoothingEnabled=false — exported pixels are hard
// edges, never anti-aliased by the browser.

import { TRANSPARENT, DIRECTIONS, DIR_LABELS, unpackPixels } from '../../../shared/pixel-core.js';

// Build a native-resolution ImageData for one frame.
export function frameImageData(model, frame) {
  const { width, height, palette } = model;
  const pixels = unpackPixels(frame.data, width * height);
  const imageData = new ImageData(width, height);
  for (let i = 0; i < pixels.length; i++) {
    const slotId = pixels[i];
    const o = i * 4;
    if (slotId === TRANSPARENT) { imageData.data[o + 3] = 0; continue; }
    const slot = palette.find((s) => s.id === slotId);
    if (!slot) { imageData.data[o + 3] = 0; continue; }
    const [r, g, b] = hexToRgb(slot.color);
    imageData.data[o] = r; imageData.data[o + 1] = g; imageData.data[o + 2] = b; imageData.data[o + 3] = 255;
  }
  return imageData;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Paint one frame's ImageData onto a context at pixel position (x,y),
// scaled by integer `scale`, with no smoothing.
export function blitFrame(ctx, imageData, x, y, scale) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, x, y, imageData.width * scale, imageData.height * scale);
}

// Compute sheet geometry for the current model/config.
// layout 'strip': one row, all directions concatenated (with gaps when a
// direction group is shorter).
// layout 'grid': 8 rows (one per direction), columns = max frames in a group.
export function sheetGeometry(model, layout, scale, gap = 0) {
  const { width, height } = model;
  const groups = DIRECTIONS.map((dir) => ({ dir, frames: model.frames.filter((f) => f.dir === dir) }));
  if (layout === 'strip') {
    const total = model.frames.length;
    const stepX = width * scale + gap;
    const cells = [];
    let i = 0;
    for (const g of groups) {
      for (const frame of g.frames) {
        cells.push({ frame, dir: g.dir, x: i * stepX, y: 0 });
        i += 1;
      }
    }
    return {
      canvasWidth: total * width * scale + (total - 1) * gap,
      canvasHeight: height * scale,
      groups,
      cells,
      rows: null
    };
  }
  const maxCols = Math.max(1, ...groups.map((g) => g.frames.length));
  const rows = groups.filter((g) => g.frames.length > 0 || layout === 'grid');
  const rowH = height * scale + gap;
  return {
    canvasWidth: maxCols * width * scale + (maxCols - 1) * gap,
    canvasHeight: rows.length * height * scale + (rows.length - 1) * gap,
    groups,
    rows,
    cells: groups.flatMap((g) => {
      const rowIndex = rows.findIndex((r) => r.dir === g.dir);
      if (rowIndex < 0) return [];
      return g.frames.map((frame, col) => ({
        frame,
        dir: g.dir,
        x: col * (width * scale + gap),
        y: rowIndex * rowH
      }));
    })
  };
}

// Render the full sprite sheet to a canvas (PNG export).
export function renderSheet(model, { scale = 4, layout = 'grid', gap = 0 }) {
  const geo = sheetGeometry(model, layout, scale, gap);
  const canvas = document.createElement('canvas');
  canvas.width = geo.canvasWidth;
  canvas.height = geo.canvasHeight;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const cell of geo.cells) {
    blitFrame(ctx, frameImageData(model, cell.frame), cell.x, cell.y, scale);
  }
  return canvas;
}

export function downloadSheet(model, config, filename = 'pixelpulse-spritesheet.png') {
  const canvas = renderSheet(model, config);
  const url = canvas.toDataURL('image/png');
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return { width: canvas.width, height: canvas.height, url };
}

// Preview-render a single frame into an existing canvas (used by the looping
// preview panel). Smoothing stays disabled even when CSS scales it further.
export function renderPreviewFrame(canvas, model, frame, background = null) {
  const scale = Math.max(1, Math.floor(Math.min(canvas.width / model.width, canvas.height / model.height)));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const w = model.width * scale;
  const h = model.height * scale;
  blitFrame(ctx, frameImageData(model, frame), Math.floor((canvas.width - w) / 2), Math.floor((canvas.height - h) / 2), scale);
  return scale;
}

export { DIRECTIONS, DIR_LABELS };
