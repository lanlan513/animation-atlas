/* 分镜几何工具：多边形热区与镜头（viewBox）共用同一套页面坐标，
 * 因此无论镜头如何缩放，命中区域始终与视觉边界重合。 */

export const clamp = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));

const round = (n) => Math.round(n * 100) / 100;

export function pointsToAttr(points) {
  return (points || []).map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
}

export function polygonBounds(points) {
  if (!points?.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function polygonCenter(points) {
  if (!points?.length) return [0, 0];
  let area = 0; let cx = 0; let cy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-6) { // 退化多边形：退化为顶点平均
    return [
      points.reduce((s, p) => s + p[0], 0) / points.length,
      points.reduce((s, p) => s + p[1], 0) / points.length
    ];
  }
  return [cx / (6 * area), cy / (6 * area)];
}

// 气泡 / 拟声词锚点越界时钳回页面内（无效坐标降级）
export function clampPointToPage(point, page) {
  const [x, y] = Array.isArray(point) ? point : [page.width / 2, page.height / 2];
  return [clamp(Number(x) || 0, 0, page.width), clamp(Number(y) || 0, 0, page.height)];
}

export function expandRect(rect, factor) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const w = rect.w * factor;
  const h = rect.h * factor;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function fullPageRect(page) {
  return { x: 0, y: 0, w: page.width, h: page.height };
}

// 把目标区域调整为舞台宽高比并收回页面内 —— 镜头聚焦的核心计算
export function fitRectToAspect(rect, aspect, page) {
  let { x, y, w, h } = rect;
  if (!(w > 0) || !(h > 0) || !(aspect > 0)) return fullPageRect(page);
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  if (w > page.width) { w = page.width; h = w / aspect; }
  if (h > page.height) { h = page.height; w = h * aspect; }
  x = clamp(cx - w / 2, 0, page.width - w);
  y = clamp(cy - h / 2, 0, page.height - h);
  return { x, y, w, h };
}

export function starPoints(cx, cy, outer, inner, spikes = 12) {
  const pts = [];
  for (let i = 0; i < spikes * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / spikes - Math.PI / 2;
    pts.push(`${round(cx + Math.cos(a) * r)},${round(cy + Math.sin(a) * r)}`);
  }
  return pts.join(' ');
}
