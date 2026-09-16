// Minimal JSON-file persistence for PixelPulse.
// No native modules: projects live under data/p/<id>.json plus an append-only
// commit log. All writes are serialized through a single promise chain and go
// out atomically (tmp + rename).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { applyOps } from '../../shared/pixel-core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../data');
const projectsDir = path.join(dataDir, 'p');
const indexPath = path.join(dataDir, 'index.json');

fs.mkdirSync(projectsDir, { recursive: true });

const LOG_PRUNE_AT = 500; // compact when a project log exceeds this many commits

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function atomicWrite(file, value) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

let index = readJson(indexPath, { users: [], projects: [] });
const stateCache = new Map(); // projectId -> { state, version }
let chain = Promise.resolve();

function serialize(task) {
  const run = chain.then(task, task);
  chain = run.catch(() => {}); // keep the chain alive after a failure
  return run;
}

function projectPath(id) {
  return path.join(projectsDir, `${id}.json`);
}

function logPath(id) {
  return path.join(projectsDir, `${id}.log`);
}

export const db = {
  // ---------- guests ----------
  createGuest() {
    return serialize(() => {
      const user = { id: crypto.randomUUID(), createdAt: new Date().toISOString() };
      index.users.push(user);
      atomicWrite(indexPath, index);
      return user;
    });
  },

  getUser(id) {
    return index.users.find((user) => user.id === id) || null;
  },

  // ---------- project listing ----------
  listProjects(ownerId) {
    return index.projects
      .filter((project) => project.ownerId === ownerId)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  },

  // ---------- create ----------
  createProject(ownerId, state) {
    return serialize(() => {
      const record = {
        id: state.id,
        name: state.name,
        width: state.width,
        height: state.height,
        ownerId,
        version: 0,
        frameCount: state.frames.length,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt
      };
      index.projects.push(record);
      atomicWrite(indexPath, index);
      atomicWrite(projectPath(state.id), { version: 0, state });
      fs.writeFileSync(logPath(state.id), '');
      stateCache.set(state.id, { state, version: 0 });
      return { ...record };
    });
  },

  // ---------- load ----------
  loadProject(id) {
    const cached = stateCache.get(id);
    if (cached) return cached;
    const file = readJson(projectPath(id), null);
    if (!file) return null;
    stateCache.set(id, file);
    return file;
  },

  getRecord(id) {
    return index.projects.find((project) => project.id === id) || null;
  },

  // ---------- commit log ----------
  readCommits(id, sinceVersion) {
    let text = '';
    try {
      text = fs.readFileSync(logPath(id), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const commits = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const commit = JSON.parse(line);
      if (commit.seq > sinceVersion) commits.push(commit);
    }
    return commits;
  },

  // Returns { ok, version, commit } or { conflict } / { missing }.
  commit(id, { baseVersion, ops, clientId, clientSeq }) {
    return serialize(() => {
      const entry = this.loadProject(id);
      if (!entry) return { missing: true };
      const { state, version } = entry;

      // Idempotent retry: a re-sent (clientId, clientSeq) is acknowledged
      // without applying twice.
      if (clientId && Number.isInteger(clientSeq)) {
        const nonce = `${clientId}:${clientSeq}`;
        const prior = this.readCommits(id, -1).find((commit) => commit.nonce === nonce);
        if (prior) return { ok: true, version: prior.seq, commit: prior, duplicate: true };
      }

      if (baseVersion !== version) {
        let catchUp = [];
        let resync = false;
        try {
          catchUp = this.readCommits(id, baseVersion);
          // If the needed range starts inside a compacted-away window, the
          // client must resync with a full snapshot.
          if (baseVersion > 0 && catchUp.length && catchUp[0].seq !== baseVersion + 1) {
            catchUp = [];
            resync = true;
          }
        } catch {
          resync = true;
        }
        return {
          conflict: true,
          serverVersion: version,
          resync,
          catchUp: resync ? null : catchUp,
          project: resync ? state : null
        };
      }

      const now = new Date().toISOString();
      const commit = {
        seq: version + 1,
        clientId: clientId || null,
        nonce: clientId && Number.isInteger(clientSeq) ? `${clientId}:${clientSeq}` : null,
        ts: now,
        ops
      };

      applyOps(state, ops); // mutates in place

      const nextVersion = version + 1;
      atomicWrite(projectPath(id), { version: nextVersion, state });
      fs.appendFileSync(logPath(id), `${JSON.stringify(commit)}\n`);
      stateCache.set(id, { state, version: nextVersion });

      const record = this.getRecord(id);
      if (record) {
        record.version = nextVersion;
        record.name = state.name;
        record.width = state.width;
        record.height = state.height;
        record.frameCount = state.frames.length;
        record.updatedAt = now;
        atomicWrite(indexPath, index);
      }

      this.maybeCompact(id);
      return { ok: true, version: nextVersion, commit };
    });
  },

  // Fold old commits into the state snapshot so the log cannot grow forever.
  maybeCompact(id) {
    const commits = this.readCommits(id, -1);
    if (commits.length <= LOG_PRUNE_AT) return;
    const keepFrom = commits[Math.floor(commits.length / 2)].seq;
    const kept = commits.filter((commit) => commit.seq >= keepFrom);
    const tmp = `${logPath(id)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, kept.map((commit) => JSON.stringify(commit)).join('\n') + (kept.length ? '\n' : ''));
    fs.renameSync(tmp, logPath(id));
  }
};
