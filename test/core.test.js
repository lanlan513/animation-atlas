// Node test harness for the shared core (no test framework dependency).
// Run: npm test
import assert from 'node:assert/strict';

// shared/pixel-core.js uses btoa/atob; provide Node equivalents.
import { Buffer } from 'node:buffer';
globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');

const {
  createProject, makeIdFactory, clientNumFromId, applyOps, applyOp,
  packPixels, unpackPixels, emptyPixels, TRANSPARENT,
  buildPalDeleteOp, invertOp, cloneModel, getFrame, framesInDir,
  buildFrameDupOp, buildFrameDelOp, buildResizeOp, rebaseQueuedOps,
  rasterLine, mirrorCells, floodFill, DIRECTIONS
} = await import('../shared/pixel-core.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.stack.split('\n').slice(0, 3).join('\n    ')}`); process.exitCode = 1; }
}

const ids = makeIdFactory(7);
function freshProject() {
  return createProject({ id: 'p1', name: '测试角色', width: 8, height: 8, now: '2026-09-16T00:00:00Z', idFactory: ids });
}
function paint(model, frame, x, y, value) {
  applyOp(model, { t: 'paint', frame, cells: [[x, y, value]] });
}

console.log('pack/unpack');
test('Int32 round trip incl. TRANSPARENT and large ids', () => {
  const pixels = emptyPixels(4, 4);
  pixels[0] = 1234567; pixels[5] = -1; pixels[15] = 9000003;
  const back = unpackPixels(packPixels(pixels), 16);
  assert.deepEqual([...back], [...pixels]);
});

console.log('ops');
test('paint writes only referenced cells', () => {
  const m = freshProject();
  const f = m.frames[0].id, c = m.palette[2].id;
  paint(m, f, 1, 1, c);
  const px = unpackPixels(m.frames[0].data, 64);
  assert.equal(px[9], c);
  assert.equal(px[10], TRANSPARENT);
});

test('paint rejects coordinates out of bounds', () => {
  const m = freshProject();
  assert.throws(() => paint(m, m.frames[0].id, 99, 0, m.palette[0].id));
});

test('paint rejects colors not in palette', () => {
  const m = freshProject();
  assert.throws(() => paint(m, m.frames[0].id, 0, 0, 424242));
});

test('frame add / duplicate / delete / move within direction', () => {
  const m = freshProject();
  const f0 = m.frames[0];
  paint(m, f0.id, 0, 0, m.palette[0].id);
  const dupOp = buildFrameDupOp(m, f0.id, { id: ids(), dir: 'down' });
  applyOp(m, dupOp);
  assert.equal(framesInDir(m, 'down').length, 2);
  const f1 = m.frames.find((f) => f.id === dupOp.frame.id);
  assert.equal(unpackPixels(f1.data, 64)[0], m.palette[0].id, 'duplicated pixels copied');

  const blankId = ids();
  applyOp(m, { t: 'frameAdd', frame: { id: blankId, dir: 'down' }, index: 0 });
  assert.equal(framesInDir(m, 'down')[0].id, blankId, 'inserted at index 0');

  applyOp(m, { t: 'frameMove', frame: f1.id, dir: 'down', from: 2, to: 0 });
  assert.equal(framesInDir(m, 'down')[0].id, f1.id);

  const delOp = buildFrameDelOp(m, blankId);
  applyOp(m, delOp);
  assert.equal(framesInDir(m, 'down').length, 2);
});

test('frameDir moves between direction groups and keeps global grouping', () => {
  const m = freshProject();
  const f = m.frames[0];
  const id = ids();
  applyOp(m, { t: 'frameAdd', frame: { id, dir: 'down' } });
  applyOp(m, { t: 'frameDir', frame: id, dir: 'left', oldDir: 'down', oldIndex: 1 });
  const dirs = m.frames.map((x) => x.dir);
  assert.deepEqual(dirs, [...dirs].sort((a, b) => DIRECTIONS.indexOf(a) - DIRECTIONS.indexOf(b)),
    'frames stay grouped by DIRECTIONS order');
  assert.equal(framesInDir(m, 'left')[0].id, id);
});

