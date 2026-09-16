import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 独立的临时数据目录，避免污染开发数据
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-'));
process.env.ATLAS_DATA_DIR = tmp;

const { createApp } = await import('../src/app.js');

let server;
let base;
let userId;
let projectId;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  const res = await fetch(`${base}/auth/guest`, { method: 'POST' });
  const body = await res.json();
  userId = body.user.id;
  const proj = await fetch(`${base}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify({ name: '测试长卷', categorySlug: 'inkdrift' })
  }).then((r) => r.json());
  projectId = proj.project.id;
});

after(() => new Promise((r) => server.close(r)));

const api = (p, opts = {}) => fetch(`${base}${p}`, {
  ...opts, headers: { 'Content-Type': 'application/json', 'x-user-id': userId, ...(opts.headers || {}) }
});

const strokeOp = (id, x) => ({
  id, kind: 'stroke', style: { size: 14, tone: 0.85 }, seed: 1,
  pts: [[x, 100, 0.8, 0], [x + 50, 120, 0.6, 80]], bbox: [x - 20, 80, x + 70, 140], t0: 0, dur: 0.5
});

test('健康检查', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
});

test('新画卷版本为 0', async () => {
  const res = await api(`/projects/${projectId}/inkdrift`);
  const body = await res.json();
  assert.equal(body.version, 0);
  assert.deepEqual(body.segments, []);
});

test('追加第一段操作', async () => {
  const res = await api(`/projects/${projectId}/inkdrift/segments`, {
    method: 'POST', body: JSON.stringify({ baseVersion: 0, ops: [strokeOp('s1', 100), strokeOp('s2', 5000)] })
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.version, 2);
  assert.equal(body.appended, 2);
});

test('baseVersion 过期返回 409 与当前版本', async () => {
  const res = await api(`/projects/${projectId}/inkdrift/segments`, {
    method: 'POST', body: JSON.stringify({ baseVersion: 0, ops: [strokeOp('s3', 200)] })
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.currentVersion, 2);
});

test('重复补传同 id 操作是幂等的', async () => {
  const res = await api(`/projects/${projectId}/inkdrift/segments`, {
    method: 'POST', body: JSON.stringify({ baseVersion: 2, ops: [strokeOp('s2', 5000)] })
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.appended, 0);
  assert.equal(body.version, 2);
});

test('undo 操作入段并按版本读取', async () => {
  await api(`/projects/${projectId}/inkdrift/segments`, {
    method: 'POST', body: JSON.stringify({ baseVersion: 2, ops: [{ id: 'u1', kind: 'undo', target: 's2' }] })
  });
  const res = await api(`/projects/${projectId}/inkdrift/ops?after=0`);
  const body = await res.json();
  assert.equal(body.version, 3);
  assert.equal(body.ops.length, 3);
  assert.deepEqual(body.ops.map((o) => o.seq), [1, 2, 3]);
});

test('按 x 范围过滤时全局操作(undo)始终返回', async () => {
  const res = await api(`/projects/${projectId}/inkdrift/ops?after=0&x0=0&x1=1000`);
  const body = await res.json();
  const kinds = body.ops.map((o) => o.id);
  assert.ok(kinds.includes('s1'), '范围内的笔画应返回');
  assert.ok(!kinds.includes('s2'), '范围外的笔画应被过滤');
  assert.ok(kinds.includes('u1'), 'undo 是全局操作，任何视口都要返回');
});

test('after 增量拉取', async () => {
  const res = await api(`/projects/${projectId}/inkdrift/ops?after=2`);
  const body = await res.json();
  assert.equal(body.ops.length, 1);
  assert.equal(body.ops[0].id, 'u1');
});

test('缩略图上传与读取', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  const put = await api(`/projects/${projectId}/inkdrift/thumbnail`, { method: 'PUT', body: JSON.stringify({ dataUrl }) });
  assert.equal(put.status, 200);
  const get = await api(`/projects/${projectId}/inkdrift/thumbnail.png`);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('content-type'), 'image/png');
  const buf = Buffer.from(await get.arrayBuffer());
  assert.ok(buf.equals(png));
});

test('非法缩略图被拒绝', async () => {
  const res = await api(`/projects/${projectId}/inkdrift/thumbnail`, { method: 'PUT', body: JSON.stringify({ dataUrl: 'data:text/html;base64,PGI+' }) });
  assert.equal(res.status, 400);
});

test('草稿与版本快照接口仍然可用', async () => {
  const put = await api(`/projects/${projectId}/drafts`, { method: 'PUT', body: JSON.stringify({ content: { nodes: [], settings: { note: 'hi' } } }) });
  assert.equal(put.status, 200);
  const v = await api(`/projects/${projectId}/versions`, { method: 'POST' });
  assert.equal(v.status, 201);
});
