// 水墨笔刷引擎。
// - 离屏 Canvas 缓存笔触纹理(湿笔/枯笔/晕墨三种图章)，绘制时 drawImage 盖章，避免逐像素计算。
// - 墨量模型：起笔墨满，随行笔距离消耗；墨足→饱满湿笔，墨枯→飞白(多根笔毫丝)。
// - 浓淡：tone(焦/浓/重/淡/清) × 压力 × 墨量共同决定透明度。
// - 所有"随机"都由确定性哈希产生，保证撤销重绘、多端同步、回放时画面一致。

const TIP_SIZE = 96;

function hashRand(seed) {
  let h = (seed >>> 0) || 1;
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >> 17; h >>>= 0;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  return c;
}

export class BrushEngine {
  constructor() {
    this.tipCache = new Map();   // 笔触纹理离屏缓存
    this.lenCache = new WeakMap();
  }

  // 湿笔图章：中心浓、边缘柔的径向渐变，带少量颗粒
  wetTip() {
    if (this.tipCache.has('wet')) return this.tipCache.get('wet');
    const c = makeCanvas(TIP_SIZE);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(TIP_SIZE / 2, TIP_SIZE / 2, 1, TIP_SIZE / 2, TIP_SIZE / 2, TIP_SIZE / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.95)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.85, 'rgba(0,0,0,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, TIP_SIZE, TIP_SIZE);
    const rand = hashRand(7);
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    for (let i = 0; i < 90; i += 1) {
      const a = rand() * Math.PI * 2; const r = rand() * TIP_SIZE * 0.42;
      ctx.fillRect(TIP_SIZE / 2 + Math.cos(a) * r, TIP_SIZE / 2 + Math.sin(a) * r, 1.2, 1.2);
    }
    this.tipCache.set('wet', c);
    return c;
  }

