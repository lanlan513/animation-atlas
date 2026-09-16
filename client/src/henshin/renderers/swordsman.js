// 模板三：剑士「居合一闪」渲染器。
// 动画逻辑（与魔法少女 / 机甲完全不同）：
//  水墨留白与纵向构图、圆相以单笔速度画出、落叶墨点螺旋汇聚、
//  光刃沿一条笔路径用线端遮罩扫出、十字一闪两道光刃先后交叉；
//  粒子少而重，角色名竖排，整体是减法美学。
import { easeInOut, easeOut, hashNoise } from '../engine.js';
import { drawGlyph, shakeOffset, spawnParticle, updateParticles, drawParticle, withAlpha } from '../canvasUtils.js';

export function createSwordsmanRenderer(ctx, W, H) {
  const particles = [];
  let lastT = -1;
  let slashFired = '';

  // 水墨笔触纸底：暖色留白 + 四角暗角
  function paper(color) {
    const g = ctx.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, W * 0.72);
    g.addColorStop(0, '#ece7da');
    g.addColorStop(1, '#d8d1c0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(40,32,24,0.06)';
    ctx.fillRect(0, 0, W, H);
    void color;
  }

  // 远景剑士剪影：纵向站立 + 长刀，线条极少
  function swordsman(config, scene, cx, cy, opacity) {
    const ink = '#211c18';
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineCap = 'round';
    // 头
    ctx.beginPath(); ctx.arc(cx, cy - 120, 11, 0, Math.PI * 2); ctx.fill();
    // 身体一笔
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(cx, cy - 104); ctx.lineTo(cx, cy - 10); ctx.stroke();
    // 纳刀的手臂
    ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(cx, cy - 80); ctx.quadraticCurveTo(cx + 34, cy - 58, cx + 22, cy - 30); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - 80); ctx.quadraticCurveTo(cx - 30, cy - 60, cx - 20, cy - 36); ctx.stroke();
    // 刀（纵向）
    ctx.strokeStyle = withAlpha(config.primaryColor === '#e8e4d8' ? '#5a5347' : config.primaryColor, 0.9);
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(cx + 22, cy - 30); ctx.lineTo(cx + 22, cy + 96); ctx.stroke();
    // 腿
    ctx.strokeStyle = ink;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(cx, cy - 10); ctx.lineTo(cx - 18, cy + 78); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - 10); ctx.lineTo(cx + 16, cy + 78); ctx.stroke();
    ctx.restore();
  }

  // 画一段有粗细变化的墨线（模拟笔锋）
  function inkLine(points, width, alpha = 0.85) {
    ctx.save();
    ctx.strokeStyle = `rgba(28,23,18,${alpha})`;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
    ctx.restore();
  }

  // 光刃：用「沿路径推进的发光线段」实现，progress 0→1 决定扫出长度
  function bladePath(points, progress, color, width = 7) {
    const total = [];
    let length = 0;
    for (let i = 1; i < points.length; i += 1) {
      const segment = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      total.push(segment); length += segment;
    }
    const target = length * Math.max(0, Math.min(1, progress));
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.strokeStyle = withAlpha(color, 0.95);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    let walked = 0;
    for (let i = 1; i < points.length; i += 1) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      if (walked + total[i - 1] <= target) { ctx.lineTo(x1, y1); walked += total[i - 1]; }
      else {
        const rest = target - walked;
        const k = rest / total[i - 1];
        ctx.lineTo(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
        break;
      }
    }
    ctx.stroke();
    // 白色芯
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = width * 0.32;
    ctx.stroke();
    ctx.restore();
  }

  // 落叶墨点：螺旋向中心汇聚
  function windGather(config, scene) {
    const color = config.primaryColor;
    const { time, u } = scene;
    const cx = W / 2;
    const cy = H / 2 + 10;
    // 圆相：一笔一笔画出（弧长按 u 推进）
    ctx.save();
    ctx.strokeStyle = 'rgba(35,29,22,0.8)';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.arc(cx, cy - 20, 150, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * easeOut(u));
    ctx.stroke();
    ctx.restore();
    // 墨点螺旋
    for (let i = 0; i < 26; i += 1) {
      const seed = hashNoise(i * 3.3);
      const radius = 320 * (1 - easeInOut(u)) + 20;
      const theta = seed * Math.PI * 2 + time * (0.6 + seed) + i;
      const x = cx + Math.cos(theta) * radius;
      const y = cy - 20 + Math.sin(theta) * radius * 0.66;
      const size = 2 + seed * 5;
      ctx.fillStyle = `rgba(30,24,18,${0.25 + seed * 0.5})`;
      ctx.beginPath(); ctx.ellipse(x, y, size, size * 0.6, theta, 0, Math.PI * 2); ctx.fill();
    }
    swordsman(config, scene, cx, cy, 0.35 + easeInOut(u) * 0.65);
  }

  function drawIai(config, scene) {
    const color = config.primaryColor;
    const { u } = scene;
    const cx = W / 2;
    const cy = H / 2 + 10;
    swordsman(config, scene, cx, cy, 1);
    // 居合：单条横向光刃从刀身位置向右扫出（笔路径遮罩）
    const progress = easeInOut(u);
    const points = [[cx + 22, cy - 30], [cx + 120, cy - 60], [cx + 330, cy - 70]];
    bladePath(points, progress, color, 6);
  }

  function twinSlash(config, scene) {
    const color = config.primaryColor;
    const { u, time, shot } = scene;
    const cx = W / 2;
    const cy = H / 2 + 4;
    swordsman(config, scene, cx, cy, 0.9);
    // 两道光刃先后交叉：第一道在 0–0.5，第二道在 0.35–0.85
    const first = easeInOut(Math.min(1, u / 0.5));
    const second = easeInOut(Math.max(0, Math.min(1, (u - 0.35) / 0.5)));
    bladePath([[cx - 300, cy - 120], [cx - 60, cy - 30], [cx + 320, cy + 60]], first, color, 9);
    bladePath([[cx - 300, cy + 120], [cx - 40, cy + 20], [cx + 320, cy - 80]], second, color, 9);
    // 交叉瞬间墨点冲击
    const tick = shot.id;
    if (u > 0.42 && slashFired !== tick) {
      slashFired = tick;
      for (let i = 0; i < 24; i += 1) {
        const a = hashNoise(i + 4) * Math.PI * 2;
        spawnParticle(particles, {
          kind: 'ink', x: cx - 20, y: cy, vx: Math.cos(a) * 0.5, vy: Math.sin(a) * 0.35,
          size: 2 + hashNoise(i) * 5, life: 0.9 + hashNoise(i + 2) * 0.5,
          color: 'rgba(28,23,18,0.8)', drag: 0.92
        });
      }
    }
    void time;
  }

  function sheath(config, scene, template) {
    const color = config.primaryColor;
    const { u, time } = scene;
    const cx = W / 2;
    const cy = H / 2 + 10;
    // 竖线收束：散落墨点向刀身归位
    swordsman(config, scene, cx, cy, 1);
    inkLine([[cx + 22, cy - 40], [cx + 22, cy + 100]], 2.4, 0.9);
    for (let i = 0; i < 12; i += 1) {
      const seed = hashNoise(i + 8);
      const x = cx + 22 + (seed - 0.5) * 220 * (1 - easeOut(u));
      const y = cy + 100 - seed * 160;
      ctx.fillStyle = `rgba(28,23,18,${0.15 + seed * 0.3})`;
      ctx.beginPath(); ctx.arc(x, y, 1.5 + seed * 2, 0, Math.PI * 2); ctx.fill();
    }
    // 最后一拍一道光脉冲后归于留白（finalPulse 来自模板 fx）
    const pulseAt = scene.shot?.fx?.finalPulse ?? template.duration;
    const dt = Math.abs(time - pulseAt);
    if (dt < 0.5) {
      const alpha = 1 - dt / 0.5;
      ctx.fillStyle = withAlpha(color, alpha * 0.85);
      ctx.fillRect(0, 0, W, H);
    }
    // 光效符号在留白中淡入竖排
    drawGlyph(ctx, scene.symbol?.glyph || '一', 120, H / 2 - 10, 52, `rgba(35,29,22,${easeOut(u)})`, { font: "700 52px 'Manrope', serif" });
  }

  return {
    get layoutHint() { return 'ink-vertical'; },
    reset() { particles.length = 0; lastT = -1; slashFired = ''; },

    render(template, config, scene, dt) {
      const { time, shot } = scene;
      const color = config.primaryColor;
      dt = Math.min(dt || 0.016, 0.05);
      if (time < lastT) particles.length = 0;
      lastT = time;

      paper(color);

      ctx.save();
      // 只在十字一闪重拍震屏，幅度克制
      if (shot?.anim === 'twin-slash' && scene.u > 0.35 && scene.u < 0.7) {
        const s = shakeOffset(time, (shot.fx?.shake || 0) * W * 0.7, 26);
        ctx.translate(s.x, s.y);
      }
      switch (shot?.anim) {
        case 'wind-gather': windGather(config, scene); break;
        case 'draw-iaijutsu': drawIai(config, scene); break;
        case 'twin-slash': twinSlash(config, scene); break;
        case 'sheath-resonance': sheath(config, scene, template); break;
        default: break;
      }
      ctx.restore();

      updateParticles(particles, dt, W, H);
      for (const p of particles) drawParticle(ctx, p);

      // 竖排角色名 + 副标题（右侧卷轴版式，与其他两个模板完全不同的排版）
      ctx.save();
      const chars = [...config.characterName].slice(0, 8);
      ctx.font = "700 26px 'Manrope', serif";
      ctx.fillStyle = '#211c18';
      ctx.textAlign = 'center';
      chars.forEach((char, i) => ctx.fillText(char, W - 64, 70 + i * 34));
      ctx.font = "500 10px 'DM Mono', monospace";
      ctx.fillStyle = 'rgba(60,50,40,0.7)';
      [...template.subtitle].slice(0, 14).forEach((char, i) => ctx.fillText(char, W - 100, 70 + i * 15));
      ctx.restore();
    }
  };
}
