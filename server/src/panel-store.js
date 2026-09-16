import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizePoster } from '../../shared/panel-punch-core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../data/panel-punch');
const postersDir = path.join(dataDir, 'posters');
const indexPath = path.join(dataDir, 'index.json');

fs.mkdirSync(postersDir, { recursive: true });

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

let index = readJson(indexPath, { users: {}, posters: [] });
index.users ||= {};
index.posters ||= [];
let queue = Promise.resolve();

function serialize(task) {
  const result = queue.then(task, task);
  queue = result.catch(() => {});
  return result;
}

function publicRecord(record) {
  return {
    id: record.id,
    ownerId: record.ownerId,
    name: record.name,
    width: record.width,
    height: record.height,
    revision: record.revision || 0,
    updatedAt: record.updatedAt,
    createdAt: record.createdAt
  };
}

function posterFile(id) {
  return path.join(postersDir, `${id}.json`);
}

export const panelStore = {
  createGuest() {
    return serialize(() => {
      const id = crypto.randomUUID();
      const user = {
        id,
        displayName: `GUEST ${id.slice(0, 4).toUpperCase()}`,
        createdAt: new Date().toISOString()
      };
      index.users[id] = user;
      atomicWrite(indexPath, index);
      return user;
    });
  },

  getUser(id) {
    return index.users[id] || null;
  },

  list(ownerId) {
    return index.posters
      .filter((poster) => poster.ownerId === ownerId)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  },

  create(ownerId, posterInput) {
    return serialize(() => {
      const now = new Date().toISOString();
      const poster = { ...sanitizePoster({ schema: 'panel-punch/1', ...posterInput }), updatedAt: now };
      const id = crypto.randomUUID();
      const record = {
        id,
        ownerId,
        name: poster.name,
        width: poster.width,
        height: poster.height,
        revision: 1,
        createdAt: now,
        updatedAt: now
      };
      index.posters.push(record);
      atomicWrite(indexPath, index);
      atomicWrite(posterFile(id), { ...record, poster });
      return publicRecord(record);
    });
  },

  load(id, ownerId) {
    const file = readJson(posterFile(id), null);
    if (!file || file.ownerId !== ownerId) return null;
    return file;
  },

  save(id, ownerId, posterInput, expectedRevision) {
    return serialize(() => {
      const existing = this.load(id, ownerId);
      if (!existing) return { missing: true };
      if (Number.isInteger(expectedRevision) && expectedRevision !== existing.revision) {
        return { conflict: true, current: existing.revision, serverPoster: existing.poster };
      }
      const revision = existing.revision + 1;
      const now = new Date().toISOString();
      const poster = { ...sanitizePoster({ schema: 'panel-punch/1', ...posterInput }), updatedAt: now };
      const record = {
        id,
        ownerId,
        name: poster.name,
        width: poster.width,
        height: poster.height,
        revision,
        createdAt: existing.createdAt,
        updatedAt: now
      };
      atomicWrite(posterFile(id), { ...record, poster });
      const indexed = index.posters.find((item) => item.id === id);
      if (indexed) Object.assign(indexed, record);
      else index.posters.push(record);
      atomicWrite(indexPath, index);
      return { ok: true, revision, updatedAt: now, poster };
    });
  }
};
