// Hero Duel decision page. The client owns parameter editing and rendering;
// the SERVER owns every verdict. Concurrency rules implemented here:
//   - parameter edits are debounced, then submitted as a new duel record;
//   - each submission carries a monotonically increasing sequence number and
//     its own AbortController — superseded requests are aborted and their
//     late responses discarded, so the UI never shows an expired conclusion;
//   - 429 responses back off for the server-provided retry window (one retry,
//     only if the request is still the latest);
//   - restoring/viewing history marks that setup's signature as "already
//     submitted" so it does not immediately spawn a duplicate record.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Swords } from 'lucide-react';
import HeroPanel from './HeroPanel.jsx';
import RadarChart from './RadarChart.jsx';
import BattleCanvas from './BattleCanvas.jsx';
import VerdictPanel from './VerdictPanel.jsx';
import HistoryPanel from './HistoryPanel.jsx';
import {
  listDuels, listPublicDuels, loadDuel, restoreDuel, setDuelPublic, submitDuel
} from '../api.js';
import { createDuelSetup, sanitizeDuelSetup, DUEL_ARENAS } from '../../../shared/duel-core.js';

const SUBMIT_DEBOUNCE_MS = 600;

function setupSignature(setup) {
  return JSON.stringify(sanitizeDuelSetup(setup));
}

