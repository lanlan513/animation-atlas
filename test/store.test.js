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

// Track every timer so debounced auto-flushes from one test cannot leak into
// the next (tests share the fake server + module state).
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
const activeTimers = new Set();
globalThis.setTimeout = (fn, ms, ...args) => {
  const id = realSetTimeout(() => { activeTimers.delete(id); fn(); }, ms, ...args);
  activeTimers.add(id);
  return id;
};
globalThis.clearTimeout = (id) => { activeTimers.delete(id); realClearTimeout(id); };
globalThis.setInterval = setInterval;
function clearAllTimers() { for (const id of activeTimers) realClearTimeout(id); activeTimers.clear(); }

let passed = 0;
const failures = [];
// Tests share module-level state (the `server`/`offline` bindings the fetch
// shim closes over), so they must run strictly sequentially: queue them.
const testQueue = [];
let testRunning = false;
function test(name, fn) {
  testQueue.push({ name, fn });
  if (!testRunning) { testRunning = true; drainQueue(); }
}
async function drainQueue() {
  while (testQueue.length) {
    const { name, fn } = testQueue.shift();
    clearAllTimers();
    storage.clear();
    offline = false;
    try {
      await Promise.race([
        Promise.resolve().then(fn),
        new Promise((_, reject) => realSetTimeout(() => reject(new Error('test timed out (possible flush deadlock)')), 3000))
      ]);
      passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failures.push(name);
      console.error(`  ✗ ${name}\n    ${e.stack.split('\n').slice(0, 4).join('\n    ')}`);
      process.exitCode = 1;
    } finally {
      clearAllTimers();
      offline = false;
    }
  }
  testRunning = false;
}

// ---- fake server: reuses the real shared op semantics + in-memory log ----
const {
  createProject, makeIdFactory, clientNumFromId, applyOps, cloneModel,
  buildPalDeleteOp
} = await import('../shared/pixel-core.js');

