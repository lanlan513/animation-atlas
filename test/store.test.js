// Integration test for client/src/pixel/store.js with a minimal browser shim
// and a controllable fake fetch. Covers undo-as-compensating-commit, offline
// queue persistence, 409 server-first rebase, and replayed catch-up.
//
// Run: node test/store.test.js
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');

// ---- browser shims ----
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k)
};
const listeners = {};
globalThis.window = {
  addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
  removeEventListener: () => {}
};
globalThis.navigator = { onLine: true };
class EventTargetShim {
  constructor() { this._h = []; }
  addEventListener(_t, fn) { this._h.push(fn); }
  removeEventListener(_t, fn) { this._h = this._h.filter((f) => f !== fn); }
  dispatchEvent(e) { this._h.forEach((fn) => fn(e)); }
}
class CustomEventShim { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
globalThis.EventTarget = EventTargetShim;
globalThis.CustomEvent = CustomEventShim;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.stack.split('\n').slice(0, 4).join('\n    ')}`); process.exitCode = 1; }
}

// ---- fake server: reuses the real shared op semantics + in-memory log ----
const {
  createProject, makeIdFactory, clientNumFromId, applyOps, cloneModel,
  buildPalDeleteOp
} = await import('../shared/pixel-core.js');

function createFakeServer() {
  const user = '11111111-aaaa-bbbb-cccc-000000000001';
  let model = createProject({
    id: 'proj-1', name: 'S', width: 8, height: 8, now: 't0',
    idFactory: makeIdFactory(clientNumFromId(user))
  });
  let version = 0;
  const log = []; // { seq, clientId, clientSeq, ops }
  return {
    user,
    get model() { return model; },
    get version() { return version; },
    snapshot() { return { state: cloneModel(model), version }; },
    // handle a fetch call; returns {status, body}
    handle(method, path, body) {
      if (method === 'GET' && path === '/projects/proj-1') {
        return { status: 200, body: { state: cloneModel(model), version, project: { id: 'proj-1' } } };
      }
      if (method === 'GET' && path.startsWith('/projects/proj-1/sync')) {
        return { status: 200, body: { state: cloneModel(model), version, commits: log.map((c) => ({ ...c })) } };
      }
      if (method === 'POST' && path === '/projects/proj-1/commits') {
        const nonce = `${body.clientId}:${body.clientSeq}`;
        const dup = log.find((c) => `${c.clientId}:${c.clientSeq}` === nonce);
        if (dup) return { status: 200, body: { saved: true, version: dup.seq, duplicate: true } };
        if (body.baseVersion !== version) {
          return {
            status: 409,
            body: {
              error: 'conflict', serverVersion: version, resync: false,
              catchUp: log.filter((c) => c.seq > body.baseVersion).map((c) => ({ ...c, ops: c.ops }))
            }
          };
        }
        try { applyOps(model, body.ops); } catch (e) { return { status: 400, body: { error: e.message } }; }
        version += 1;
        log.push({ seq: version, clientId: body.clientId, clientSeq: body.clientSeq, ops: body.ops });
        return { status: 200, body: { saved: true, version } };
      }
      return { status: 404, body: { error: 'not found' } };
    }
  };
}

// Install fetch against a server; `offline` makes fetch network-fail.
let server;
let offline = false;
globalThis.fetch = async (url, options = {}) => {
  if (offline) { await new Promise((r) => setTimeout(r, 0)); throw new TypeError('network down'); }
  const path = url.replace(/^https?:\/\/[^/]+\/api/, '');
  const body = options.body ? JSON.parse(options.body) : undefined;
  const method = options.method || 'GET';
  await new Promise((r) => setTimeout(r, 0));
  const result = server.handle(method, path, body);
  return { status: result.status, json: async () => clone(result.body) };
};
function clone(o) { return JSON.parse(JSON.stringify(o)); }

const { PixelStore } = await import('../client/src/pixel/store.js');

function makeStore() {
  const snap = server.snapshot();
  return new PixelStore({ model: snap.state, version: snap.version, userId: server.user });
}
const flush = async (store) => { await store.flush(); await new Promise((r) => setTimeout(r, 0)); };
const paint = (store, frame, cells) =>
  store.paintCells(frame, cells.map(([x, y, v]) => [x, y, v]));

console.log('store basics');
test('paint gesture commits sparse op and advances server version', async () => {
  server = createFakeServer();
  const store = makeStore();
  const f = store.model.frames[0].id, c = store.model.palette[0].id;
  store.beginGesture();
  paint(store, f, [[0, 0, c], [1, 0, c]]);
  store.endGesture();
  assert.equal(store.pendingCount, 1, 'stroke merged into one queue op');
  assert.equal(store.queue[0].cells.length, 2);
  await flush(store);
  assert.equal(store.pendingCount, 0);
  assert.equal(server.version, 1);
  assert.equal(server.model.frames[0].data !== undefined, true);
});

test('undo is a compensating commit the server converges on, and redo re-applies', async () => {
  server = createFakeServer();
  const store = makeStore();
  const f = store.model.frames[0].id, c = store.model.palette[0].id;
  store.beginGesture(); paint(store, f, [[3, 3, c]]); store.endGesture();
  await flush(store);
  assert.equal(server.version, 1);
  store.undo();
  await flush(store);
  assert.equal(server.version, 2, 'undo became a new commit');
  const { unpackPixels } = await import('../shared/pixel-core.js');
  const px = unpackPixels(server.model.frames[0].data, 64);
  assert.equal(px[3 * 8 + 3], -1, 'pixel undone on server');
  store.redo();
  await flush(store);
  assert.equal(server.version, 3);
  const px2 = unpackPixels(server.model.frames[0].data, 64);
  assert.equal(px2[3 * 8 + 3], c, 'pixel re-applied on server');
});

console.log('offline');
test('offline edits queue in localStorage; reconnect flushes them in order', async () => {
  server = createFakeServer();
  const store = makeStore();
  offline = true;
  store.setForceOffline(true);
  const f = store.model.frames[0].id;
  const c0 = store.model.palette[0].id, c1 = store.model.palette[1].id;
  store.beginGesture(); paint(store, f, [[0, 0, c0]]); store.endGesture();
  store.beginGesture(); paint(store, f, [[1, 1, c1]]); store.endGesture();
  store.addColor('#abcdef');
  assert.equal(store.syncState, 'offline');
  assert.equal(store.pendingCount, 3);
  const persisted = PixelStore.loadPending('proj-1');
  assert.ok(persisted && persisted.queue.length === 3, 'pending persisted across reload');
  assert.equal(persisted.baseVersion, 0);

  offline = false;
  store.setForceOffline(false);
  await flush(store);
  assert.equal(store.pendingCount, 0);
  assert.equal(server.version, 3);
  assert.equal(server.model.palette.some((s) => s.color.toLowerCase() === '#abcdef'), true);
});

console.log('conflicts');
test('409: server structural change lands first; local paint rebases onto it', async () => {
  server = createFakeServer();
  const store = makeStore();
  const f = store.model.frames[0].id, c = store.model.palette[0].id;

  // Concurrent local edit while "offline"...
  offline = true; store.setForceOffline(true);
  store.beginGesture(); paint(store, f, [[2, 2, c]]); store.endGesture();
  assert.equal(store.pendingCount, 1);

  // ...and a remote session adds a frame to the server meanwhile.
  const remoteUser = '22222222-aaaa-bbbb-cccc-000000000002';
  const remoteFrame = 88000001;
  server.handle('POST', '/projects/proj-1/commits', {
    baseVersion: 0, clientId: remoteUser, clientSeq: 1,
    ops: [{ t: 'frameAdd', frame: { id: remoteFrame, dir: 'left', data: null }, index: 0 }]
  });
  assert.equal(server.version, 1);

  offline = false; store.setForceOffline(false);
  await flush(store);
  assert.equal(store.pendingCount, 0, 'rebased op flushed');
  assert.equal(server.version, 2);
  // Both the remote frame and the local paint are present.
  assert.ok(server.model.frames.some((fr) => fr.id === remoteFrame), 'remote frame kept');
  const { unpackPixels } = await import('../shared/pixel-core.js');
  const px = unpackPixels(server.model.frames.find((fr) => fr.id === f).data, 64);
  assert.equal(px[2 * 8 + 2], c, 'local paint applied after rebase');
});

test('409: local paint into a remotely-deleted frame is reported and dropped', async () => {
  server = createFakeServer();
  const store = makeStore();
  const victim = store.model.frames[0].id;

  offline = true; store.setForceOffline(true);
  const survivor = store.nextId();
  // local adds a frame and paints into the old one
  store.commit({ t: 'frameAdd', frame: { id: survivor, dir: 'down', data: null }, index: null });
  store.beginGesture();
  paint(store, victim, [[0, 0, store.model.palette[0].id]]);
  store.endGesture();

  // remote deletes the victim (keeping at least one frame: it doesn't know
  // about the local survivor, so remote first adds a frame then deletes)
  const remoteFrame2 = 88000002;
  const remoteUser = '22222222-aaaa-bbbb-cccc-000000000002';
  server.handle('POST', '/projects/proj-1/commits', {
    baseVersion: 0, clientId: remoteUser, clientSeq: 1,
    ops: [{ t: 'frameAdd', frame: { id: remoteFrame2, dir: 'down', data: null }, index: 1 }]
  });
  server.handle('POST', '/projects/proj-1/commits', {
    baseVersion: 1, clientId: remoteUser, clientSeq: 2,
    ops: [{ t: 'frameDel', frame: victim, index: 0 }]
  });
  assert.equal(server.version, 2);

  offline = false; store.setForceOffline(false);
  await flush(store);
  // The local frameAdd is replayed; the paint into a dead frame is dropped.
  assert.ok(server.model.frames.some((fr) => fr.id === survivor), 'local new frame survived rebase');
  assert.ok(!store.notice.includes('0 个'), 'a human notice mentions the dropped op count');
  assert.match(store.consumeNotice(), /丢弃/);
});

test('palette delete remote + local paint using a still-valid color keeps valid cells', async () => {
  server = createFakeServer();
  const store = makeStore();
  const gone = server.model.palette[3].id;
  const kept = server.model.palette[0].id;
  const f = store.model.frames[0].id;

  offline = true; store.setForceOffline(true);
  // local queued paint references both colors in one op
  store.paintCells(f, [[0, 0, gone], [1, 0, kept]]);
  store.endGesture?.();

  // remote deletes `gone`
  const remoteUser = '22222222-aaaa-bbbb-cccc-000000000002';
  const base = server.snapshot().state;
  server.handle('POST', '/projects/proj-1/commits', {
    baseVersion: 0, clientId: remoteUser, clientSeq: 1,
    ops: [buildPalDeleteOp(base, gone)]
  });

  offline = false; store.setForceOffline(false);
  await flush(store);
  const { unpackPixels } = await import('../shared/pixel-core.js');
  const px = unpackPixels(server.model.frames[0].data, 64);
  assert.equal(px[0], -1, 'deleted-color cell stripped during rebase');
  assert.equal(px[1], kept, 'valid-color cell applied');
});

console.log(`\n${passed} store checks passed.`);
