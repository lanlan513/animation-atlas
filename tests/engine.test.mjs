// 计算引擎单元测试：node --test tests/engine.test.mjs
// 覆盖：缓动、关键帧插值、五种镜头行为、定格冻结、烤帧查表一致性、震屏确定性。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFrame, bakeClip, findFrame, easeValue, hashNoise } from '../client/src/designer/engine.js';

const near = (a, b, eps = 1e-5) => Math.abs(a - b) <= eps;

const clip = {
  name: 't', duration: 10,
  layers: [
    { id: 'bg', type: 'background', assetId: 'bg-void', keyframes: [{ id: 'a', time: 0, easing: 'linear', x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }] },
    { id: 'hero', type: 'character', assetId: 'char-slash', keyframes: [
      { id: 'b', time: 0, easing: 'easeOut', x: -1, y: 0, scale: 1, rotation: 0, opacity: 0 },
      { id: 'c', time: 2, easing: 'linear', x: 1, y: 0, scale: 2, rotation: 90, opacity: 1 }
    ] }
  ],
  cameraActions: [
    { id: 'p', type: 'push', start: 0, end: 2, params: { zoom: 2, x: 0.3, y: 0 } },
    { id: 's', type: 'shake', start: 3, end: 4, params: { amplitude: 0.1, frequency: 20 } },
    { id: 'f', type: 'flash', start: 4, end: 5, params: { intensity: 0.8 } },
    { id: 'z', type: 'freeze', start: 6, end: 7.5, params: {} },
    { id: 'pan', type: 'pan', start: 8, end: 10, params: { x: 1, y: 0 } }
  ]
};

test('缓动函数', () => {
  assert.equal(easeValue(0.5, 'linear'), 0.5);
  assert.equal(easeValue(0.99, 'hold'), 0);
  assert.ok(easeValue(0.25, 'easeIn') < 0.25);
  assert.ok(easeValue(0.25, 'easeOut') > 0.25);
  assert.ok(near(easeValue(0.5, 'easeInOut'), 0.5));
});

test('震屏噪声确定性且有界', () => {
  assert.equal(hashNoise(42), hashNoise(42));
  assert.notEqual(hashNoise(42), hashNoise(43));
  assert.ok(hashNoise(7) >= -1 && hashNoise(7) <= 1);
});

test('关键帧插值', () => {
  const hero = evaluateFrame(clip, 1).layers.find((l) => l.layerId === 'hero');
  const e = easeValue(0.5, 'easeOut');
  assert.ok(near(hero.x, -1 + 2 * e));
  assert.ok(near(hero.scale, 1 + e));
  assert.ok(near(hero.rotation, 90 * e));
  assert.ok(near(hero.opacity, e));
  assert.equal(evaluateFrame(clip, 2.5).layers.find((l) => l.layerId === 'hero').x, 1);
});

test('推镜：推进后保持', () => {
  assert.equal(evaluateFrame(clip, 0).camera.zoom, 1);
  const mid = evaluateFrame(clip, 0.3).camera.zoom;
  assert.ok(mid > 1 && mid < 2);
  const end = evaluateFrame(clip, 2).camera;
  assert.ok(near(end.zoom, 2));
  assert.ok(near(end.panX, 0.3));
});

test('震屏：区间、淡入淡出、可复现', () => {
  assert.deepEqual(evaluateFrame(clip, 2.9).camera.shakeX, 0);
  const a = evaluateFrame(clip, 3.37).camera;
  const b = evaluateFrame(clip, 3.37).camera;
  assert.ok(a.shakeX !== 0 || a.shakeY !== 0);
  assert.ok(near(a.shakeX, b.shakeX) && near(a.shakeY, b.shakeY));
  const amp = (t) => Math.hypot(evaluateFrame(clip, t).camera.shakeX, evaluateFrame(clip, t).camera.shakeY);
  assert.ok(amp(3.05) < amp(3.5));
});

test('闪白：起点立即达峰，随后消退', () => {
  assert.ok(near(evaluateFrame(clip, 4).camera.flash, 0.8, 0.02));
  const mid = evaluateFrame(clip, 4.5).camera.flash;
  assert.ok(mid > 0 && mid < 0.8);
  assert.equal(evaluateFrame(clip, 5.01).camera.flash, 0);
});

test('定格：图层锁定在动作起点姿态，震屏停住', () => {
  const frozen = evaluateFrame(clip, 6.5).camera;
  assert.equal(frozen.frozen, true);
  const a = evaluateFrame(clip, 6.5).layers.find((l) => l.layerId === 'hero');
  const b = evaluateFrame(clip, 6).layers.find((l) => l.layerId === 'hero');
  assert.ok(near(a.x, b.x) && near(a.scale, b.scale));
  assert.equal(frozen.shakeX, 0);
  assert.equal(evaluateFrame(clip, 7.6).camera.frozen, false);
});

test('横摇：从一侧极值匀速摇到另一侧', () => {
  assert.ok(near(evaluateFrame(clip, 8).camera.panX, -1));
  assert.ok(near(evaluateFrame(clip, 9).camera.panX, 0));
  assert.ok(near(evaluateFrame(clip, 10).camera.panX, 1));
});

test('烤帧：601 帧 TypedArray，查表与精确求值一致（含定格采样）', () => {
  const baked = bakeClip(clip);
  assert.equal(baked.count, 601);
  assert.ok(baked.layers[1].columns.x instanceof Float32Array);
  assert.ok(baked.cam.frozen instanceof Uint8Array);
  for (const t of [0, 1, 2.37, 4.5, 6, 6.5, 7.5, 9, 10]) {
    const exact = evaluateFrame(clip, t);
    const fast = findFrame(baked, t);
    const le = exact.layers.find((l) => l.layerId === 'hero');
    const lf = fast.layers.find((l) => l.layerId === 'hero');
    assert.ok(near(le.x, lf.x, 0.02), `t=${t} x`);
    assert.ok(near(exact.camera.zoom, fast.camera.zoom, 0.02), `t=${t} zoom`);
    assert.equal(exact.camera.frozen, fast.camera.frozen, `t=${t} frozen`);
  }
  assert.equal(findFrame(baked, -3).time, 0);
  assert.equal(findFrame(baked, 99).time, 10);
});

test('无关键帧图层回退默认姿态', () => {
  const frame = evaluateFrame({ name: 'x', duration: 10, layers: [{ id: 'l', type: 'speedline', assetId: 'speed-radial', keyframes: [] }], cameraActions: [] }, 3);
  assert.ok(near(frame.layers[0].scale, 1));
  assert.ok(near(frame.layers[0].opacity, 1));
});