function createFakeServer(id) {
  const projectId = id || `proj-${serverCounter++}`;
  const user = '11111111-aaaa-bbbb-cccc-000000000001';
  let model = createProject({
    id: projectId, name: 'S', width: 8, height: 8, now: 't0',
    idFactory: makeIdFactory(clientNumFromId(user))
  });
  let version = 0;
  const log = []; // { seq, clientId, clientSeq, ops }
  const api = {
    user, projectId,
    get model() { return model; },
    get version() { return version; },
    snapshot() { return { state: cloneModel(model), version }; },
    // handle a fetch call; returns {status, body}
    handle(method, path, body) {
      if (method === 'GET' && path === `/projects/${projectId}`) {
        return { status: 200, body: { state: cloneModel(model), version, project: { id: projectId } } };
      }
      if (method === 'GET' && path.startsWith(`/projects/${projectId}/sync`)) {
        return { status: 200, body: { state: cloneModel(model), version, commits: log.map((c) => ({ ...c })) } };
      }
      if (method === 'POST' && path === `/projects/${projectId}/commits`) {
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
  servers.set(projectId, api);
  return api;
}

let serverCounter = 1;
const servers = new Map();
// The fetch shim routes to whichever fake server owns the URL's project id;
// each test gets its own project so leftover timers from a previous test can
// never advance the current test's server version.
let activeServer;
let server; // current test's fake server (alias assigned inside each test)
let offline = false;
globalThis.fetch = async (url, options = {}) => {
  if (offline) { await wait(0); throw new TypeError('network down'); }
  const path = url.replace(/^https?:\/\/[^/]+\/api/, '');
  const body = options.body ? JSON.parse(options.body) : undefined;
  await wait(0);
  const match = path.match(/^\/projects\/([^/?]+)(?:\/|$)/);
  const target = (match && servers.get(match[1])) || activeServer;
  const result = target.handle(methodOf(options.method), path, body);
  return { status: result.status, ok: result.status >= 200 && result.status < 300, json: async () => clone(result.body) };
};
function methodOf(m) { return m || 'GET'; }
function clone(o) { return JSON.parse(JSON.stringify(o)); }

const { PixelStore } = await import('../client/src/pixel/store.js');

function makeStore(serverApi) {
  const s = serverApi || activeServer;
  const snap = s.snapshot();
  return new PixelStore({ model: snap.state, version: snap.version, userId: s.user });
}
const flush = async (store) => { await store.flush(); await new Promise((r) => realSetTimeout(r, 0)); };
const wait = (ms) => new Promise((r) => realSetTimeout(r, ms));
const paint = (store, frame, cells) =>
  store.paintCells(frame, cells.map(([x, y, v]) => [x, y, v]));

console.log('store basics');
test('paint gesture commits sparse op and advances server version', async () => {
  server = activeServer = createFakeServer();
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
  server = activeServer = createFakeServer();
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
  server = activeServer = createFakeServer();
  const store = makeStore();
  const f = store.model.frames[0].id;
  const c0 = store.model.palette[0].id, c1 = store.model.palette[1].id;
  // Open strokes (gestures) before going offline, then finish them while
  // disconnected: endGesture enqueues each sparse op, nothing is uploaded.
  offline = true;
  store.setForceOffline(true);
  store.beginGesture(); paint(store, f, [[0, 0, c0]]); store.endGesture();
  store.beginGesture(); paint(store, f, [[1, 1, c1]]); store.endGesture();
  store.addColor('#abcdef');
  assert.equal(store.syncState, 'offline');
  assert.equal(store.pendingCount, 3);
  const persisted = PixelStore.loadPending(server.projectId);
  assert.ok(persisted && persisted.queue.length === 3, 'pending persisted across reload');
  assert.equal(persisted.baseVersion, 0);

  offline = false;
  store.setForceOffline(false);
  await flush(store);
  assert.equal(store.pendingCount, 0);
  assert.equal(server.version, 1, 'three ops arrive as one batched commit (+1 version)');
  assert.equal(server.model.palette.some((s) => s.color.toLowerCase() === '#abcdef'), true);
  const { unpackPixels } = await import('../shared/pixel-core.js');
  const px = unpackPixels(server.model.frames[0].data, 64);
  assert.equal(px[0], c0, 'first offline stroke landed');
  assert.equal(px[1 * 8 + 1], c1, 'second offline stroke landed');
});

console.log('conflicts');
test('409: server structural change lands first; local paint rebases onto it', async () => {
  server = activeServer = createFakeServer();
  const store = makeStore();
  const f = store.model.frames[0].id, c = store.model.palette[0].id;

  // Concurrent local edit while "offline"...
  offline = true; store.setForceOffline(true);
  store.beginGesture(); paint(store, f, [[2, 2, c]]); store.endGesture();
  assert.equal(store.pendingCount, 1);

  // ...and a remote session adds a frame to the server meanwhile.
  const remoteUser = '22222222-aaaa-bbbb-cccc-000000000002';
  const remoteFrame = 88000001;
  server.handle('POST', `/projects/${server.projectId}/commits`, {
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
  server = activeServer = createFakeServer();
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
  server.handle('POST', `/projects/${server.projectId}/commits`, {
    baseVersion: 0, clientId: remoteUser, clientSeq: 1,
    ops: [{ t: 'frameAdd', frame: { id: remoteFrame2, dir: 'down', data: null }, index: 1 }]
  });
  server.handle('POST', `/projects/${server.projectId}/commits`, {
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
  server = activeServer = createFakeServer();
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
  server.handle('POST', `/projects/${server.projectId}/commits`, {
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

test('recovered local edits are actually re-sent and land on the server (no self-await deadlock)', async () => {
  server = activeServer = createFakeServer();
  const store = makeStore();
  const f = store.model.frames[0].id;
  const c = store.model.palette[2].id;
  const versionBeforeConflict = server.version;

  offline = true; store.setForceOffline(true);
  store.beginGesture();
  paint(store, f, [[4, 4, c], [5, 4, c]]);
  store.endGesture();

  // Server advances while we are offline.
  const remoteUser = '22222222-aaaa-bbbb-cccc-000000000002';
  const remoteFrame = 88000003;
  server.handle('POST', `/projects/${server.projectId}/commits`, {
    baseVersion: 0, clientId: remoteUser, clientSeq: 1,
    ops: [{ t: 'frameAdd', frame: { id: remoteFrame, dir: 'right', data: null }, index: 0 }]
  });
  assert.equal(server.version, versionBeforeConflict + 1);

  offline = false; store.setForceOffline(false);
  // The outer flush must resolve (previously it deadlocked awaiting itself).
  await Promise.race([
    flush(store),
    new Promise((_, reject) => realSetTimeout(() => reject(new Error('flush hung after conflict')), 2000))
  ]);

  assert.equal(store.pendingCount, 0, 'rebased queue drained');
  assert.equal(server.version, 2, 'remote v1 + recovered local v2');
  assert.ok(server.model.frames.some((fr) => fr.id === remoteFrame), 'remote frame present');
  const { unpackPixels } = await import('../shared/pixel-core.js');
  const localFrame = server.model.frames.find((fr) => fr.id === f);
  const px = unpackPixels(localFrame.data, 64);
  assert.equal(px[4 * 8 + 4], c, 'local painted pixel reached the server after recovery');
  assert.equal(px[4 * 8 + 5], c);
  assert.equal(['saved', 'idle'].includes(store.syncState), true, `sync state recovered: ${store.syncState}`);
});

test('undoing a frame delete restores its within-dir position on the server too', async () => {
  server = activeServer = createFakeServer();
  const store = makeStore();
  // down group: A(seed), B ; left group: C, D
  const A = store.model.frames[0].id;
  const B = store.addBlankFrame('down');
  store.paintCells(A, [[0, 0, store.model.palette[0].id]]);
  const C = store.addBlankFrame('left');
  store.paintCells(C, [[2, 0, store.model.palette[1].id]]);
  const D = store.addBlankFrame('left');
  store.paintCells(D, [[3, 0, store.model.palette[2].id]]);
  await flush(store);
  const orderBefore = server.model.frames.map((f) => f.id);
  assert.deepEqual(orderBefore, [A, B, C, D]);

  store.deleteFrame(C);
  await flush(store);
  assert.deepEqual(server.model.frames.map((f) => f.id), [A, B, D], 'delete applied on server');

  store.undo();
  await flush(store);
  assert.deepEqual(
    server.model.frames.map((f) => f.id),
    orderBefore,
    'undo compensation restores C between B and D on the server — export order unchanged'
  );
  const { unpackPixels } = await import('../shared/pixel-core.js');
  const restored = server.model.frames.find((f) => f.id === C);
  const px = unpackPixels(restored.data, 64);
  assert.equal(px[2], store.model.palette[1].id, 'restored frame pixels intact on server');
});

test('a store reopened with a persisted queue auto-uploads without user action', async () => {
  server = activeServer = createFakeServer();
  // Seed a persisted queue by doing work in a first "session", online but
  // never explicitly flushed (simulate reload immediately after edits).
  const first = makeStore();
  first.setForceOffline(true); // keep edits queued, as if closed before flush
  const f = first.model.frames[0].id;
  const c = first.model.palette[0].id;
  first.beginGesture();
  paint(first, f, [[6, 6, c]]);
  first.endGesture();
  assert.equal(first.pendingCount, 1);
  const persisted = PixelStore.loadPending(server.projectId);
  assert.ok(persisted && persisted.queue.length === 1);

  // New "session": constructor hydrates and must schedule an auto flush.
  const snap = server.snapshot();
  const second = new PixelStore({ model: snap.state, version: snap.version, userId: server.user, pending: persisted });
  assert.equal(second.syncState, 'queued', 'reopened queue marked queued');
  // Wait for the debounced auto-flush (FLUSH_DEBOUNCE_MS=600) plus the fetch.
  await new Promise((r) => realSetTimeout(r, 900));
  assert.equal(second.pendingCount, 0, 'reopened queue auto-uploaded');
  assert.equal(server.version, 1, 'server received the recovered commit');
  const { unpackPixels } = await import('../shared/pixel-core.js');
  const px = unpackPixels(server.model.frames[0].data, 64);
  assert.equal(px[6 * 8 + 6], c, 'reopened local paint landed on the server');
  assert.equal(PixelStore.loadPending(server.projectId), null, 'persisted queue cleared after upload');
});

await whenQueueDone();
console.log(`\n${passed} store checks passed.`);
if (failures.length) process.exitCode = 1;

function whenQueueDone() {
  return new Promise((resolve) => {
    const tick = () => { if (!testRunning && testQueue.length === 0) return resolve(); realSetTimeout(tick, 5); };
    tick();
  });
}
