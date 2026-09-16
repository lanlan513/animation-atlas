// Radar chart of the two heroes' RAW input stats. This is a visualization of
// user parameters only — the duel outcome is computed on the server and never
// derived here.

import { DUEL_STATS } from '../../../shared/duel-core.js';

const SIZE = 260;
const CENTER = SIZE / 2;
const RADIUS = 96;

function axisPoint(index, value) {
  const angle = -Math.PI / 2 + (index / DUEL_STATS.length) * Math.PI * 2;
  const r = (value / 100) * RADIUS;
  return [CENTER + Math.cos(angle) * r, CENTER + Math.sin(angle) * r];
}

function polygon(stats) {
  return DUEL_STATS.map((_, i) => axisPoint(i, stats[DUEL_STATS[i].key]).map((n) => n.toFixed(1)).join(' ')).join(' ');
}

export default function RadarChart({ heroA, heroB }) {
  return (
    <svg className="radar-chart" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="双英雄属性雷达图">
      {[25, 50, 75, 100].map((ring) => (
        <polygon
          key={ring}
          className="radar-ring"
          points={DUEL_STATS.map((_, i) => axisPoint(i, ring).map((n) => n.toFixed(1)).join(' ')).join(' ')}
        />
      ))}
      {DUEL_STATS.map((stat, i) => {
        const [x, y] = axisPoint(i, 100);
        const [lx, ly] = axisPoint(i, 122);
        return (
          <g key={stat.key}>
            <line className="radar-axis" x1={CENTER} y1={CENTER} x2={x} y2={y} />
            <text className="radar-label" x={lx} y={ly} textAnchor="middle" dominantBaseline="middle">{stat.label}</text>
          </g>
        );
      })}
      <polygon className="radar-poly b" points={polygon(heroB.stats)} style={{ '--hero-color': heroB.color }} />
      <polygon className="radar-poly a" points={polygon(heroA.stats)} style={{ '--hero-color': heroA.color }} />
    </svg>
  );
}
