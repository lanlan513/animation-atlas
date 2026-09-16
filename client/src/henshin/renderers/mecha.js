// 模板二：机甲「零号机接続」渲染器。
// 动画逻辑（与魔法少女 / 剑士完全不同）：
//  直角网格 + 扫描线、六边形反应堆脉冲、纵向切片遮罩里装甲板左右咬合、
//  HUD 数据读数、面罩从上砸落、方块尾迹粒子向下喷射；整体是冷硬工程风。
import { easeIn, easeInOut, easeOut, hashNoise } from '../engine.js';
import {
  drawGlyph, drawHex, drawPolygon, horizontalWipeMask, roundRectPath, shakeOffset,
  spawnParticle, updateParticles, drawParticle, verticalSliceMask, withAlpha
} from '../canvasUtils.js';

export function createMechaRenderer(ctx, W, H) {
  const particles = [];
  let lastT = -1;
  let lastReactorTick = -1;

  function drawScanlines(time, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const gap = 4;
    const offset = (time * 60) % gap;
    for (let y = -gap; y < H; y += gap) ctx.fillRect(0, y + offset, W, 1);
    ctx.restore();
  }

  // 六边形地面网格，透视灭点在画面中央
  function drawGrid(color, time) {
    ctx.save();
    ctx.strokeStyle = withAlpha(color, 0.1);
    ctx.lineWidth = 1;
    const horizon = H * 0.42;
    for (let i = -10; i <= 10; i += 1) {
      ctx.beginPath();
      ctx.moveTo(W / 2 + i * 26, horizon);
      ctx.lineTo(W / 2 + i * 160, H);
      ctx.stroke();
    }
    for (let row = 0; row < 8; row += 1) {
      const v = (row + (time * 0.25) % 1) / 8;
      const y = horizon + (H - horizon) * v * v;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();
  }

  // 机械骨架（线框），各镜头共用
  function mechaFrame(color, alpha = 0.85) {
    ctx.save();
    ctx.translate(W / 2, H / 2 + 20);
    ctx.strokeStyle = withAlpha(color, alpha);
    ctx.lineWidth = 2;
    roundRectPath(ctx, -42, -120, 84, 70, 10); ctx.stroke(); // 头盔
    ctx.beginPath(); // 躯干
    ctx.moveTo(-64, -42); ctx.lineTo(64, -42); ctx.lineTo(48, 90); ctx.lineTo(-48, 90); ctx.closePath(); ctx.stroke();
    ctx.strokeRect(-96, -46, 34, 26); // 肩甲
    ctx.strokeRect(62, -46, 34, 26);
    ctx.restore();
  }

  function drawBoot(config, scene) {
    const color = config.primaryColor;
    const { u, time } = scene;
    // 水平扫描遮罩：从顶向下揭开机体
    horizontalWipeMask(ctx, W, H * easeOut(u), () => {
      drawScanlines(time, color, 0.18);
      mechaFrame(color, 0.9);
    });
    // 扫描条
    const y = H * easeOut(u);
    ctx.fillStyle = withAlpha(color, 0.9);
    ctx.fillRect(0, y - 2, W, 2);
    ctx.fillStyle = withAlpha(color, 0.18);
    ctx.fillRect(0, y - 26, W, 26);
    // 启动日志
    ctx.font = "500 11px 'DM Mono', monospace";
    ctx.fillStyle = withAlpha('#9fd8ff', 0.85);
    ctx.textAlign = 'left';
    const lines = ['> BIOS OK', '> NEURAL LINK ...', '> HYDRAULICS 84%', '> READY'];
    lines.forEach((line, i) => {
      if (u > (i + 1) / 6) ctx.fillText(line, 30, H - 110 + i * 16);
    });
  }

  function drawReactor(config, scene) {
    const color = config.primaryColor;
    const { time, beat } = scene;
    mechaFrame(color, 0.5);
    const cx = W / 2;
    const cy = H / 2 + 14;
    // 六边形反应堆：脉冲缩放 + 旋转外环
    const pulse = 0.86 + beat.pulse * 0.16;
    ctx.save();
    ctx.translate(cx, cy);
    for (let ring = 2; ring >= 0; ring -= 1) {
      const r = (28 + ring * 20) * pulse;
      drawHex(ctx, 0, 0, r, time * (ring % 2 ? -0.8 : 0.8));
      ctx.fillStyle = ring === 0 ? withAlpha('#ffffff', 0.85) : withAlpha(color, 0.16 + beat.pulse * 0.2);
      ctx.fill();
      ctx.strokeStyle = withAlpha(color, 0.7);
      ctx.lineWidth = 1.4; ctx.stroke();
    }
    ctx.restore();
    // 网格单元按节拍点亮
    const cells = scene.shot?.fx?.gridCells || 7;
    for (let i = 0; i < cells * cells; i += 1) {
      const col = i % cells;
      const row = Math.floor(i / cells);
      const x = cx - 150 + col * (300 / (cells - 1));
      const y = 70 + row * 12;
      const lit = hashNoise(i + Math.floor(time * 6)) > 0.62;
      ctx.fillStyle = lit ? withAlpha(color, 0.8) : 'rgba(90,130,170,0.18)';
      ctx.fillRect(x - 3, y - 3, 6, 6);
    }
    // 点火节拍喷出方块火花
    const tick = Math.floor(time * 10);
    if (beat.pulse > 0.85 && particles.length < 120 && tick !== lastReactorTick) {
      lastReactorTick = tick;
      for (let i = 0; i < 8; i += 1) {
        const a = hashNoise(time + i) * Math.PI * 2;
        spawnParticle(particles, {
          kind: 'square', x: cx, y: cy, vx: Math.cos(a) * 0.35, vy: Math.sin(a) * 0.35,
          size: 4 + hashNoise(i + 9) * 6, life: 0.7, color, rotation: a, spin: 4, drag: 0.9
        });
      }
    }
  }

  function drawPlateLock(config, scene) {
    const color = config.primaryColor;
    const { u } = scene;
    // 纵向切片遮罩：装甲在缝内逐条左右咬合
    const slices = scene.shot?.fx?.slices || 6;
    verticalSliceMask(ctx, W, H, slices, easeInOut(u), 0.12, () => {
      mechaFrame(color, 0.95);
      const sliceW = W / slices;
      for (let i = 0; i < slices; i += 1) {
        const local = Math.max(0, Math.min(1, (u - i * 0.12) / 0.4));
        const fromLeft = i < slices / 2;
        const travel = (1 - easeOut(local)) * sliceW * 1.6 * (fromLeft ? -1 : 1);
        ctx.fillStyle = withAlpha(color, 0.22 + 0.2 * local);
        ctx.strokeStyle = withAlpha(color, 0.8);
        const x = i * sliceW + travel;
        roundRectPath(ctx, x + 3, H * 0.18, sliceW - 6, H * 0.64, 4);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = withAlpha('#cfe6ff', 0.5 * local);
        for (let k = 0; k < 5; k += 1) ctx.fillRect(x + 10, H * 0.22 + k * 46, 4, 4);
      }
    });
    if (u > 0.82) {
      ctx.font = "700 13px 'DM Mono', monospace";
      ctx.fillStyle = withAlpha(color, (u - 0.82) / 0.18);
      ctx.textAlign = 'center';
      ctx.fillText('● ARMOR LOCKED', W / 2, 60);
    }
  }

  function drawHudSweep(config, scene) {
    const color = config.primaryColor;
    const { time, u } = scene;
    mechaFrame(color, 0.6);
    ctx.save();
    ctx.strokeStyle = withAlpha(color, 0.8);
    ctx.fillStyle = withAlpha(color, 0.8);
    ctx.font = "500 10px 'DM Mono', monospace";
    // 左：数据柱
    for (let i = 0; i < 12; i += 1) {
      const h = 18 + hashNoise(i + Math.floor(time * 8)) * 70;
      ctx.fillRect(28 + i * 12, H - 90 - h, 7, h);
    }
    ctx.strokeText('POWER OUTPUT', 28, H - 96);
    // 右：环形准星
    const cx = W - 120;
    const cy = H / 2 - 30;
    for (let r = 26; r <= 62; r += 18) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(cx - 78, cy); ctx.lineTo(cx + 78, cy);
    ctx.moveTo(cx, cy - 78); ctx.lineTo(cx, cy + 78); ctx.stroke();
    // 顶部横扫读数
    const sweep = (time * 220) % W;
    ctx.fillStyle = withAlpha(color, 0.25);
    ctx.fillRect(0, 78, sweep, 2);
    ctx.fillStyle = withAlpha('#ffffff', 0.8);
    ctx.fillRect(sweep - 24, 74, 24, 10);
    ctx.fillStyle = withAlpha(color, 0.85);
    ctx.textAlign = 'right';
    ctx.fillText(`SYSTEM CHECK ${Math.round(u * 100)}%`, W - 28, 70);
    ctx.restore();
  }

  function drawVisorSlam(config, scene) {
    const color = config.primaryColor;
    const { time, u } = scene;
    mechaFrame(color, 0.7);
    // 面罩自上而下砸落（easeIn），到位后内部扫描光条接管视野
    ctx.save();
    ctx.translate(W / 2, H / 2 - 100);
    const reveal = Math.min(1, easeIn(u) * 1.4);
    ctx.beginPath();
    ctx.rect(-42, 0, 84, 70 * reveal);
    ctx.clip();
    ctx.fillStyle = '#0a1018';
    ctx.fillRect(-42, 0, 84, 70);
    const sy = 8 + ((time * 90) % 54);
    ctx.fillStyle = withAlpha(color, 0.9);
    ctx.fillRect(-42, sy, 84, 3);
    ctx.fillStyle = withAlpha(color, 0.2);
    ctx.fillRect(-42, sy - 10, 84, 10);
    drawPolygon(ctx, 0, 32, 10 + scene.beat.pulse * 3, 3, -Math.PI / 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.restore();
  }

  function drawThruster(config, scene) {
    const color = config.primaryColor;
    const { time, u } = scene;
    // 机体整体上抬离架
    const lift = easeOut(u) * 46;
    ctx.save();
    ctx.translate(0, -lift);
    mechaFrame(color, 1);
    ctx.restore();
    // 发射架导轨
    ctx.strokeStyle = withAlpha(color, 0.4);
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(W / 2 - 120, H - 30); ctx.lineTo(W / 2 - 90, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W / 2 + 120, H - 30); ctx.lineTo(W / 2 + 90, H); ctx.stroke();
    // 方块尾迹粒子：向下加速喷射
    const budget = 140;
    let guard = 0;
    while (particles.length < budget && guard < 12) {
      guard += 1;
      const index = particles.length + guard;
      const side = hashNoise(time * 100 + index) > 0.5 ? 1 : -1;
      spawnParticle(particles, {
        kind: 'square',
        x: W / 2 + side * (26 + hashNoise(index) * 30),
        y: H / 2 + 96 - lift,
        vx: side * hashNoise(index + 2) * 0.12,
        vy: 0.5 + hashNoise(index + 4) * 0.9,
        ay: 2.4,
        size: 4 + hashNoise(index + 6) * 8,
        life: 0.55 + hashNoise(index + 8) * 0.4,
        color: hashNoise(index) > 0.7 ? '#ffffff' : color,
        spin: (hashNoise(index) - 0.5) * 8,
        drag: 1
      });
    }
  }

  return {
    get layoutHint() { return 'grid'; },
    reset() { particles.length = 0; lastT = -1; lastReactorTick = -1; },

    render(template, config, scene, dt) {
      const { time, shot, u } = scene;
      const color = config.primaryColor;
      dt = Math.min(dt || 0.016, 0.05);
      if (time < lastT) particles.length = 0;
      lastT = time;

      // 工程深色底 + 扫描线 + 透视网格
      ctx.fillStyle = '#070b10';
      ctx.fillRect(0, 0, W, H);
      drawScanlines(time, color, 0.1);
      drawGrid(color, time);

      // 震屏：装甲到位 / 面罩砸下 / 推进（fx.shake 来自模板定义）
      let amp = 0;
      if (shot?.fx?.shake) {
        if (shot.anim === 'plate-lock') amp = u > 0.8 ? shot.fx.shake * W * (1 - (u - 0.8) / 0.2) : 0;
        else amp = shot.fx.shake * W;
      }
      const s = amp > 0 ? shakeOffset(time, amp, 32) : { x: 0, y: 0 };

      ctx.save();
      ctx.translate(s.x, s.y);
      switch (shot?.anim) {
        case 'boot-scanline': drawBoot(config, scene); break;
        case 'core-reactor': drawReactor(config, scene); break;
        case 'plate-lock': drawPlateLock(config, scene); break;
        case 'hud-sweep': drawHudSweep(config, scene); break;
        case 'visor-slam': drawVisorSlam(config, scene); break;
        case 'thruster-burst': drawThruster(config, scene); break;
        default: break;
      }
      ctx.restore();

      updateParticles(particles, dt, W, H);
      for (const p of particles) drawParticle(ctx, p);

      // 机体代号：等宽字体、角标式固定左上（排版与其他模板不同）
      ctx.save();
      ctx.font = "700 15px 'DM Mono', monospace";
      ctx.fillStyle = withAlpha(color, 0.9);
      ctx.textAlign = 'left';
      ctx.fillText(config.characterName, 24, 34);
      ctx.font = "500 9px 'DM Mono', monospace";
      ctx.fillStyle = 'rgba(150,180,210,0.6)';
      ctx.fillText(`SEQ ${String(scene.shotIndex + 1).padStart(2, '0')}/${String(template.shots.length).padStart(2, '0')}`, 24, 50);
      ctx.restore();
    }
  };
}
