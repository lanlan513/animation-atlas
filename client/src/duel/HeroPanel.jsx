// One hero's parameter panel: name, color and the five duel stats. Edits only
// change local state — the parent debounces and asks the SERVER for a verdict.

import { DUEL_STATS, DUEL_LIMITS } from '../../../shared/duel-core.js';

export default function HeroPanel({ title, hero, onChange }) {
  const patch = (key, value) => onChange({ ...hero, stats: { ...hero.stats, [key]: value } });

  return (
    <section className="hero-panel" style={{ '--hero-color': hero.color }}>
      <header>
        <span className="hero-chip">{title}</span>
        <input
          className="hero-name"
          value={hero.name}
          maxLength={DUEL_LIMITS.heroName}
          onChange={(event) => onChange({ ...hero, name: event.target.value })}
          aria-label={`${title}名称`}
        />
        <input
          type="color"
          value={hero.color}
          onChange={(event) => onChange({ ...hero, color: event.target.value })}
          aria-label={`${title}代表色`}
        />
      </header>
      {DUEL_STATS.map((stat) => (
        <label key={stat.key} className="stat-row">
          <span className="stat-label" title={stat.hint}>{stat.label}</span>
          <input
            type="range"
            min={DUEL_LIMITS.stat[0]}
            max={DUEL_LIMITS.stat[1]}
            value={hero.stats[stat.key]}
            onChange={(event) => patch(stat.key, Number(event.target.value))}
          />
          <output>{hero.stats[stat.key]}</output>
        </label>
      ))}
    </section>
  );
}