export default function DuelPage({ user, flashError }) {
  const [setup, setSetup] = useState(() => createDuelSetup());
  const [records, setRecords] = useState([]);
  const [publicRecords, setPublicRecords] = useState([]);
  const [activeRecord, setActiveRecord] = useState(null);
  const [pending, setPending] = useState(true);

  const seqRef = useRef(0);
  const abortRef = useRef(null);
  const timerRef = useRef(null);
  const retryTimerRef = useRef(null);
  const submittedSigRef = useRef(null);
  const setupRef = useRef(setup);
  setupRef.current = setup;

  const refreshLists = useCallback(async () => {
    try {
      const [mine, wall] = await Promise.all([listDuels(), listPublicDuels()]);
      setRecords(mine);
      setPublicRecords(wall);
    } catch { /* list refresh is best-effort; the verdict flow reports its own errors */ }
  }, []);

  const runDuel = useCallback(async () => {
    const current = sanitizeDuelSetup(setupRef.current);
    const sig = setupSignature(current);
    if (sig === submittedSigRef.current) return;
    submittedSigRef.current = sig;

    // Supersede any in-flight request: abort it and bump the sequence so its
    // late response (if it somehow arrives) is ignored.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++seqRef.current;
    setPending(true);

    try {
      const { record } = await submitDuel(current, { signal: controller.signal });
      if (seq !== seqRef.current) return; // a newer duel already superseded this one
      setActiveRecord(record);
      setPending(false);
      setRecords((items) => [summarize(record), ...items].slice(0, 60));
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (seq !== seqRef.current) return;
      if (error.status === 429) {
        const wait = Math.min(15_000, Number(error.body?.retryAfterMs) || 3000);
        flashError(error.message);
        // Single delayed retry, only if nothing newer was submitted meanwhile.
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = window.setTimeout(() => {
          if (seq === seqRef.current) {
            submittedSigRef.current = null; // allow re-submit of the same setup
            runDuel();
          }
        }, wait);
        return;
      }
      setPending(false);
      flashError(error.message);
    }
  }, [flashError]);

  // Debounced auto-submit on every parameter change.
  useEffect(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(runDuel, SUBMIT_DEBOUNCE_MS);
    return () => window.clearTimeout(timerRef.current);
  }, [setup, runDuel]);

  // Boot: load history + public wall, then judge the default matchup once.
  useEffect(() => {
    let alive = true;
    (async () => {
      await refreshLists();
      if (alive) runDuel();
    })();
    return () => { alive = false; };
  }, [refreshLists, runDuel]);

  useEffect(() => () => {
    abortRef.current?.abort();
    window.clearTimeout(retryTimerRef.current);
  }, []);

  const patchHero = (side) => (hero) => setSetup((current) => sanitizeDuelSetup({
    ...current,
    [side]: { ...hero, stats: { ...hero.stats } }
  }));

  // Viewing a record loads its setup into the editors WITHOUT re-submitting
  // (its signature is marked as already judged).
  const viewRecord = useCallback(async (id) => {
    try {
      const record = await loadDuel(id);
      const restored = sanitizeDuelSetup(record.setup);
      submittedSigRef.current = setupSignature(restored);
      seqRef.current += 1; // invalidate any in-flight submission
      abortRef.current?.abort();
      setSetup(restored);
      setActiveRecord(record);
      setPending(false);
    } catch (error) {
      flashError(error.message);
    }
  }, [flashError]);

  // Restoring is a server-side, traceable operation: a NEW record is created
  // with `restoredFrom` lineage.
  const restoreRecord = useCallback(async (id) => {
    try {
      const record = await restoreDuel(id);
      const restored = sanitizeDuelSetup(record.setup);
      submittedSigRef.current = setupSignature(restored);
      seqRef.current += 1;
      abortRef.current?.abort();
      setSetup(restored);
      setActiveRecord(record);
      setPending(false);
      setRecords((items) => [summarize(record), ...items].slice(0, 60));
      flashError('已恢复历史局面，并生成带溯源的新记录。');
    } catch (error) {
      flashError(error.message);
    }
  }, [flashError]);

  const togglePublic = useCallback(async (id, isPublic) => {
    try {
      const updated = await setDuelPublic(id, isPublic);
      setRecords((items) => items.map((item) => (item.id === id ? { ...item, isPublic: updated.isPublic } : item)));
      await refreshLists();
    } catch (error) {
      flashError(error.message);
    }
  }, [flashError, refreshLists]);

  const heroes = useMemo(() => ({ a: setup.heroA, b: setup.heroB }), [setup]);

  return (
    <div className="duel-page">
      <section className="duel-config">
        <HeroPanel title="英雄 A" hero={setup.heroA} onChange={patchHero('heroA')} />
        <div className="duel-center">
          <div className="radar-wrap">
            <RadarChart heroA={setup.heroA} heroB={setup.heroB} />
            <div className="radar-legend">
              <span style={{ '--hero-color': setup.heroA.color }}>{setup.heroA.name}</span>
              <span style={{ '--hero-color': setup.heroB.color }}>{setup.heroB.name}</span>
            </div>
          </div>
          <label className="arena-select">
            战场
            <select
              value={setup.arena}
              onChange={(event) => setSetup((current) => sanitizeDuelSetup({ ...current, arena: event.target.value }))}
            >
              {DUEL_ARENAS.map((arena) => <option key={arena.key} value={arena.key}>{arena.label}</option>)}
            </select>
          </label>
          <button className="comic-button wide duel-go" onClick={() => { submittedSigRef.current = null; runDuel(); }}>
            <Swords size={16} />立即判定
          </button>
          <p className="muted tiny">每次修改都会在服务端生成一条可追溯记录；判定结果只来自规则引擎。</p>
        </div>
        <HeroPanel title="英雄 B" hero={setup.heroB} onChange={patchHero('heroB')} />
      </section>

      <section className="duel-stage">
        <BattleCanvas verdict={activeRecord} heroes={heroes} pending={pending} />
        <VerdictPanel record={activeRecord} heroes={heroes} pending={pending} />
      </section>

      <aside className="duel-history">
        <HistoryPanel
          records={records}
          publicRecords={publicRecords}
          activeId={activeRecord?.id}
          userId={user?.id}
          onSelect={viewRecord}
          onRestore={restoreRecord}
          onTogglePublic={togglePublic}
        />
      </aside>
    </div>
  );
}

function summarize(record) {
  return {
    id: record.id,
    ownerId: record.ownerId,
    ownerName: record.ownerName,
    createdAt: record.createdAt,
    restoredFrom: record.restoredFrom || null,
    isPublic: !!record.isPublic,
    heroA: record.setup.heroA.name,
    heroB: record.setup.heroB.name,
    arena: record.setup.arena,
    winner: record.verdict.winner,
    outcome: record.verdict.outcome,
    outcomeLabel: record.verdict.outcomeLabel,
    scores: record.verdict.scores
  };
}
