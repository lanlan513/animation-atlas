// 模板一：魔法少女「星彩变身」渲染器。
// 动画逻辑（与机甲 / 剑士完全不同）：
//  圆形径向构图、丝带双螺旋轨道、圆形遮罩扩张、星芒粒子向外绽放；
//  角色是柔和剪影，节拍脉冲让所有轨道环呼吸。
import { easeOut, hashNoise } from '../engine.js';
import { circleMask, drawGlyph, shakeOffset, spawnParticle, updateParticles, drawParticle, withAlpha } from '../canvasUtils.js';

export function createMagicalGirlRenderer(ctx, W, H) {
  const particles = [];
  let lastT = -1;
  let lastBurstTick = -1;

  // 颜色明暗微调（避免引入额外工具依赖）
  function mixWhite(hex, amount) {
    const n = parseInt(hex.replace('#', ''), 16);
    const adjust = (c) => Math.max(0, Math.min(255, Math.round(c + (amount < 0 ? c * amount : (255 - c) * amount))));
    return `rgb(${adjust((n >> 16) & 255)},${adjust((n >> 8) & 255)},${adjust(n & 255)})`;
  }

  // 柔和魔法少女剪影：头 + 连衣裙 + 长发，用主色渐变填充
  function drawSilhouette(config, scene, cx, cy) {
    const color = config.primaryColor;
    const { shot, beat } = scene;
    const u = scene.shotU;
    const ignite = shot?.anim === 'closeup-ignite';
    const zoom = ignite ? 1.25 + easeOut(u) * 0.55 : 1;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);
    const auraR = 120 + beat.pulse * 22;
    const aura = ctx.createRadialGradient(0, 10, 20, 0, 10, auraR);
    aura.addColorStop(0, withAlpha('#ffffff', 0.34 + beat.pulse * 0.2));
    aura.addColorStop(0.55, withAlpha(color, 0.28));
    aura.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = aura;
    ctx.beginPath(); ctx.arc(0, 10, auraR, 0, Math.PI * 2); ctx.fill();

    // 长发
    ctx.fillStyle = withAlpha(mixWhite(color, -0.3), 0.92);
    ctx.beginPath();
    ctx.moveTo(-34, -52);
    ctx.quadraticCurveTo(-58, 30 + Math.sin(scene.time * 1.6) * 6, -22, 66);
    ctx.quadraticCurveTo(0, 78, 22, 66);
    ctx.quadraticCurveTo(58, 30 + Math.sin(scene.time * 1.6 + 1) * 6, 34, -52);
    ctx.closePath(); ctx.fill();

    // 头
    ctx.fillStyle = '#ffe7f2';
    ctx.beginPath(); ctx.arc(0, -58, 26, 0, Math.PI * 2); ctx.fill();
    // 点火镜头：眼睛随 u 点亮
    const eye = ignite ? easeOut(u) : 1;
    ctx.fillStyle = withAlpha(color, eye);
    ctx.beginPath(); ctx.arc(-9, -58, 3.4 + beat.pulse * 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(9, -58, 3.4 + beat.pulse * 1.2, 0, Math.PI * 2); ctx.fill();

    // 连衣裙身体（梯形裙摆，随节拍微微展开）
    const skirt = 0.5 + beat.pulse * 0.06;
    ctx.fillStyle = withAlpha(color, 0.95);
    ctx.beginPath();
    ctx.moveTo(-18, -28); ctx.lineTo(18, -28);
    ctx.lineTo(44 + skirt * 18, 52); ctx.lineTo(-44 - skirt * 18, 52);
    ctx.closePath(); ctx.fill();
    // 胸前蝴蝶结符号
    drawGlyph(ctx, scene.symbol?.glyph || '✦', 0, -8, 20 + beat.pulse * 4, '#fff', { shadow: 14 });
    ctx.restore();
  }

  // 双螺旋丝带：两条相位差 π 的正弦带绕角色公转
  function drawRibbons(config, scene, cx, cy) {
    const color = config.primaryColor;
    const { time, shot } = scene;
    const strength = shot?.anim === 'ribbon-vortex' ? 1 : 0.4;
    const spin = time * (shot?.anim === 'ribbon-vortex' ? 2.4 : 0.6);
    for (let arm = 0; arm < 2; arm += 1) {
      ctx.beginPath();
      const phase = arm * Math.PI;
      for (let i = 0; i <= 60; i += 1) {
        const v = i / 60;
        const radius = 40 + v * 200;
        const theta = phase + spin + v * 5.2;
        const x = cx + Math.cos(theta) * radius;
        const y = cy + 10 + Math.sin(theta) * radius * 0.62;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = withAlpha(arm === 0 ? color : '#ffffff', 0.5 * strength);
      ctx.lineWidth = 3.2 * strength;
      ctx.lineCap = 'round';
      ctx.shadowColor = color; ctx.shadowBlur = 12 * strength;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  // 每个镜头的专属 FX
  function drawShotFx(template, config, scene, cx, cy) {
    const color = config.primaryColor;
    const { time, shot, shotEnter } = scene;
    const u = scene.shotU;
    if (!shot) return;

    switch (shot.anim) {
      case 'closeup-ignite': {
        // 瞳孔点火：收缩光环在节拍处扩散
        const ring = (time - shot.start) % 0.9;
        ctx.strokeStyle = withAlpha(color, 0.5 * (1 - ring / 0.9));
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy - 58, 30 + ring * 130, 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case 'ribbon-vortex': {
        // 轨道环：3 圈呼吸，符号沿最外圈公转
        for (let ring = 0; ring < 3; ring += 1) {
          const r = 90 + ring * 52 + Math.sin(time * 2 + ring) * 6;
          ctx.strokeStyle = withAlpha(color, 0.18 + scene.beat.pulse * 0.25);
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.ellipse(cx, cy + 6, r, r * 0.6, 0, 0, Math.PI * 2); ctx.stroke();
        }
        const theta = time * 2.2;
        drawGlyph(ctx, scene.symbol?.glyph || '✦', cx + Math.cos(theta) * 196, cy + 6 + Math.sin(theta) * 122, 26, '#fff', { shadow: 20, rotation: theta });
        break;
      }
      case 'prism-reveal': {
        // 圆形白闪遮罩扩张；进入瞬间爆发星芒
        circleMask(ctx, cx, cy, scene.shotU >= 1 ? W * 0.8 : easeOut01(u) * W * 0.8 + 0.1, () => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, W, H);
        });
        if (shotEnter > 0.95 && lastBurstTick !== Math.floor(shot.start * 100)) {
          lastBurstTick = Math.floor(shot.start * 100);
          for (let i = 0; i < 64; i += 1) {
            const a = (i / 64) * Math.PI * 2 + hashNoise(i) * 0.2;
            const speed = 0.25 + hashNoise(i + 50) * 0.7;
            spawnParticle(particles, {
              kind: 'spark', x: cx, y: cy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
              size: 6 + hashNoise(i + 7) * 10, life: 1 + hashNoise(i + 3) * 0.8,
              color: i % 3 === 0 ? '#ffffff' : withAlpha(color, 0.95), rotation: a, drag: 0.97
            });
          }
        }
        break;
      }
      case 'tiara-descent': {
        // 符号自顶部摇摆落下，落点涟漪
        const fall = Math.min(1, easeOut01(u * 1.25));
        const x = cx + Math.sin(u * Math.PI * 3) * 60 * (1 - fall);
        const y = 60 + fall * (cy - 130);
        drawGlyph(ctx, scene.symbol?.glyph || '✦', x, y, 30, '#fff', { shadow: 22, rotation: fall * Math.PI * 2 });
        if (u > 0.62) {
          const ru = (u - 0.62) / 0.38;
          ctx.strokeStyle = withAlpha(color, 0.6 * (1 - ru));
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx, cy - 70, 12 + ru * 90, 0, Math.PI * 2); ctx.stroke();
        }
        break;
      }
      case 'pose-constellation': {
        // 星座连线姿态 + 节拍处星尘脉冲
        const points = [];
        for (let i = 0; i < 7; i += 1) {
          const a = -Math.PI / 2 + (i - 3) * 0.5 + Math.sin(time * 0.5 + i) * 0.05;
          points.push([cx + Math.cos(a) * (150 + i * 14), cy + Math.sin(a) * (96 + i * 6)]);
        }
        ctx.strokeStyle = withAlpha(color, 0.55);
        ctx.lineWidth = 1;
        ctx.beginPath();
        points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.stroke();
        points.forEach(([x, y], i) => {
          const tw = 0.5 + 0.5 * Math.sin(time * 3 + i * 1.7);
          drawGlyph(ctx, i === 3 ? (scene.symbol?.glyph || '✦') : '✦', x, y, 12 + tw * 5 + scene.beat.pulse * 6, i === 3 ? '#fff' : withAlpha(color, 0.9), { shadow: 10 });
        });
        const tick = Math.floor(time * 12);
        if (scene.beat.pulse > 0.9 && particles.length < 70 && tick !== lastBurstTick) {
          lastBurstTick = tick;
          for (let i = 0; i < 10; i += 1) {
            const angle = hashNoise(time * 10 + i) * Math.PI * 2;
            const speed = 0.15 + hashNoise(i + 2) * 0.35;
            spawnParticle(particles, { kind: 'spark', x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 5 + hashNoise(i) * 7, life: 1.4, color, drag: 0.96 });
          }
        }
        break;
      }
      default: break;
    }
  }

  // easeInOut 圆扩张用的缓出
  function easeOut01(v) { return 1 - (1 - Math.max(0, Math.min(1, v))) ** 2; }

  return {
    get layoutHint() { return 'radial'; },
    reset() { particles.length = 0; lastT = -1; lastBurstTick = -1; },

    render(template, config, scene, dt) {
      const { time, shot } = scene;
      const color = config.primaryColor;
      const cx = W / 2;
      const cy = H / 2 + 8;
      dt = Math.min(dt || 0.016, 0.05);

      // 拖播放头（时间倒退）时不补粒子，直接清空避免错误累积
      if (time < lastT) particles.length = 0;
      lastT = time;

      // 背景：随镜头从深夜紫到主色径向渐变
      const bg = ctx.createRadialGradient(cx, cy, 30, cx, cy, W * 0.7);
      bg.addColorStop(0, withAlpha(color, 0.22 + scene.beat.pulse * 0.12));
      bg.addColorStop(1, '#160f1d');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // 背景星座点
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (let i = 0; i < 48; i += 1) {
        const x = hashNoise(i + 1) * W;
        const y = hashNoise(i + 99) * H;
        const tw = 0.25 + 0.75 * Math.abs(Math.sin(time * (0.6 + hashNoise(i) * 1.4) + i));
        ctx.globalAlpha = 0.12 + tw * 0.3 * (1 + scene.beat.pulse * 0.6);
        ctx.fillRect(x, y, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;

      ctx.save();
      // 魔法少女没有硬震屏，只有在棱镜换装的重拍上轻微晃动
      if (shot?.anim === 'prism-reveal') {
        const s = shakeOffset(time, 5 * (1 - scene.shotU), 30);
        ctx.translate(s.x, s.y);
      }
      drawSilhouette(config, scene, cx, cy);
      drawShotFx(template, config, scene, cx, cy);
      ctx.restore();

      // 丝带涡旋始终在角色上方半透明缠绕（s2 最强）
      drawRibbons(config, scene, cx, cy);

      // 粒子更新与绘制
      updateParticles(particles, dt, W, H);
      for (const p of particles) drawParticle(ctx, p);

      // 角色名：圆体发光，随节拍缩放，居中成徽章式排版
      const namePulse = 1 + scene.beat.pulse * 0.05;
      ctx.save();
      ctx.translate(cx, H - 46);
      ctx.scale(namePulse, namePulse);
      drawGlyph(ctx, config.characterName, 0, 0, 30, '#fff5fb', { shadow: 18, font: "800 30px 'Manrope', sans-serif" });
      ctx.font = "500 11px 'DM Mono', monospace";
      ctx.fillStyle = withAlpha(color, 0.85);
      ctx.textAlign = 'center';
      ctx.fillText(template.subtitle, 0, 22);
      ctx.restore();
    }
  };
}
