// Panel Punch — Hero Duel rules engine. SERVER ONLY: the client never imports
// this module. Every verdict is a pure function of the sanitized setup, so any
// historical record can be re-audited by re-running the engine on its inputs.

import { sanitizeDuelSetup, duelSeed, duelRandom, DUEL_OUTCOMES } from '../../shared/duel-core.js';

const ENGINE_VERSION = 'duel-engine/1';

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Terrain advantage amplifies every attribute by up to +40%.
function effectiveStats(hero) {
  const amp = 1 + (hero.stats.terrain / 100) * 0.4;
  return {
    power: round1(hero.stats.power * amp),
    speed: round1(hero.stats.speed * amp),
    gear: round1(hero.stats.gear * amp),
    amp: round1(amp * 100) / 100
  };
}

function offenseScore(eff, hero, opponent) {
  // Gear converts the opponent's weakness exposure into piercing damage.
  const exploit = (opponent.stats.weakness / 100) * eff.gear * 0.3;
  return {
    exploit: round1(exploit),
    total: round1(eff.power * 0.4 + eff.gear * 0.3 + eff.speed * 0.2 + exploit)
  };
}

function defenseScore(eff, hero) {
  return round1(eff.power * 0.3 + eff.speed * 0.25 + eff.gear * 0.15 + (100 - hero.stats.weakness) * 0.2);
}

// Net-score differences are squashed onto a bounded 0–100 scale so that only
// genuinely stacked matchups reach the "overwhelming" retreat band.
const RETREAT_MARGIN = 70;

function toScores(netA, netB) {
  const diff = netA - netB;
  const scoreA = round1(50 + 50 * Math.tanh(diff / 100));
  return { scoreA, scoreB: round1(100 - scoreA) };
}

function buildPhases(outcome, winner, loser, rand, margin) {
  const beats = [];
  const push = (name, actor, duration, extra = {}) =>
    beats.push({ name, actor, duration: Math.round(duration), ...extra });

  push('approach', 'both', 900);
  if (outcome === 'chase') {
    push('sprint', winner, 1400, { word: 'ZOOM!' });
    push('corner', loser, 800);
    push('tackle', winner, 700, { word: 'WHAM!' });
  } else if (outcome === 'counter') {
    push('strike', loser, 800, { word: 'BAM!' });
    push('expose', winner, 700);
    push('reversal', winner, 900, { word: 'KRAK!' });
  } else if (outcome === 'retreat') {
    push('overwhelm', winner, 1100, { word: 'KRAKOOM!' });
    push('flee', loser, 1300, { word: 'RUN!' });
  } else {
    const exchanges = 2 + Math.min(3, Math.floor(rand() * 2 + margin / 18));
    for (let i = 0; i < exchanges; i += 1) {
      push('exchange', i % 2 === 0 ? winner : loser, 620, { word: i % 2 === 0 ? 'BAM!' : 'POW!' });
    }
    push('finisher', winner, 850, { word: 'KAPOW!' });
  }
  push('resolve', winner, 1000);

  let t = 0;
  return beats.map((beat) => {
    const start = t;
    t += beat.duration;
    return { ...beat, start };
  });
}