test('undoing a frame delete restores exact within-dir position, pixel data and export order', () => {
  const m = freshProject();
  const A = m.frames[0];
  const c1 = m.palette[0].id, c2 = m.palette[1].id, c3 = m.palette[2].id;
  paint(m, A.id, 0, 0, c1);
  const B = ids(); applyOp(m, { t: 'frameAdd', frame: { id: B, dir: 'down' } });
  paint(m, B, 1, 0, c1);
  const C = ids(); applyOp(m, { t: 'frameAdd', frame: { id: C, dir: 'left' } });
  paint(m, C, 2, 0, c2);
  const D = ids(); applyOp(m, { t: 'frameAdd', frame: { id: D, dir: 'left' } });
  paint(m, D, 3, 0, c3);

  const original = m.frames.map((f) => f.id);
  assert.deepEqual(original, [A.id, B, C, D]);

  // C is at global index 2 but within-dir ('left') index 0.
  const delC = buildFrameDelOp(m, C);
  assert.equal(delC.index, 0, 'delete op carries the WITHIN-DIR index, not the global one');
  applyOp(m, delC);
  assert.deepEqual(m.frames.map((f) => f.id), [A.id, B, D]);

  applyOp(m, invertOp(delC, m));
  assert.deepEqual(m.frames.map((f) => f.id), original, 'C returns between B and D, not after D');
  const left = framesInDir(m, 'left');
  assert.deepEqual(left.map((f) => f.id), [C, D], 'left-group order restored');
  // Pixel content of the restored frame survives the round trip.
  const px = unpackPixels(m.frames.find((f) => f.id === C).data, 64);
  assert.equal(px[2], c2, 'restored frame keeps its pixels (export order + content)');

  // Deleting and undoing the second frame of a multi-frame group as well.
  const delD = buildFrameDelOp(m, D);
  assert.equal(delD.index, 1, 'D within-dir index is 1');
  assert.equal(delD.index, 1, 'D within-dir index is 1');
  applyOp(m, delD);
  applyOp(m, invertOp(delD, m));
  assert.deepEqual(m.frames.map((f) => f.id), original);
});

console.log('palette cascade');
test('deleting a color clears it from every frame and op captures replacements', () => {
  const m = freshProject();
  const c = m.palette[1].id;
  const f1 = m.frames[0];
  paint(m, f1.id, 2, 2, c);
  const f2id = ids();
  applyOp(m, { t: 'frameAdd', frame: { id: f2id, dir: 'down' } });
  paint(m, f2id, 3, 3, c);

  const op = buildPalDeleteOp(m, c);
  assert.ok(op.replacements[f1.id] && op.replacements[f2id], 'both frames snapshotted');
  applyOp(m, op);
  assert.equal(m.palette.find((s) => s.id === c), undefined);
  for (const f of m.frames) {
    const px = unpackPixels(f.data, 64);
    assert.ok(!px.includes(c));
  }
});

test('undo of palDelete restores color slot AND cleared pixels', () => {
  const m = freshProject();
  const c = m.palette[1].id;
  paint(m, m.frames[0].id, 2, 2, c);
  const before = cloneModel(m);
  const del = buildPalDeleteOp(m, c);
  applyOp(m, del);
  const inverse = invertOp(del, m);
  applyOps(m, inverse.ops);
  assert.ok(m.palette.some((s) => s.id === c), 'slot restored');
  const px = unpackPixels(m.frames[0].data, 64);
  assert.equal(px[18], c, 'pixel restored');
  void before;
});

test('locked-ness is carried by palAdd inverse metadata', () => {
  const m = freshProject();
  const id = ids();
  const add = { t: 'palAdd', slot: { id, color: '#abcdef', locked: true } };
  applyOp(m, add);
  const inv = invertOp(add, m);
  assert.equal(inv.color, '#abcdef');
  assert.equal(inv.locked, true);
});

