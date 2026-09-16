// 画面元素：山峰、河流、受程序化生成，飞鸟沿路径飞行，题字竖排渐入。
// 每个元素带 appearAt(出现时间) 与 duration(生长时长)，由时间轴统一调度。
// 渲染全部确定性(由 seed 决定)，保证重放/同步结果一致。

function rng(seed) {
  let h = (seed >>> 0) || 1;
  return () => {
    h ^= h << 13; h >>>= 0; h ^= h >> 17; h >>>= 0; h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

export const ELEMENT_KINDS = {
  mountain: { label: '山峰', defaultParams: { width: 900, height: 420, peaks: 3, tone: 0.8 } },
  river: { label: '河流', defaultParams: { width: 1400, amplitude: 60, tone: 0.55 } },
  birds: { label: '飞鸟', defaultParams: { count: 5, spread: 260, size: 16, tone: 0.85 } },
  inscription: { label: '题字', defaultParams: { text: '山高水长', seal: '印', tone: 0.9, fontSize: 44 } }
};

// 生成元素操作(含包围盒)，appearAt 由调用方填入
export function createElementOp(id, el, x, y, params, appearAt = 0, duration = 2.5) {
  const p = { ...ELEMENT_KINDS[el].defaultParams, ...params };
  const seed = Math.floor(Math.random() * 1e9);
  let bbox;
  if (el === 'mountain') bbox = [x, y - p.height, x + p.width, y + 10];
  else if (el === 'river') bbox = [x, y - p.amplitude * 2.2, x + p.width, y + p.amplitude * 2.2];
  else if (el === 'birds') bbox = [x - 40, y - p.spread, x + p.spread * 2.4, y + p.spread];
  else bbox = [x - 10, y - 10, x + p.fontSize * 2.2, y + p.fontSize * (p.text.length + 1.6)];
  return { id, kind: 'element', el, x, y, params: p, seed, appearAt, duration, bbox };
}

export function renderElement(ctx, op, progress, timeMs = 0) {
  if (progress <= 0) return;
  ctx.save();
  if (op.el === 'mountain') drawMountain(ctx, op, progress);
  else if (op.el === 'river') drawRiver(ctx, op, progress, timeMs);
  else if (op.el === 'birds') drawBirds(ctx, op, progress, timeMs);
  else if (op.el === 'inscription') drawInscription(ctx, op, progress);
  ctx.restore();
}

// ---- 山峰：正弦叠脊线 + 自上而下渐淡的墨色剪影 + 皴笔纹理，自左向右"长"出 ----
function drawMountain(ctx, op, progress) {
  const { width, height, peaks, tone } = op.params;
  const rand = rng(op.seed);
  const phases = [rand() * 6.28, rand() * 6.28, rand() * 6.28];
  const ridgeY = (t) => {
    const base = Math.sin(t * Math.PI * peaks + phases[0]) * 0.5 +
      Math.sin(t * Math.PI * peaks * 2.3 + phases[1]) * 0.3 +
      Math.sin(t * Math.PI * peaks * 5.1 + phases[2]) * 0.2;
    return op.y - height * (0.35 + 0.65 * (base * 0.5 + 0.5));
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(op.x - 4, op.y - height - 20, width * progress + 8, height + 40);
  ctx.clip(); // 生长揭示

  // 山体剪影： ridge 浓、山脚淡
  const grad = ctx.createLinearGradient(0, op.y - height, 0, op.y);
  grad.addColorStop(0, `rgba(20,24,28,${0.72 * tone})`);
  grad.addColorStop(0.7, `rgba(20,24,28,${0.25 * tone})`);
  grad.addColorStop(1, 'rgba(20,24,28,0)');
  ctx.beginPath();
  ctx.moveTo(op.x, op.y);
  for (let i = 0; i <= 60; i += 1) {
    const t = i / 60;
    ctx.lineTo(op.x + t * width, ridgeY(t));
  }
  ctx.lineTo(op.x + width, op.y);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // 皴笔：沿山脊向下的短线纹理
  ctx.strokeStyle = `rgba(20,24,28,${0.5 * tone})`;
  ctx.lineCap = 'round';
  const rand2 = rng(op.seed + 99);
  for (let i = 0; i < 46; i += 1) {
    const t = rand2();
    const rx = op.x + t * width;
    const ry = ridgeY(t);
    const len = 12 + rand2() * height * 0.22;
    ctx.lineWidth = 0.8 + rand2() * 1.8;
    ctx.globalAlpha = 0.16 + rand2() * 0.3;
    ctx.beginPath();
    ctx.moveTo(rx, ry + 2);
    ctx.quadraticCurveTo(rx + (rand2() - 0.5) * 14, ry + len * 0.6, rx + (rand2() - 0.5) * 22, ry + len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---- 河流：双岸曲线 + 内部流动线，随生长自左向右铺开 ----
function drawRiver(ctx, op, progress, timeMs) {
  const { width, amplitude, tone } = op.params;
  const rand = rng(op.seed);
  const ph = [rand() * 6.28, rand() * 6.28];
  const centerY = (t) => op.y + Math.sin(t * 6.28 * 1.6 + ph[0]) * amplitude * 0.5 +
    Math.sin(t * 6.28 * 3.7 + ph[1]) * amplitude * 0.22;
  const half = (t) => amplitude * (0.5 + 0.3 * Math.sin(t * 6.28 * 2.2 + ph[1]));

  ctx.save();
  ctx.beginPath();
  ctx.rect(op.x - 4, op.y - amplitude * 2.4, width * progress + 8, amplitude * 4.8);
  ctx.clip();

  const steps = 70;
  // 岸线
  ctx.strokeStyle = `rgba(30,40,48,${0.55 * tone})`;
  for (const side of [-1, 1]) {
    ctx.lineWidth = side < 0 ? 2.2 : 1.4;
    ctx.globalAlpha = side < 0 ? 0.7 : 0.45;
    ctx.beginPath();
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = op.x + t * width;
      const y = centerY(t) + side * half(t);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // 水纹：断续流线，播放时微微漂移
  const drift = (timeMs / 4000) % 1;
  ctx.lineWidth = 1;
  for (let line = 0; line < 5; line += 1) {
    const off = (line - 2) * 0.32;
    ctx.globalAlpha = 0.16 + 0.05 * line;
    ctx.beginPath();
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const tt = (t + drift * 0.08 + line * 0.13) % 1;
      const x = op.x + t * width;
      const y = centerY(tt) + off * half(tt);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---- 飞鸟：一队"人"字形小鸟沿贝塞尔路径飞过，翅膀扇动 ----
function drawBirds(ctx, op, progress, timeMs) {
  const { count, spread, size, tone } = op.params;
  const rand = rng(op.seed);
  const birds = [];
  for (let i = 0; i < count; i += 1) {
    birds.push({
      lag: i * (0.5 + rand() * 0.4) / count,
      dy: (rand() - 0.5) * spread * 0.5,
      phase: rand() * 6.28,
      scale: 0.7 + rand() * 0.6
    });
  }
  const pathX = (t) => op.x + t * spread * 2.2;
  const pathY = (t, dy) => op.y + Math.sin(t * 3.6) * spread * 0.28 + dy;

  ctx.strokeStyle = `rgba(20,24,28,${0.85 * tone})`;
  ctx.lineCap = 'round';
  for (const b of birds) {
    const t = progress * 1.15 - b.lag;
    if (t <= 0 || t >= 1.1) continue;
    const x = pathX(t);
    const y = pathY(t, b.dy);
    const flap = Math.sin(timeMs / 130 + b.phase) * 0.65;
    const s = size * b.scale;
    ctx.globalAlpha = Math.min(1, (1.1 - t) * 4) * 0.9;
    ctx.lineWidth = Math.max(1.1, s * 0.14);
    ctx.beginPath();
    ctx.moveTo(x - s, y - s * 0.5 * flap);
    ctx.quadraticCurveTo(x - s * 0.3, y + s * 0.22, x, y);
    ctx.quadraticCurveTo(x + s * 0.3, y + s * 0.22, x + s, y - s * 0.5 * flap);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ---- 题字：竖排逐字浮现 + 朱红印章 ----
function drawInscription(ctx, op, progress) {
  const { text, seal, tone, fontSize } = op.params;
  const chars = [...text];
  const shown = Math.ceil(chars.length * progress);
  ctx.fillStyle = `rgba(24,24,24,${0.88 * tone})`;
  ctx.font = `${fontSize}px "Kaiti SC", "STKaiti", "KaiTi", "DFKai-SB", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  chars.forEach((ch, i) => {
    if (i >= shown) return;
    const local = Math.min(1, progress * chars.length - i);
    ctx.globalAlpha = local * 0.92;
    ctx.fillText(ch, op.x + fontSize * 0.5, op.y + i * fontSize * 1.12);
  });
  // 印章：最后出现
  if (progress > 0.85 && seal) {
    const sealAlpha = (progress - 0.85) / 0.15;
    const sy = op.y + chars.length * fontSize * 1.12 + fontSize * 0.35;
    const ss = fontSize * 0.9;
    ctx.globalAlpha = sealAlpha * 0.85;
    ctx.fillStyle = '#b3322c';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(op.x + fontSize * 0.5 - ss / 2, sy, ss, ss, ss * 0.12);
    else ctx.rect(op.x + fontSize * 0.5 - ss / 2, sy, ss, ss);
    ctx.fill();
    ctx.globalAlpha = sealAlpha;
    ctx.fillStyle = '#f5efe2';
    ctx.font = `${ss * 0.62}px "Kaiti SC", "STKaiti", "KaiTi", serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText([...seal][0] || '印', op.x + fontSize * 0.5, sy + ss / 2 + 1);
  }
  ctx.globalAlpha = 1;
}
