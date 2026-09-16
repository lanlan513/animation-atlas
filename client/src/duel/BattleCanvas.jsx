// Battlefield animation. The canvas ONLY replays the phase timeline returned
// by the server verdict — it never infers an outcome locally. Stale-control
// rules:
//   1. exactly one requestAnimationFrame loop exists at any time;
//   2. a newer verdict replaces the timeline immediately (nothing is queued);
//   3. while the parent is waiting on the server (`pending`), all verdict
//      visuals are torn down and a neutral "judging" idle is shown instead of
//      the previous, now-outdated conclusion.

import { useEffect, useRef } from 'react';
import { mulberry32 } from '../../../shared/panel-punch-core.js';

const W = 640;
const H = 360;
const GROUND = 300;

function easeOut(t) { return 1 - (1 - t) ** 3; }
function easeIn(t) { return t * t * t; }
function lerp(a, b, t) { return a + (b - a) * t; }

// Where each hero stands at time `t`, given the phase list. Pure function of
// the server timeline + wall clock inside the effect.
function heroPositions(phases, t, winnerSide) {
  const sides = { a: { x: 120, y: GROUND, dir: 1 }, b: { x: 520, y: GROUND, dir: -1 } };
  const pos = {
    a: { ...sides.a, scale: 1, flash: 0, word: null, off: false },
    b: { ...sides.b, scale: 1, flash: 0, word: null, off: false }
  };
  const loserSide = winnerSide === 'a' ? 'b' : 'a';

  for (const phase of phases) {
    const local = (t - phase.start) / phase.duration;
    if (local < 0) break;
    const p = Math.min(1, local);
    const actor = phase.actor === 'both' ? null : phase.actor;

    switch (phase.name) {
      case 'approach': {
        const e = easeOut(p);
        pos.a.x = lerp(120, 250, e);
        pos.b.x = lerp(520, 390, e);
        break;
      }
      case 'sprint': {
        const w = pos[winnerSide];
        const l = pos[loserSide];
        w.x = lerp(w.x, l.x - 40 * w.dir * -1, easeIn(p));
        l.x = lerp(l.x, loserSide === 'a' ? 60 : 580, easeIn(p));
        if (p > 0.15 && p < 0.9) pos[winnerSide].word = phase.word;
        break;
      }
      case 'corner': {
        pos[loserSide].x = loserSide === 'a' ? 60 : 580;
        pos[loserSide].flash = p > 0.6 ? (p - 0.6) * 2 : 0;
        break;
      }
      case 'tackle': {
        const w = pos[winnerSide];
        w.x = lerp(w.x, pos[loserSide].x - 34 * (winnerSide === 'a' ? -1 : 1), easeOut(Math.min(1, p * 2)));
        if (p > 0.45) { pos[loserSide].flash = 1; pos[winnerSide].word = phase.word; }
        break;
      }
      case 'strike': {
        // In a counter ending the eventual loser swings first.
        const l = pos[loserSide];
        l.x = lerp(l.x, pos[winnerSide].x + (loserSide === 'a' ? -44 : 44), easeOut(p));
        if (p > 0.5) pos[loserSide].word = phase.word;
        break;
      }
      case 'expose': {
        pos[loserSide].flash = 0.4 + 0.6 * Math.abs(Math.sin(p * Math.PI * 3));
        break;
      }
      case 'reversal': {
        const w = pos[winnerSide];
        w.scale = 1 + 0.25 * Math.sin(p * Math.PI);
        pos[loserSide].x += (loserSide === 'a' ? -1 : 1) * easeOut(p) * 90;
        if (p > 0.2) { pos[winnerSide].word = phase.word; pos[loserSide].flash = 1; }
        break;
      }
      case 'overwhelm': {
        if (p > 0.35) { pos[winnerSide].word = phase.word; pos[loserSide].flash = 1; }
        pos[loserSide].x += (loserSide === 'a' ? -1 : 1) * easeOut(p) * 60;
        break;
      }
      case 'flee': {
        pos[loserSide].x += (loserSide === 'a' ? -1 : 1) * easeIn(p) * 260;
        if (p > 0.9) pos[loserSide].off = true;
        if (p > 0.1 && p < 0.8) pos[loserSide].word = phase.word;
        break;
      }
      case 'exchange': {
        if (actor) {
          const other = actor === 'a' ? 'b' : 'a';
          pos[actor].x = lerp(pos[actor].x, pos[other].x + (actor === 'a' ? -46 : 46), easeOut(Math.min(1, p * 1.6)) % 1.2);
          if (p > 0.4 && p < 0.85) { pos[actor].word = phase.word; pos[other].flash = 0.9; }
        }
        break;
      }
      case 'finisher': {
        if (p > 0.4) { pos[winnerSide].word = phase.word; pos[loserSide].flash = 1; }
        pos[loserSide].y = GROUND + easeOut(p) * 26;
        break;
      }
      case 'resolve': {
        pos[winnerSide].scale = 1 + 0.12 * Math.sin(p * Math.PI);
        break;
      }
      default:
        break;
    }
  }
  return pos;
}