console.log('inverse round trips');
test('undo/redo op pairs return the model to the same bitmap', () => {
  const m = freshProject();
  const c0 = m.palette[0].id, c1 = m.palette[1].id;
  const f = m.frames[0].id;
  const op1 = { t: 'paint', frame: f, cells: [[0, 0, c0, TRANSPARENT], [1, 0, c1, TRANSPARENT]] };
  applyOp(m, op1);
  const undo1 = invertOp(op1, m);
  const op2 = { t: 'paint', frame: f, cells: [[0, 0, c1, c0]] };
  applyOp(m, op2);
  applyOp(m, invertOp(op2, m));
  applyOp(m, undo1);
  const px = unpackPixels(getFrame(m, f).data, 64);
  assert.deepEqual([px[0], px[1]], [TRANSPARENT, TRANSPARENT]);
});

test('resize keeps top-left content and inverse restores old buffers', () => {
  const m = freshProject();
  const c = m.palette[0].id;
  paint(m, m.frames[0].id, 7, 7, c);
  paint(m, m.frames[0].id, 1, 1, c);
  const op = buildResizeOp(m, 4, 4);
  applyOp(m, op);
  assert.equal(m.width, 4);
  const px = unpackPixels(m.frames[0].data, 16);
  assert.equal(px[5], c, 'inside pixel kept');
  assert.equal(px[15], TRANSPARENT, 'outside pixel discarded');
  const back = invertOp(op, m);
  applyOp(m, back);
  assert.equal(m.width, 8);
  const px2 = unpackPixels(m.frames[0].data, 64);
  assert.equal(px2[63], c, 'old content fully restored');
});

console.log('drawing helpers');
test('rasterLine connects two cells', () => {
  const line = rasterLine(0, 0, 3, 0);
  assert.equal(line.length, 4);
  assert.deepEqual(line[3], [3, 0]);
});
test('mirrorCells produces symmetric cells and dedups axis', () => {
  assert.equal(mirrorCells([0, 0], 4, 4, 'x').length, 2, 'even width: axis is between cells');
  assert.equal(mirrorCells([2, 0], 5, 5, 'x').length, 1, 'odd width: cell on mirror axis collapses');
  assert.equal(mirrorCells([0, 0], 4, 4, 'xy').length, 4);
});
test('floodFill fills only the bounded region', () => {
  const px = emptyPixels(4, 4);
  const c = 99;
  px[5] = c; px[6] = c;
  const cells = floodFill(px, 4, 4, 0, 0, c);
  assert.equal(cells.length, 14, 'fills all TRANSPARENT cells except the two c cells');
  const inside = floodFill(px, 4, 4, 1, 1, 7);
  assert.equal(inside.length, 2, 'seed inside the c island fills those 2 cells');
  const blocked = floodFill(px, 4, 4, 1, 1, c);
  assert.equal(blocked.length, 0, 'target already equals value');
});

console.log('offline rebase');
test('queued paint survives when server only edited unrelated frames', () => {
  const base = freshProject();
  const server = cloneModel(base);
  const otherFrame = ids();
  applyOps(server, [{ t: 'frameAdd', frame: { id: otherFrame, dir: 'down' } }]);
  const serverOps = server.frames.length > base.frames.length
    ? [{ t: 'frameAdd', frame: { id: otherFrame, dir: 'down' }, index: 1 }] : [];
  const queued = [{ t: 'paint', frame: base.frames[0].id, cells: [[0, 0, base.palette[0].id, TRANSPARENT]] }];
  const result = rebaseQueuedOps(server, base, serverOps, queued);
  assert.equal(result.dropped.length, 0);
  assert.equal(result.ops.length, 1);
});

