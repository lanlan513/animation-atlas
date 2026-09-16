// Panel Punch — Hero Duel shared model. Both browser and server import these
// normalizers so a duel setup is clamped identically on the way out and on the
// way in. IMPORTANT: this file contains NO outcome logic. The winner, ending
// type and animation timeline are computed exclusively by the server-side
// rules engine (server/src/duel-engine.js); the client only renders inputs
// (radar chart) and the returned verdict (battle animation + explanation).

import { clamp, sanitizeName, mulberry32 } from './panel-punch-core.js';

export const DUEL_LIMITS = {
  stat: [0, 100],
  heroName: 18,
  history: 60,
  publicWall: 40
};

export const DUEL_STATS = [
  { key: 'power', label: '力量', hint: '近战破坏与抗击打' },
  { key: 'speed', label: '速度', hint: '追逐与闪避节奏' },
  { key: 'gear', label: '装备', hint: '克制弱点与终结手段' },
  { key: 'terrain', label: '场景优势', hint: '主场加成，放大全部属性' },
  { key: 'weakness', label: '弱点', hint: '暴露度越高越容易被反制' }
];

export const DUEL_OUTCOMES = {
  chase: { label: '追逐战', word: 'ZOOM!', desc: '速度差主导，一方被一路追击。' },
  melee: { label: '近战缠斗', word: 'BAM!', desc: '双方站桩换拳，硬实力定胜负。' },
  counter: { label: '弱点反制', word: 'KRAK!', desc: '装备抓住弱点，一击逆转。' },
  retreat: { label: '压制撤退', word: 'RUN!', desc: '差距悬殊，弱势方被迫撤离战场。' }
};

const DEFAULT_HERO_A = {
  name: '赤拳队长',
  color: '#e83f32',
  stats: { power: 78, speed: 46, gear: 52, terrain: 60, weakness: 30 }
};

const DEFAULT_HERO_B = {
  name: '夜翼侠',
  color: '#234c9f',
  stats: { power: 55, speed: 82, gear: 64, terrain: 40, weakness: 44 }
};

function stat(value, fallback) {
  return Math.round(clamp(value, ...DUEL_LIMITS.stat, fallback));
}

function heroColor(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? value : fallback;
}

export function sanitizeHero(input = {}, fallback = DEFAULT_HERO_A) {
  const value = input && typeof input === 'object' ? input : {};
  const stats = value.stats && typeof value.stats === 'object' ? value.stats : {};
  return {
    name: sanitizeName(value.name, DUEL_LIMITS.heroName) || fallback.name,
    color: heroColor(value.color, fallback.color),
    stats: {
      power: stat(stats.power, fallback.stats.power),
      speed: stat(stats.speed, fallback.stats.speed),
      gear: stat(stats.gear, fallback.stats.gear),
      terrain: stat(stats.terrain, fallback.stats.terrain),
      weakness: stat(stats.weakness, fallback.stats.weakness)
    }
  };
}

export function createDuelSetup(overrides = {}) {
  return sanitizeDuelSetup({ schema: 'panel-punch-duel/1', ...overrides });
}

export function sanitizeDuelSetup(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    schema: 'panel-punch-duel/1',
    arena: ['rooftop', 'harbor', 'lab'].includes(value.arena) ? value.arena : 'rooftop',
    heroA: sanitizeHero(value.heroA, DEFAULT_HERO_A),
    heroB: sanitizeHero(value.heroB, DEFAULT_HERO_B)
  };
}

export const DUEL_ARENAS = [
  { key: 'rooftop', label: '午夜天台' },
  { key: 'harbor', label: '暴雨码头' },
  { key: 'lab', label: '失控实验室' }
];

// FNV-1a over the canonical setup JSON. Identical parameters always map to the
// same seed, which makes every server verdict reproducible and auditable.
export function duelSeed(setup) {
  const clean = sanitizeDuelSetup(setup);
  const text = JSON.stringify(clean);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) || 1;
}

export function duelRandom(seed) {
  return mulberry32(seed);
}