function roundedBody(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  // Fallback for canvases without roundRect: plain rect keeps the figure.
  ctx.rect(x, y, w, h);
}

function drawHero(ctx, hero, p, time) {
  if (p.off) return;
  const bob = Math.sin(time / 180 + (p.dir > 0 ? 0 : 2)) * 3;
  ctx.save();
  ctx.translate(p.x, p.y + bob);
  ctx.scale(p.dir * p.scale, p.scale);
  if (p.flash > 0.05) {
    ctx.globalAlpha = Math.min(1, p.flash);
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath();
    ctx.arc(0, -34, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // body
  ctx.fillStyle = hero.color;
  ctx.strokeStyle = '#151515';
  ctx.lineWidth = 4;
  ctx.beginPath();
  roundedBody(ctx, -16, -56, 32, 44, 9);
  ctx.fill();
  ctx.stroke();
  // head
  ctx.beginPath();
  ctx.arc(0, -68, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // eye mask
  ctx.fillStyle = '#151515';
  ctx.fillRect(2, -72, 11, 5);
  // legs
  ctx.beginPath();
  ctx.moveTo(-8, -12); ctx.lineTo(-10, 0);
  ctx.moveTo(8, -12); ctx.lineTo(10, 0);
  ctx.stroke();
  ctx.restore();

  if (p.word) {
    ctx.save();
    ctx.translate(p.x, p.y - 108);
    ctx.rotate(-0.08);
    ctx.font = '900 26px "Arial Black", sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#151515';
    ctx.fillStyle = '#ffd936';
    ctx.strokeText(p.word, -ctx.measureText(p.word).width / 2, 0);
    ctx.fillText(p.word, -ctx.measureText(p.word).width / 2, 0);
    ctx.restore();
  }
}

export default function BattleCanvas({ verdict, heroes, pending }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  // The loop reads through this ref, so a swapped verdict takes effect on the
  // very next frame and the old timeline is dropped, never queued.
  const stateRef = useRef({ verdict: null, pending: true, startedAt: 0, heroes });
  stateRef.current.pending = pending;
  stateRef.current.heroes = heroes;
  if (stateRef.current.verdict?.id !== verdict?.id) {
    stateRef.current.verdict = verdict || null;
    stateRef.current.startedAt = 0; // restart the timeline for the new record
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const rand = mulberry32(20260916);
    const dots = Array.from({ length: 90 }, () => ({ x: rand() * W, y: rand() * H, r: 1 + rand() * 2.4 }));

    const frame = (now) => {
      const { verdict: current, pending: isPending, heroes: cast } = stateRef.current;
      ctx.clearRect(0, 0, W, H);

      // comic backdrop
      ctx.fillStyle = '#f2ead8';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(35,76,159,0.10)';
      for (const d of dots) { ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill(); }
      ctx.strokeStyle = '#151515';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, GROUND + 14);
      ctx.lineTo(W, GROUND + 14);
      ctx.stroke();

      if (isPending || !current) {
        // Neutral idle: parameters changed, server verdict not back yet. The
        // previous conclusion is deliberately NOT shown.
        ctx.fillStyle = '#151515';
        ctx.font = '700 17px sans-serif';
        ctx.textAlign = 'center';
        const dotsCount = 1 + Math.floor((now / 350) % 3);
        ctx.fillText(isPending ? `服务器判定中${'·'.repeat(dotsCount)}` : '调整参数，发起对决', W / 2, 80);
        ctx.textAlign = 'start';
        drawHero(ctx, cast.a, { x: 200, y: GROUND, dir: 1, scale: 1, flash: 0, word: null }, now);
        drawHero(ctx, cast.b, { x: 440, y: GROUND, dir: -1, scale: 1, flash: 0, word: null }, now);
      } else {
        if (!stateRef.current.startedAt) stateRef.current.startedAt = now;
        const t = now - stateRef.current.startedAt;
        const v = current.verdict;
        const total = v.phases[v.phases.length - 1].start + v.phases[v.phases.length - 1].duration;
        const clamped = Math.min(t, total);
        const winnerSide = v.winner === 'draw' ? 'a' : v.winner;
        const positions = heroPositions(v.phases, clamped, winnerSide);
        drawHero(ctx, cast.a, positions.a, now);
        drawHero(ctx, cast.b, positions.b, now);

        if (t >= total) {
          ctx.save();
          ctx.translate(W / 2, 74);
          ctx.rotate(-0.03);
          ctx.font = '900 30px "Arial Black", sans-serif';
          ctx.textAlign = 'center';
          ctx.lineWidth = 8;
          ctx.strokeStyle = '#151515';
          ctx.fillStyle = '#ffd936';
          const label = v.winner === 'draw'
            ? '平局！'
            : `${v.winner === 'a' ? cast.a.name : cast.b.name} · ${v.outcomeLabel}`;
          ctx.strokeText(label, 0, 0);
          ctx.fillText(label, 0, 0);
          ctx.restore();
        }
      }
      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
    // One loop for the component's lifetime; latest state flows via stateRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="battle-canvas"
      style={{ aspectRatio: `${W} / ${H}` }}
      aria-label="战场动画"
    />
  );
}
