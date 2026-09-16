// Canvas2D 渲染共享工具：色彩、粒子系统、遮罩与通用图元。
// 三个模板的渲染器共用这些原语，但粒子行为与遮罩形状各不相同。
import { hashNoise } from './engine.js';

export function hexToRgb(hex) {
  const value = (hex || '#ffffff').replace('#', '');
  const n = parseInt(value.length === 3 ? value.split('').map((c) => c + c).join('') : value, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function withAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function mix(hexA, hexB, u) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const m = (x, y) => Math.round(x + (y - x) * u);
  return `rgb(${m(a.r, b.r)}, ${m(a.g, b.g)}, ${m(a.b, b.b)})`;
}

// ---------- 粒子 ----------
// kind 决定运动模型：spark（向外）/ orbit（轨道公转）/ square（方块尾迹）/ ink（墨点）
export function spawnParticle(list, particle) {
  list.push({ age: 0, life: 1.2, ...particle });
}

// 确定性出生：以 (origin, index) 为种子
export function seededParticle(origin, index) {
  const a = hashNoise(origin + index * 3.1) * Math.PI * 2;
  const speed = 0.4 + hashNoise(origin * 7.7 + index) * 1.6;
  return { angle: a, speed };
}

export function updateParticles(list, dt, W, H) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const p = list[i];
    p.age += dt;
    if (p.age >= p.life) { list.splice(i, 1); continue; }
    const drag = p.drag ?? 0.94;
    p.vx = (p.vx || 0) + (p.ax || 0) * dt;
    p.vy = (p.vy || 0) + (p.ay || 0) * dt;
    p.x += p.vx * dt * W;
    p.y += p.vy * dt * H;
    p.vx *= drag;
    p.vy *= drag;
    if (p.spin) p.rotation = (p.rotation || 0) + p.spin * dt;
    if (p.orbit) { // 轨道粒子：绕 (cx, cy) 公转
      p.theta += p.orbit * dt * (p.dir || 1);
    }
  }
}

export function drawParticle(ctx, p) {
  const u = p.age / p.life;
  const alpha = (1 - u) * (p.alpha ?? 1);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = p.color;
  ctx.strokeStyle = p.color;
  if (p.kind === 'square') {
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation || 0);
    const size = p.size * (1 - u * 0.4);
    ctx.fillRect(-size / 2, -size / 2, size, size);
  } else if (p.kind === 'ink') {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (1 + u * 1.8), 0, Math.PI * 2);
    ctx.fill();
  } else if (p.kind === 'ring') {
    ctx.lineWidth = Math.max(0.6, p.size * 0.18 * (1 - u));
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.4 + u * 1.4), 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // spark：星芒（四笔十字 + 旋转）
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation || 0);
    const size = p.size * (1 - u * 0.6);
    ctx.fillRect(-size / 2, -size * 0.12, size, size * 0.24);
    ctx.fillRect(-size * 0.12, -size / 2, size * 0.24, size);
  }
  ctx.restore();
}

// ---------- 遮罩 ----------
// 圆形扩张遮罩（棱镜换装）：在圆内绘制内容
export function circleMask(ctx, cx, cy, radius, draw) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0.1, radius), 0, Math.PI * 2);
  ctx.clip();
  draw();
  ctx.restore();
}

// 水平扫描遮罩（机甲冷启动）：只露出扫描条以下
export function horizontalWipeMask(ctx, W, y, draw) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, Math.max(0, y));
  ctx.clip();
  draw();
  ctx.restore();
}

// 纵向切片遮罩（装甲咬合）：n 条缝，每条有独立的开合进度 [0..1]
export function verticalSliceMask(ctx, W, H, count, progress, stagger, draw) {
  ctx.save();
  ctx.beginPath();
  const sliceW = W / count;
  for (let i = 0; i < count; i += 1) {
    const open = Math.max(0, Math.min(1, (progress - i * stagger) / (1 - stagger)));
    const cx = (i + 0.5) * sliceW;
    const half = (sliceW / 2) * open;
    ctx.rect(cx - half, 0, half * 2, H);
  }
  ctx.clip();
  draw();
  ctx.restore();
}

// ---------- 通用图元 ----------
export function drawPolygon(ctx, cx, cy, radius, sides, rotation = 0) {
  ctx.beginPath();
  for (let i = 0; i < sides; i += 1) {
    const angle = rotation + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function drawHex(ctx, cx, cy, radius, rotation = 0) {
  drawPolygon(ctx, cx, cy, radius, 6, rotation);
}

export function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 画一个字符（光效符号）
export function drawGlyph(ctx, glyph, x, y, size, color, opts = {}) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${opts.weight || 700} ${size}px ${opts.font || "'Manrope', sans-serif"}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (opts.shadow) { ctx.shadowColor = color; ctx.shadowBlur = opts.shadow; }
  if (opts.rotation) { ctx.translate(x, y); ctx.rotate(opts.rotation); ctx.fillText(glyph, 0, 0); }
  else ctx.fillText(glyph, x, y);
  ctx.restore();
}

// 屏幕震屏偏移（确定性）
export function shakeOffset(t, amount, frequency = 24) {
  const tick = Math.floor(t * frequency * 4);
  const a = hashNoise(tick + 11) * amount;
  const b = hashNoise(tick + 47) * amount;
  return { x: a, y: b };
}