test('queued paint is dropped when its frame was deleted on server', () => {
  const base = freshProject();
  const victim = base.frames[0].id;
  const survivor = ids();
  const server = cloneModel(base);
  applyOps(server, [
    { t: 'frameAdd', frame: { id: survivor, dir: 'down' } },
    { t: 'frameDel', frame: victim, index: 0 }
  ]);
  const serverOps = [
    { t: 'frameAdd', frame: { id: survivor, dir: 'down' }, index: 1 },
    { t: 'frameDel', frame: victim, index: 0 }
  ];
  const queued = [
    { t: 'paint', frame: victim, cells: [[0, 0, base.palette[0].id, TRANSPARENT]] },
    { t: 'paint', frame: survivor, cells: [[1, 1, base.palette[1].id, TRANSPARENT]] }
  ];
  const result = rebaseQueuedOps(server, base, serverOps, queued);
  assert.equal(result.dropped.length, 1);
  assert.equal(result.dropped[0].reason, 'frame-deleted');
  assert.equal(result.ops.length, 1);
  assert.equal(result.ops[0].frame, survivor);
});

test('queued paint cells using a remotely-deleted color are stripped', () => {
  const base = freshProject();
  const gone = base.palette[3].id;
  const kept = base.palette[0].id;
  const server = cloneModel(base);
  applyOps(server, [buildPalDeleteOp(server, gone)]);
  const serverOps = [buildPalDeleteOp(base, gone)];
  const queued = [{
    t: 'paint', frame: base.frames[0].id,
    cells: [[0, 0, gone, TRANSPARENT], [1, 0, kept, TRANSPARENT]]
  }];
  const result = rebaseQueuedOps(server, base, serverOps, queued);
  assert.equal(result.dropped.length, 0, 'op survives with the still-valid cell');
  assert.equal(result.ops[0].cells.length, 1);
  assert.equal(result.ops[0].cells[0][2], kept);
});

test('locally-added frame survives rebase and queued paint onto it lands', () => {
  const base = freshProject();
  const localFrame = ids();
  const server = cloneModel(base);
  const serverFrame = ids();
  applyOps(server, [{ t: 'frameAdd', frame: { id: serverFrame, dir: 'down' } }]);
  const queued = [
    { t: 'frameAdd', frame: { id: localFrame, dir: 'down', data: null }, index: null },
    { t: 'paint', frame: localFrame, cells: [[0, 0, base.palette[0].id, TRANSPARENT]] }
  ];
  const result = rebaseQueuedOps(server, base,
    [{ t: 'frameAdd', frame: { id: serverFrame, dir: 'down' }, index: 1 }], queued);
  assert.equal(result.dropped.length, 0);
  assert.ok(getFrame(result.model, localFrame));
  assert.equal(unpackPixels(getFrame(result.model, localFrame).data, 64)[0], base.palette[0].id);
});

test('queued palDelete regenerates replacements against converged frames', () => {
  const base = freshProject();
  const color = base.palette[2].id;
  const server = cloneModel(base);
  const remoteFrame = ids();
  applyOps(server, [{ t: 'frameAdd', frame: { id: remoteFrame, dir: 'down' } }]);
  applyOp(server, { t: 'paint', frame: remoteFrame, cells: [[0, 0, color, TRANSPARENT]] });
  const queued = [buildPalDeleteOp(base, color)];
  const result = rebaseQueuedOps(server, base, [
    { t: 'frameAdd', frame: { id: remoteFrame, dir: 'down' }, index: 1 },
    { t: 'paint', frame: remoteFrame, cells: [[0, 0, color, TRANSPARENT]] }
  ], queued);
  assert.equal(result.dropped.length, 0);
  assert.ok(result.ops[0].replacements[remoteFrame], 'remote frame referenced in regenerated op');
  const px = unpackPixels(getFrame(result.model, remoteFrame).data, 64);
  assert.equal(px[0], TRANSPARENT, 'remote frame also cleared on replay');
});

console.log(`\n${passed} checks passed.`);
