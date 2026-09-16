// 服务端端到端测试：node --test tests/api.test.mjs
// 会在临时数据目录启动一个真实的 Express 服务（见 ATLAS_DATA_DIR / PORT）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4731;
const BASE = `http://127.0.0.1:${PORT}/api`;
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-'));

let server;

before(async () => {
  server = spawn(process.execPath, ['server/src/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), ATLAS_DATA_DIR: tmpData }
  });
  server.stdout.on('data', (chunk) => { if (process.env.DEBUG) process.stdout.write(chunk); });
  server.stderr.on('data', (chunk) => { if (process.env.DEBUG) process.stderr.write(chunk); });
  // 等待健康检查通过
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch { /* 还没起好 */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('测试服务启动超时');
});

after(() => {
  server.kill();
  fs.rmSync(tmpData, { recursive: true, force: true });
});

async function api(url, { method = 'GET', userId, body } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const validClip = (extra = {}) => ({
  name: '测试十秒',
  duration: 10,
  layers: [
    { id: 'L-bg', name: '废墟月夜', type: 'background', assetId: 'bg-ruins', keyframes: [
      { id: 'K1', time: 0, easing: 'linear', x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }
    ] },
    { id: 'L-char', name: '居合斩', type: 'character', assetId: 'char-slash', keyframes: [
      { id: 'K2', time: 0, easing: 'linear', x: -0.3, y: 0.18, scale: 1, rotation: 0, opacity: 1 },
      { id: 'K3', time: 1.2, easing: 'easeOut', x: 0.1, y: 0.1, scale: 1.1, rotation: -8, opacity: 1 }
    ] }
  ],
  cameraActions: [
    { id: 'A1', type: 'push', start: 0.5, end: 2.5, params: { zoom: 1.6, x: 0, y: 0 } },
    { id: 'A2', type: 'shake', start: 2.4, end: 3.1, params: { amplitude: 0.08, frequency: 22 } },
    { id: 'A3', type: 'flash', start: 2.9, end: 3.4, params: { intensity: 1 } },
    { id: 'A4', type: 'freeze', start: 3.4, end: 4.4, params: {} }
  ],
  ...extra
});

let user;
let projectId;

test('素材库内置 14 个素材，覆盖四类', async () => {
  const res = await api('/library/assets');
  assert.equal(res.status, 200);
  const types = new Set(res.json.assets.map((a) => a.type));
  assert.deepEqual([...types].sort(), ['background', 'character', 'shockwave', 'speedline'].sort());
  assert.equal(res.json.assets.length, 14);
});

test('访客建项目后初始片段为空且 version=0', async () => {
  user = (await api('/auth/guest', { method: 'POST' })).json.user;
  const created = await api('/projects', { method: 'POST', userId: user.id, body: { name: 'E2E', categorySlug: 'sakuga-spark' } });
  projectId = created.json.project.id;
  assert.equal(created.status, 201);
  const empty = await api(`/projects/${projectId}/clip`, { userId: user.id });
  assert.equal(empty.json.clip, null);
  assert.equal(empty.json.version, 0);
});

test('合法片段保存 v1 -> 旧版本号 409 乐观锁拦截 -> 新版本号 v2', async () => {
  const saved = await api(`/projects/${projectId}/clip`, { method: 'PUT', userId: user.id, body: { expectedVersion: 0, clip: validClip() } });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.version, 1);

  const stale = await api(`/projects/${projectId}/clip`, { method: 'PUT', userId: user.id, body: { expectedVersion: 0, clip: validClip({ name: '旧标签页覆盖' }) } });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, 'VERSION_CONFLICT');
  assert.equal(stale.json.serverVersion, 1);
  assert.equal(stale.json.serverClip.name, '测试十秒');

  const next = await api(`/projects/${projectId}/clip`, { method: 'PUT', userId: user.id, body: { expectedVersion: 1, clip: validClip({ name: '第二版' }) } });
  assert.equal(next.json.version, 2);
});

