import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StrokeSampler, simulatePressure, packPoints, unpackPoints, extractBleeds } from '../../client/src/inkdrift/sampler.js';
import { OpLog, opBBox } from '../../client/src/inkdrift/history.js';
import { buildTimeline, progressAt } from '../../client/src/inkdrift/timeline.js';

// ---------- 采样器：点过密抽稀 ----------

test('密集点被抽稀，端点保留', () => {
  const s = new StrokeSampler();
  s.begin(0, 0, 0);
  // 模拟 240Hz 上报：每 4ms 前进 0.5px(远小于 minDist)
  for (let i = 1; i <= 400; i += 1) s.push(i * 0.5, 0, i * 4);
  s.end(200, 0, 1604);
  assert.ok(s.points.length < 400 / 3, `抽稀后点数(${s.points.length})应远小于原始(400)`);
  assert.equal(s.points[0].x, 0);
  assert.ok(s.points.at(-1).x >= 199, '终点必须保留');
});

test('方向突变处保留采样点', () => {
  const s = new StrokeSampler({ minDist: 2 });
  s.begin(0, 0, 0);
  for (let i = 1; i <= 20; i += 1) s.push(i * 3, 0, i * 16);   // 直行
  for (let i = 1; i <= 20; i += 1) s.push(60, i * 3, 320 + i * 16); // 90° 急转
  const xs = s.points.map((p) => p.x);
  const ys = s.points.map((p) => p.y);
  assert.ok(xs.some((x) => x > 55) && ys.some((y) => y > 5), '转角附近应有点被保留');
});

test('触屏无压感时用速度模拟压力：快=轻，慢=重', () => {
  const fast = simulatePressure(3.5, 0);
  const slow = simulatePressure(0.2, 0);
  const dwell = simulatePressure(0.1, 600);
  assert.ok(fast < slow, `快速(${fast})应比慢速(${slow})压力小`);
  assert.ok(dwell > slow, '停顿应增加压力(涨墨)');
});

test('超长笔画有点数硬上限', () => {
  const s = new StrokeSampler({ maxPoints: 100 });
  s.begin(0, 0, 0);
  for (let i = 1; i <= 5000; i += 1) s.push(i * 5, 0, i * 16);
  assert.ok(s.points.length <= 100);
});

test('采样点打包/解包与晕墨提取', () => {
  const pts = [
    { x: 10.123, y: 20.456, p: 0.777, t: 0, dwell: 0 },
    { x: 11, y: 21, p: 0.5, t: 100, dwell: 300 }
  ];
  const packed = packPoints(pts);
  assert.equal(packed[0].length, 4, '无停顿不存第 5 列');
  assert.equal(packed[1].length, 5);
  const unpacked = unpackPoints(packed);
  assert.equal(unpacked[1].dwell, 300);
  const bleeds = extractBleeds(unpacked);
  assert.equal(bleeds.length, 1, '只有停顿点产生晕墨');
  assert.ok(bleeds[0][2] > 10 && bleeds[0][3] > 0.1);
});

// ---------- 操作日志：撤销/重做 ----------

const stroke = (id) => ({ id, kind: 'stroke', pts: [[0, 0, 1, 0], [10, 10, 1, 50]], style: { size: 10 } });

test('undo/redo 作为追加操作生效', () => {
  const log = new OpLog();
  log.append(stroke('a'));
  log.append(stroke('b'));
  assert.equal(log.effectiveOps().length, 2);

  const undo = log.createUndo();
  assert.equal(undo.target, 'b', '撤销最近一笔');
  log.append(undo);
  assert.deepEqual(log.effectiveOps().map((o) => o.id), ['a']);

  // 撤销后再画一笔：日志继续追加，无分支冲突
  log.append(stroke('c'));
  assert.deepEqual(log.effectiveOps().map((o) => o.id), ['a', 'c']);

  const redo = log.createRedo();
  assert.equal(redo.target, 'b', '仍可重做被撤销的 b');
  log.append(redo);
  assert.deepEqual(log.effectiveOps().map((o) => o.id), ['a', 'b', 'c']);
});

test('远端重复操作按 seq 与 id 去重', () => {
  const log = new OpLog();
  log.append(stroke('a'));
  const added = log.appendRemote([{ ...stroke('a'), seq: 5 }, { ...stroke('x'), seq: 6 }, { ...stroke('x'), seq: 6 }]);
  assert.equal(added, 1, '同 id 与同 seq 都不重复');
  assert.equal(log.version, 6);
});

test('opBBox 覆盖笔锋外扩与晕墨范围', () => {
  const box = opBBox({ kind: 'stroke', style: { size: 10 }, pts: [[100, 100, 1, 0], [200, 150, 1, 50]], bleeds: [[300, 300, 40, 0.3]] });
  assert.ok(box[0] < 100 && box[1] < 100);
  assert.ok(box[2] >= 340 && box[3] >= 340, '包围盒要包含晕墨团');
});

// ---------- 时间轴 ----------

test('时间轴：笔画按录制时间、元素按 appearAt', () => {
  const ops = [
    { id: 's1', kind: 'stroke', t0: 0, dur: 1 },
    { id: 'e1', kind: 'element', el: 'mountain', appearAt: 2, duration: 3 },
    { id: 's2', kind: 'stroke', t0: 0.5, dur: 0.5 }
  ];
  const { items, duration } = buildTimeline(ops);
  assert.equal(duration, 5);
  const el = items.find((i) => i.op.id === 'e1');
  assert.equal(progressAt(el, 2), 0);
  assert.equal(progressAt(el, 3.5), 0.5);
  assert.equal(progressAt(el, 6), 1);
});