export function runDuel(rawSetup) {
  const setup = sanitizeDuelSetup(rawSetup);
  const seed = duelSeed(setup);
  const rand = duelRandom(seed);
  const steps = [];

  const effA = effectiveStats(setup.heroA);
  const effB = effectiveStats(setup.heroB);
  steps.push({
    code: 'TERRAIN_AMP',
    text: `场景优势转化为全场增益：${setup.heroA.name} ×${effA.amp}，${setup.heroB.name} ×${effB.amp}。`,
    values: { a: effA.amp, b: effB.amp }
  });

  const offA = offenseScore(effA, setup.heroA, setup.heroB);
  const offB = offenseScore(effB, setup.heroB, setup.heroA);
  const defA = defenseScore(effA, setup.heroA);
  const defB = defenseScore(effB, setup.heroB);
  steps.push({
    code: 'OFFENSE',
    text: `攻势 = 力量×0.4 + 装备×0.3 + 速度×0.2 + 弱点穿透：${setup.heroA.name} ${offA.total}（穿透 ${offA.exploit}），${setup.heroB.name} ${offB.total}（穿透 ${offB.exploit}）。`,
    values: { a: offA.total, b: offB.total }
  });
  steps.push({
    code: 'DEFENSE',
    text: `守势 = 力量×0.3 + 速度×0.25 + 装备×0.15 + (100−弱点)×0.2：${setup.heroA.name} ${defA}，${setup.heroB.name} ${defB}。`,
    values: { a: defA, b: defB }
  });

  const netA = round1(offA.total - defB);
  const netB = round1(offB.total - defA);
  const { scoreA, scoreB } = toScores(netA, netB);
  const margin = round1(Math.abs(scoreA - scoreB));
  const winner = margin < 4 ? 'draw' : (scoreA > scoreB ? 'a' : 'b');
  steps.push({
    code: 'NET_SCORE',
    text: `净胜分（tanh 压缩到 0–100）：${setup.heroA.name} ${scoreA} vs ${setup.heroB.name} ${scoreB}（差值 ${margin}）。`,
    values: { a: scoreA, b: scoreB, margin }
  });

  // Ending-type rules, evaluated in priority order. Every rule that fires is
  // recorded so the player can see exactly why this ending was chosen.
  let outcome = 'melee';
  const speedGap = round1(Math.abs(effA.speed - effB.speed));
  const fasterSide = effA.speed >= effB.speed ? 'a' : 'b';
  const loserSide = winner === 'draw' ? fasterSide : (winner === 'a' ? 'b' : 'a');
  const winnerSide = winner === 'draw' ? fasterSide : winner;
  const loserHero = loserSide === 'a' ? setup.heroA : setup.heroB;
  const winnerEff = winnerSide === 'a' ? effA : effB;

  if (margin >= RETREAT_MARGIN) {
    outcome = 'retreat';
    steps.push({
      code: 'RULE_RETREAT',
      text: `净胜分差值 ${margin} ≥ ${RETREAT_MARGIN}，触发「${DUEL_OUTCOMES.retreat.label}」：劣势方被全面压制，只能撤离。`,
      values: { margin }
    });
  } else if (loserHero.stats.weakness >= 55 && winnerEff.gear >= 60) {
    outcome = 'counter';
    steps.push({
      code: 'RULE_COUNTER',
      text: `${loserHero.name} 弱点 ${loserHero.stats.weakness} ≥ 55 且胜方有效装备 ${winnerEff.gear} ≥ 60，触发「${DUEL_OUTCOMES.counter.label}」。`,
      values: { weakness: loserHero.stats.weakness, gear: winnerEff.gear }
    });
  } else if (speedGap >= 25 && (winner === 'draw' || fasterSide === winnerSide)) {
    outcome = 'chase';
    steps.push({
      code: 'RULE_CHASE',
      text: `有效速度差 ${speedGap} ≥ 25 且更快一方占优，触发「${DUEL_OUTCOMES.chase.label}」。`,
      values: { speedGap }
    });
  } else {
    steps.push({
      code: 'RULE_MELEE',
      text: `未触发特殊结局条件，进入「${DUEL_OUTCOMES.melee.label}」：双方正面换拳。`,
      values: {}
    });
  }

  if (winner === 'draw') {
    steps.push({ code: 'DRAW', text: '净胜分差值 < 4，判定为平局，双方各自撤退整备。', values: {} });
  }

  const phases = buildPhases(outcome, winnerSide, loserSide, rand, margin);

  return {
    engine: ENGINE_VERSION,
    seed,
    winner,
    outcome,
    outcomeLabel: DUEL_OUTCOMES[outcome].label,
    outcomeWord: DUEL_OUTCOMES[outcome].word,
    scores: { a: scoreA, b: scoreB },
    margin,
    effective: { a: effA, b: effB },
    steps,
    phases
  };
}
