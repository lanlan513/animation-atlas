// Explainable verdict panel: renders the server engine's step-by-step
// judgment log verbatim, plus the final banner. No local recomputation.

import { Gavel, LoaderCircle } from 'lucide-react';
import { DUEL_OUTCOMES } from '../../../shared/duel-core.js';

export default function VerdictPanel({ record, heroes, pending }) {
  if (pending || !record) {
    return (
      <section className="verdict-panel waiting">
        <LoaderCircle className="spin" size={18} />
        <p>{pending ? '规则引擎判定中，旧结论已作废…' : '调整左侧参数后自动发起判定。'}</p>
      </section>
    );
  }

  const { verdict } = record;
  const winnerName = verdict.winner === 'draw'
    ? null
    : (verdict.winner === 'a' ? heroes.a.name : heroes.b.name);

  return (
    <section className="verdict-panel">
      <div className={`verdict-banner outcome-${verdict.outcome}`}>
        <span className="verdict-word">{DUEL_OUTCOMES[verdict.outcome].word}</span>
        <strong>{winnerName ? `${winnerName} 获胜` : '平局'}</strong>
        <span>{verdict.outcomeLabel} · {verdict.scores.a} : {verdict.scores.b}</span>
      </div>
      <p className="verdict-desc">{DUEL_OUTCOMES[verdict.outcome].desc}</p>
      <ol className="verdict-steps">
        {verdict.steps.map((step, index) => (
          <li key={`${step.code}-${index}`}>
            <code>{step.code}</code>
            <span>{step.text}</span>
          </li>
        ))}
      </ol>
      <p className="verdict-meta">
        <Gavel size={13} />
        引擎 {verdict.engine} · seed #{verdict.seed} · 记录 {record.id.slice(0, 8)} · 判定仅在服务端完成
      </p>
    </section>
  );
}
