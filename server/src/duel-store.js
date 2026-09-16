// Panel Punch — Hero Duel record store. Records are APPEND-ONLY: every
// parameter change produces a new immutable record, restores create a new
// record pointing at their source, and there is deliberately no update/delete
// path for verdicts. The only mutable field is the owner's `isPublic` flag.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeDuelSetup, DUEL_LIMITS } from '../../shared/duel-core.js';
import { runDuel } from './duel-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../data/duels');
const recordsDir = path.join(dataDir, 'records');
const indexPath = path.join(dataDir, 'index.json');

fs.mkdirSync(recordsDir, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function atomicWrite(file, value) {
  const tmp = path.join(dataDir, `${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

let index = readJson(indexPath, { records: [] });
index.records ||= [];
let queue = Promise.resolve();

function serialize(task) {
  const result = queue.then(task, task);
  queue = result.catch(() => {});
  return result;
}

function recordFile(id) {
  return path.join(recordsDir, `${id}.json`);
}

// Summary shown in history lists and on the public wall. The public summary
// exposes the verdict (that is the point of publishing) but never the owner's
// private draft records.
function summary(record) {
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

function persist(record) {
  atomicWrite(recordFile(record.id), record);
  const entry = summary(record);
  const at = index.records.findIndex((item) => item.id === record.id);
  if (at >= 0) index.records[at] = entry;
  else index.records.push(entry);
  atomicWrite(indexPath, index);
}

export const duelStore = {
  // A fresh duel: sanitize inputs, run the server engine, freeze the record.
  create(owner, setupInput, restoredFrom = null) {
    return serialize(() => {
      const setup = sanitizeDuelSetup(setupInput);
      const verdict = runDuel(setup);
      const record = {
        id: crypto.randomUUID(),
        ownerId: owner.id,
        ownerName: owner.displayName,
        createdAt: new Date().toISOString(),
        restoredFrom,
        isPublic: false,
        setup,
        verdict
      };
      persist(record);
      return record;
    });
  },

  // Restore re-runs nothing: it replays the stored setup through the engine
  // again so the lineage is auditable, and stores it as a NEW record.
  restore(id, owner) {
    return serialize(() => {
      const source = readJson(recordFile(id), null);
      if (!source || source.ownerId !== owner.id) return { missing: true };
      const setup = sanitizeDuelSetup(source.setup);
      const verdict = runDuel(setup);
      const record = {
        id: crypto.randomUUID(),
        ownerId: owner.id,
        ownerName: owner.displayName,
        createdAt: new Date().toISOString(),
        restoredFrom: source.id,
        isPublic: false,
        setup,
        verdict
      };
      persist(record);
      return { record };
    });
  },

  // Owner sees the full record; anyone else only if it was published.
  load(id, userId) {
    const record = readJson(recordFile(id), null);
    if (!record) return null;
    if (record.ownerId !== userId && !record.isPublic) return null;
    return record;
  },

  listOwn(ownerId) {
    return index.records
      .filter((record) => record.ownerId === ownerId)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, DUEL_LIMITS.history);
  },

  listPublic() {
    return index.records
      .filter((record) => record.isPublic)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, DUEL_LIMITS.publicWall);
  },

  // The single mutable operation: the owner — and only the owner — toggles
  // visibility. Verdict, setup and lineage can never be edited afterwards.
  setPublic(id, ownerId, isPublic) {
    return serialize(() => {
      const record = readJson(recordFile(id), null);
      if (!record || record.ownerId !== ownerId) return { missing: true };
      record.isPublic = !!isPublic;
      persist(record);
      return { record: summary(record) };
    });
  }
};