  // 枯笔图章：边缘破碎、内部有飞白孔洞
  dryTip() {
    if (this.tipCache.has('dry')) return this.tipCache.get('dry');
    const c = makeCanvas(TIP_SIZE);
    const ctx = c.getContext('2d');
    const rand = hashRand(23);
    const g = ctx.createRadialGradient(TIP_SIZE / 2, TIP_SIZE / 2, 1, TIP_SIZE / 2, TIP_SIZE / 2, TIP_SIZE / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.75)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.30)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, TIP_SIZE, TIP_SIZE);
    // 挖出不规则白丝(飞白的"白")
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 26; i += 1) {
      const y = rand() * TIP_SIZE;
      ctx.fillRect(rand() * TIP_SIZE * 0.3, y, TIP_SIZE * (0.3 + rand() * 0.5), 0.8 + rand() * 1.6);
    }
    ctx.globalCompositeOperation = 'source-over';
    this.tipCache.set('dry', c);
    return c;
  }

  // 晕墨图章：边缘呈花瓣状起伏的墨团
  blotchTip() {
    if (this.tipCache.has('blotch')) return this.tipCache.get('blotch');
    const c = makeCanvas(TIP_SIZE);
    const ctx = c.getContext('2d');
    const rand = hashRand(51);
    const petals = 9;
    ctx.beginPath();
    for (let i = 0; i <= 64; i += 1) {
      const a = (i / 64) * Math.PI * 2;
      const wobble = 0.72 + 0.28 * Math.abs(Math.sin(a * petals * 0.5 + rand() * 0.6));
      const r = (TIP_SIZE / 2) * wobble;
      const x = TIP_SIZE / 2 + Math.cos(a) * r;
      const y = TIP_SIZE / 2 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(TIP_SIZE / 2, TIP_SIZE / 2, 1, TIP_SIZE / 2, TIP_SIZE / 2, TIP_SIZE / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.85)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.38)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fill();
    this.tipCache.set('blotch', c);
    return c;
  }

  strokeLength(pts) {
    let cached = this.lenCache.get(pts);
    if (cached == null) {
      cached = 0;
      for (let i = 1; i < pts.length; i += 1) {
        cached += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      }
      this.lenCache.set(pts, cached);
    }
    return cached;
  }

  // 把一笔渲染到指定 ctx。progress∈(0,1] 用于"笔触生长"回放。
  renderStroke(ctx, op, progress = 1) {
    const pts = op.pts;
    if (!pts || pts.length === 0) return;
    const size = op.style?.size || 14;
    const tone = op.style?.tone ?? 0.85;   // 墨色深浅 0..1
    const total = this.strokeLength(pts);
    const budget = total * progress;
    const seedBase = op.seed || 1;
    const rand = hashRand(seedBase);

    let wet = 1;                 // 墨量：起笔饱满
    const drain = 0.0016 * (14 / size); // 行笔耗墨
    let walked = 0;

    const stamp = (x, y, w, alpha, dry) => {
      ctx.globalAlpha = Math.max(0.02, Math.min(1, alpha));
      ctx.drawImage(dry ? this.dryTip() : this.wetTip(), x - w / 2, y - w / 2, w, w);
    };

    let px = pts[0][0]; let py = pts[0][1]; let pp = pts[0][2];
    stamp(px, py, size * (0.3 + 0.7 * pp), tone * 0.9, false);

    for (let i = 1; i < pts.length && walked < budget; i += 1) {
      const [x, y, p] = pts[i];
      const segLen = Math.hypot(x - px, y - py);
      if (segLen < 1e-6) continue;
      const dirX = (x - px) / segLen;
      const dirY = (y - py) / segLen;
      const w0 = size * (0.3 + 0.7 * pp);
      const spacing = Math.max(1.1, w0 * 0.3);
      let s = spacing;
      while (s <= segLen && walked + s <= budget) {
        const cx = px + dirX * s;
        const cy = py + dirY * s;
        const t = s / segLen;
        const cp = pp + (p - pp) * t;
        const w = size * (0.3 + 0.7 * cp);
        wet = Math.max(0, wet - spacing * drain);
        const dry = wet < 0.42;
        const alpha = tone * (0.22 + 0.78 * wet) * (0.45 + 0.55 * cp);
        stamp(cx, cy, w, alpha, dry);
        if (dry) this.renderBristles(ctx, cx, cy, dirX, dirY, w, tone, wet, rand);
        s += spacing;
      }
      walked += segLen;
      // 跨段剩余距离折算：把未走完的余量留到下一段(简化处理：直接前进到段尾)
      px = x; py = y; pp = p;
    }

    ctx.globalAlpha = 1;
    if (op.bleeds) this.renderBleeds(ctx, op.bleeds, progress, tone);
  }

  // 飞白：墨枯时笔毫分叉成数条细丝，随方向排开，丝间留白
  renderBristles(ctx, x, y, dirX, dirY, w, tone, wet, rand) {
    const count = 3 + Math.floor(rand() * 3);
    const nx = -dirY; const ny = dirX; // 垂直于行笔方向
    ctx.strokeStyle = '#000';
    ctx.lineCap = 'round';
    for (let b = 0; b < count; b += 1) {
      const off = (b - (count - 1) / 2) * (w / count) * (0.7 + rand() * 0.5);
      const a = tone * (0.5 - wet) * (0.35 + rand() * 0.5);
      if (a < 0.03) continue; // 丝与丝之间的"白"
      ctx.globalAlpha = Math.min(0.8, a);
      ctx.lineWidth = Math.max(0.6, w / 9);
      const len = w * (0.5 + rand() * 0.6);
      ctx.beginPath();
      ctx.moveTo(x + nx * off - dirX * len * 0.4, y + ny * off - dirY * len * 0.4);
      ctx.lineTo(x + nx * off + dirX * len * 0.6, y + ny * off + dirY * len * 0.6);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // 晕墨：停顿处墨向纸里扩散的不规则墨团
  renderBleeds(ctx, bleeds, progress, tone = 0.85) {
    const tip = this.blotchTip();
    for (const [x, y, r, a] of bleeds) {
      const grow = Math.min(1, progress * 1.4); // 晕开略滞后于笔触
      const rr = r * (0.4 + 0.6 * grow);
      ctx.globalAlpha = a * tone * grow;
      ctx.drawImage(tip, x - rr, y - rr, rr * 2, rr * 2);
    }
    ctx.globalAlpha = 1;
  }
}