test('服务端校验：非法时间范围 / 越界 / 重复关键帧', async () => {
  const cases = [
    ['end<=start', { cameraActions: [{ id: 'X', type: 'pan', start: 5, end: 4.9, params: { x: 0.5, y: 0 } }] }, 'BAD_RANGE'],
    ['超出10秒', { cameraActions: [{ id: 'X', type: 'pan', start: 9, end: 11, params: { x: 0.5, y: 0 } }] }, 'BAD_TIME'],
    ['同类镜头重叠', { cameraActions: [
      { id: 'p1', type: 'push', start: 0, end: 2, params: { zoom: 1.4 } },
      { id: 'p2', type: 'push', start: 1, end: 3, params: { zoom: 1.2 } }
    ] }, 'OVERLAP_ACTION']
  ];
  for (const [label, patch, code] of cases) {
    const res = await api(`/projects/${projectId}/clip`, { method: 'PUT', userId: user.id, body: { expectedVersion: 2, clip: validClip(patch) } });
    assert.equal(res.status, 400, label);
    assert.ok(res.json.errors.some((e) => e.code === code), `${label} 应报 ${code}`);
  }

  const dup = await api(`/projects/${projectId}/clip`, { method: 'PUT', userId: user.id, body: { expectedVersion: 2, clip: validClip({ layers: [
    { id: 'L', name: 'x', type: 'character', assetId: 'char-punch', keyframes: [
      { id: 'a', time: 1, easing: 'linear' }, { id: 'b', time: 1, easing: 'linear' }
    ] }
  ] }) } });
  assert.equal(dup.status, 400);
  assert.ok(dup.json.errors.some((e) => e.code === 'BAD_TIME'));
});

test('服务端校验：缺失素材 / 类型不匹配 / 参数越界 / 时长错误', async () => {
  const missing = await api(`/projects/${projectId}/clip`, { method: 'PUT', userId: user.id, body: { expectedVersion: 2, clip: validClip({ layers: [
    { id: 'L', name: 'x', type: 'character', assetId: 'nope', keyframes: [{ id: 'a', time: 0, easing: 'linear' }] }
  ] }) } });
  assert.ok(missing.json.errors.some((e) => e.code === 'MISSING_ASSET'));

  const mismatch = await api(`/projects/${projectId}/clip`, { method: 'PUT', userId: user.id, body: { expectedVersion: 2, clip: validClip({ layers: [
    { id: 'L', name: 'x', type: 'speedline', assetId: 'char-punch', keyframes: [{ id: 'a', time: 0, easing: 'linear' }] }
  ] }) } });
  assert.ok(mismatch.json.errors.some((e) => e.code === 'ASSET_TYPE_MISMATCH'));

  const badParam = await api(`/projects/${projectId}/clip`, { method: 'PUT', userId: user.id, body: { expectedVersion: 2, clip: validClip({ cameraActions: [{ id: 'X', type: 'shake', start: 0, end: 1, params: { amplitude: 9 } }] }) } });
  assert.ok(badParam.json.errors.some((e) => e.code === 'BAD_RANGE'));

  const badDuration = await api(`/projects/${projectId}/clip`, { method: 'PUT', userId: user.id, body: { expectedVersion: 2, clip: validClip({ duration: 12 }) } });
  assert.ok(badDuration.json.errors.some((e) => e.code === 'BAD_DURATION'));
});

test('服务端校验：过大的动作配置被拒绝', async () => {
  const res = await api(`/projects/${projectId}/clip`, { method: 'PUT', userId: user.id, body: { expectedVersion: 2, clip: validClip({
    cameraActions: [{ id: 'Z', type: 'push', start: 0, end: 2, params: { zoom: 2, junk: 'x'.repeat(3000) } }]
  }) } });
  assert.equal(res.status, 400);
  assert.ok(res.json.errors.some((e) => e.code === 'UNKNOWN_FIELD' || e.code === 'CONFIG_TOO_LARGE'));
});

test('持久化读回与越权访问', async () => {
  const read = await api(`/projects/${projectId}/clip`, { userId: user.id });
  assert.equal(read.json.clip.name, '第二版');
  assert.equal(read.json.clip.layers.length, 2);
  assert.equal(read.json.clip.cameraActions.length, 4);
  assert.equal(read.json.version, 2);

  const other = (await api('/auth/guest', { method: 'POST' })).json.user;
  const forbidden = await api(`/projects/${projectId}/clip`, { userId: other.id });
  assert.equal(forbidden.status, 404);
});

test('未登录请求被 401 拦截', async () => {
  const res = await api(`/projects/${projectId}/clip`);
  assert.equal(res.status, 401);
  void once;
});
