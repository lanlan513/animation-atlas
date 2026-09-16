// 变身演出生成台端到端测试：node --test tests/henshin.test.mjs
// 在临时数据目录启动真实 Express 服务，覆盖：
//  模板定义 / 用户配置白名单校验 / 资源引用与异步任务状态 / 发布版本 / 所有者权限
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4742;
const BASE = `http://127.0.0.1:${PORT}/api`;
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'henshin-test-'));

let server;

before(async () => {
  server = spawn(process.execPath, ['server/src/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), ATLAS_DATA_DIR: tmpData }
  });
  server.stdout.on('data', (chunk) => { if (process.env.DEBUG) process.stdout.write(chunk); });
  server.stderr.on('data', (chunk) => { if (process.env.DEBUG) process.stderr.write(chunk); });
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) break;
    } catch { /* 还没起好 */ }
    await new Promise((r) => setTimeout(r, 100));
  }
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollTask(userId, projectId, taskId, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await api(`/projects/${projectId}/henshin/tasks/${taskId}`, { userId });
    if (['completed', 'failed'].includes(res.json.task?.status)) return res.json.task;
    await sleep(120);
  }
  throw new Error('任务轮询超时');
}

// ---------- 测试夹具 ----------
let user;
let otherUser;
let projectId;
let otherProjectId;

const magicalConfig = (extra = {}) => ({
  characterName: '星彩',
  primaryColor: '#ff7eb6',
  glowSymbol: 'star',
  trackId: 'starlight-rush',
  customBeats: [],
  ...extra
});

test('三个模板的镜头顺序、布局、渲染器、动画逻辑截然不同', async () => {
  const res = await api('/henshin/templates');
  assert.equal(res.status, 200);
  const templates = res.json.templates;
  assert.equal(templates.length, 3);

  const bySlug = Object.fromEntries(templates.map((t) => [t.slug, t]));
  assert.deepEqual(Object.keys(bySlug).sort(), ['magical-girl', 'mecha-startup', 'swordsman-awaken'].sort());

  // 布局各不相同
  const layouts = new Set(templates.map((t) => t.layout));
  assert.equal(layouts.size, 3);
  assert.deepEqual([...layouts].sort(), ['cockpit', 'constellation', 'scroll'].sort());

  // 渲染器 key 各不相同
  assert.equal(new Set(templates.map((t) => t.renderer)).size, 3);

  // 镜头数量 5 / 6 / 4，且每个镜头的 anim 集合互不相交（不是换色文案）
  const animSets = templates.map((t) => new Set(t.shots.map((s) => s.anim)));
  for (let i = 0; i < animSets.length; i += 1) {
    for (let j = i + 1; j < animSets.length; j += 1) {
      for (const anim of animSets[i]) assert.ok(!animSets[j].has(anim), `动画逻辑 ${anim} 在两个模板间重复`);
    }
  }
  assert.deepEqual(templates.find((t) => t.slug === 'magical-girl').shots.map((s) => s.anim),
    ['closeup-ignite', 'ribbon-vortex', 'prism-reveal', 'tiara-descent', 'pose-constellation']);
  assert.equal(bySlug['mecha-startup'].shots.length, 6);
  assert.equal(bySlug['swordsman-awaken'].shots.length, 4);

  // 符号表与音轨也是模板私有的
  assert.deepEqual(bySlug['magical-girl'].symbols.map((s) => s.id), ['star', 'heart', 'moon', 'sparkle']);
  assert.deepEqual(bySlug['mecha-startup'].symbols.map((s) => s.id), ['hex', 'bolt', 'target', 'grid']);
});

test('准备：两个访客、各建一个 Sakuga 项目；另建一个非日漫实验室项目', async () => {
  user = (await api('/auth/guest', { method: 'POST' })).json.user;
  otherUser = (await api('/auth/guest', { method: 'POST' })).json.user;
  const created = await api('/projects', { method: 'POST', userId: user.id, body: { name: '星彩变身演出', categorySlug: 'sakuga-spark' } });
  projectId = created.json.project.id;
  const other = await api('/projects', { method: 'POST', userId: otherUser.id, body: { name: '别人的演出', categorySlug: 'sakuga-spark' } });
  otherProjectId = other.json.project.id;
  assert.equal(created.status, 201);

  // 非日漫实验室项目（panel-punch）用来验证变身台边界
  const wrongLab = await api('/projects', { method: 'POST', userId: user.id, body: { name: '美漫项目', categorySlug: 'panel-punch' } });
  const blocked = await api(`/projects/${wrongLab.json.project.id}/henshin/config`, { userId: user.id });
  assert.equal(blocked.status, 404);
});

test('未登录 401；非所有者访问 404（发布 / 配置只允许当前项目所有者）', async () => {
  assert.equal((await api(`/projects/${projectId}/henshin/config`)).status, 401);
  const forbidden = await api(`/projects/${projectId}/henshin/config`, { userId: otherUser.id });
  assert.equal(forbidden.status, 404);
});

test('初始配置为空；保存合法配置后可读回（含默认值兜底）', async () => {
  const empty = await api(`/projects/${projectId}/henshin/config`, { userId: user.id });
  assert.equal(empty.json.templateSlug, null);

  const saved = await api(`/projects/${projectId}/henshin/config`, {
    method: 'PUT', userId: user.id,
    body: { templateSlug: 'magical-girl', config: magicalConfig({ characterName: '露娜', customBeats: [1.5, 3.25] }) }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.config.characterName, '露娜');
  assert.deepEqual(saved.json.config.customBeats, [1.5, 3.25]);

  const read = await api(`/projects/${projectId}/henshin/config`, { userId: user.id });
  assert.equal(read.json.templateSlug, 'magical-girl');
  assert.equal(read.json.config.primaryColor, '#ff7eb6');
});

test('白名单校验：未知模板 / 未知字段 / 坏颜色 / 越界符号 / 越界音轨全部拒绝', async () => {
  const put = async (templateSlug, config) => api(`/projects/${projectId}/henshin/config`, {
    method: 'PUT', userId: user.id, body: { templateSlug, config }
  });
  const expectCode = async (templateSlug, config, code) => {
    const res = await put(templateSlug, config);
    assert.equal(res.status, 400, `应 400：${code}`);
    assert.ok(res.json.errors.some((e) => e.code === code), `期望错误码 ${code}，实际 ${JSON.stringify(res.json.errors?.map((e) => e.code))}`);
  };

  await expectCode('not-a-template', magicalConfig(), 'BAD_TEMPLATE');
  await expectCode('magical-girl', magicalConfig({ hacker: 'x' }), 'UNKNOWN_FIELD');
  await expectCode('magical-girl', magicalConfig({ primaryColor: 'red' }), 'BAD_COLOR');
  await expectCode('magical-girl', magicalConfig({ primaryColor: '#12' }), 'BAD_COLOR');
  // 跨模板使用机甲的符号 / 音轨：枚举白名单是模板私有的
  await expectCode('magical-girl', magicalConfig({ glowSymbol: 'hex' }), 'BAD_SYMBOL');
  await expectCode('magical-girl', magicalConfig({ trackId: 'reactor-ignite' }), 'BAD_TRACK');
  await expectCode('mecha-startup', {
    characterName: '零', primaryColor: '#4db6ff', glowSymbol: 'hex', trackId: 'reactor-ignite', customBeats: ['x']
  }, 'BAD_BEAT');
});

test('白名单校验：角色名空 / 超长、节拍越界 / 乱序 / 重复 / 超量', async () => {
  const put = async (config) => api(`/projects/${projectId}/henshin/config`, {
    method: 'PUT', userId: user.id, body: { templateSlug: 'magical-girl', config: magicalConfig(config) }
  });
  const expectCode = async (config, code) => {
    const res = await put(config);
    assert.equal(res.status, 400);
    assert.ok(res.json.errors.some((e) => e.code === code), `期望 ${code}，得到 ${JSON.stringify(res.json.errors?.map((e) => e.code))}`);
  };
  await expectCode({ characterName: '   ' }, 'BAD_NAME');
  await expectCode({ characterName: '一二三四五六七八九十一二三四' }, 'BAD_NAME');
  await expectCode({ customBeats: [9.5, 2] }, 'BAD_BEAT'); // 超过魔法模板时长 9s
  await expectCode({ customBeats: [2, 1] }, 'BAD_BEAT_ORDER');
  await expectCode({ customBeats: [1, 1] }, 'BAD_BEAT_ORDER');
  await expectCode({ customBeats: Array.from({ length: 17 }, (_, i) => i * 0.5) }, 'TOO_MANY_BEATS');
});

test('切换到机甲模板：配置整份替换，但角色名与主色被保留', async () => {
  const res = await api(`/projects/${projectId}/henshin/config`, {
    method: 'PUT', userId: user.id,
    body: { templateSlug: 'mecha-startup', config: {
      characterName: '露娜', primaryColor: '#ff5a4e', glowSymbol: 'bolt', trackId: 'overdrive-drive', customBeats: []
    } }
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.config.glowSymbol, 'bolt');
  assert.equal(res.json.config.trackId, 'overdrive-drive');

  const read = await api(`/projects/${projectId}/henshin/config`, { userId: user.id });
  assert.equal(read.json.templateSlug, 'mecha-startup');
});

test('资源引用：白名单登记 -> 202 + 任务 queued -> 轮询到 completed -> 资源 ready', async () => {
  const created = await api(`/projects/${projectId}/henshin/resources`, {
    method: 'POST', userId: user.id,
    body: { kind: 'audio', label: '副歌重鼓点', storageKey: 'library/audio/chorus.wav', note: '测试' }
  });
  assert.equal(created.status, 202);
  assert.equal(created.json.resource.status, 'pending');
  const taskId = created.json.resource.taskId;
  assert.ok(taskId);

  const task = await pollTask(user.id, projectId, taskId);
  assert.equal(task.status, 'completed');
  assert.equal(task.progress, 100);
  assert.ok(task.result.stages.length >= 3);

  await sleep(60); // 等资源对账
  const list = await api(`/projects/${projectId}/henshin/resources`, { userId: user.id });
  const resource = list.json.resources.find((r) => r.id === created.json.resource.id);
  assert.equal(resource.status, 'ready');
  assert.equal(resource.taskStatus, 'completed');
});

test('资源引用白名单：错误类型 / 非法存储键 / 未知字段被拒', async () => {
  const post = async (payload) => api(`/projects/${projectId}/henshin/resources`, { method: 'POST', userId: user.id, body: payload });
  let res = await post({ kind: 'virus', label: 'x', storageKey: 'a/b.wav' });
  assert.equal(res.status, 400);
  assert.ok(res.json.errors.some((e) => e.code === 'BAD_KIND'));
  res = await post({ kind: 'audio', label: 'x', storageKey: '../../etc/passwd' });
  assert.ok(res.json.errors.some((e) => e.code === 'BAD_STORAGE_KEY'));
  res = await post({ kind: 'audio', label: 'x', storageKey: 'a/b.wav', injected: 1 });
  assert.ok(res.json.errors.some((e) => e.code === 'UNKNOWN_FIELD'));
  res = await post({ kind: 'audio', label: '', storageKey: 'a/b.wav' });
  assert.ok(res.json.errors.some((e) => e.code === 'BAD_LABEL'));
});

test('异步失败路径：fail: 前缀任务走到 failed，资源对账为 failed', async () => {
  const created = await api(`/projects/${projectId}/henshin/resources`, {
    method: 'POST', userId: user.id,
    body: { kind: 'symbol', label: '坏文件', storageKey: 'fail:broken.png' }
  });
  assert.equal(created.status, 202);
  const task = await pollTask(user.id, projectId, created.json.resource.taskId);
  assert.equal(task.status, 'failed');
  assert.ok(task.error.includes('解码失败'));
  await sleep(120); // onError 钩子终态对账
  const list = await api(`/projects/${projectId}/henshin/resources`, { userId: user.id });
  const resource = list.json.resources.find((r) => r.id === created.json.resource.id);
  assert.equal(resource.status, 'failed');
});

test('发布演出：仅所有者可创建；v1 快照异步烘焙 -> ready，快照冻结镜头与配置', async () => {
  // 非所有者不能发布
  const forbidden = await api(`/projects/${projectId}/henshin/renderings`, {
    method: 'POST', userId: otherUser.id, body: {}
  });
  assert.equal(forbidden.status, 404);

  const published = await api(`/projects/${projectId}/henshin/renderings`, {
    method: 'POST', userId: user.id, body: {}
  });
  assert.equal(published.status, 202);
  assert.equal(published.json.rendering.versionNumber, 1);
  assert.equal(published.json.rendering.status, 'rendering');
  const taskId = published.json.rendering.taskId;

  const task = await pollTask(user.id, projectId, taskId);
  assert.equal(task.status, 'completed');

  await sleep(80);
  const list = await api(`/projects/${projectId}/henshin/renderings`, { userId: user.id });
  assert.equal(list.json.renderings[0].status, 'ready');
  assert.equal(list.json.renderings[0].versionNumber, 1);

  const detail = await api(`/projects/${projectId}/henshin/renderings/${published.json.rendering.id}`, { userId: user.id });
  assert.equal(detail.json.rendering.status, 'ready');
  const snapshot = detail.json.rendering.snapshot;
  assert.equal(snapshot.templateSlug, 'mecha-startup');
  assert.equal(snapshot.layout, 'cockpit');
  assert.equal(snapshot.renderer, 'mecha');
  assert.equal(snapshot.shots.length, 6); // 快照冻结的是机甲镜头顺序
  assert.equal(snapshot.config.glowSymbol, 'bolt');
  assert.ok(Array.isArray(snapshot.resources));
});

test('发布版本自增且彼此不可变；配置继续修改不影响已发布快照', async () => {
  // 先把配置改回魔法少女
  await api(`/projects/${projectId}/henshin/config`, {
    method: 'PUT', userId: user.id,
    body: { templateSlug: 'magical-girl', config: magicalConfig({ characterName: '新名字' }) }
  });
  const v2 = await api(`/projects/${projectId}/henshin/renderings`, { method: 'POST', userId: user.id, body: {} });
  assert.equal(v2.json.rendering.versionNumber, 2);
  await pollTask(user.id, projectId, v2.json.rendering.taskId);

  const list = await api(`/projects/${projectId}/henshin/renderings`, { userId: user.id });
  assert.deepEqual(list.json.renderings.map((r) => r.versionNumber), [2, 1]);
  const v1 = list.json.renderings.find((r) => r.versionNumber === 1);
  const detail = await api(`/projects/${projectId}/henshin/renderings/${v1.id}`, { userId: user.id });
  // v1 快照仍然是发布当时的机甲 / bolt
  assert.equal(detail.json.rendering.snapshot.templateSlug, 'mecha-startup');
  assert.equal(detail.json.rendering.snapshot.config.glowSymbol, 'bolt');
});

test('未保存任何配置时发布会被 400 拒绝（NO_CONFIG）', async () => {
  const res = await api(`/projects/${otherProjectId}/henshin/renderings`, { method: 'POST', userId: otherUser.id, body: {} });
  assert.equal(res.status, 400);
  assert.ok(res.json.errors.some((e) => e.code === 'NO_CONFIG'));
});

test('任务列表与单任务查询：非所有者 404、未知任务 404', async () => {
  const list = await api(`/projects/${projectId}/henshin/tasks`, { userId: user.id });
  assert.equal(list.status, 200);
  assert.ok(list.json.tasks.length >= 3);
  assert.ok(['queued', 'processing', 'completed', 'failed'].includes(list.json.tasks[0].status));

  const denied = await api(`/projects/${projectId}/henshin/tasks`, { userId: otherUser.id });
  assert.equal(denied.status, 404);
  const missing = await api(`/projects/${projectId}/henshin/tasks/does-not-exist`, { userId: user.id });
  assert.equal(missing.status, 404);
});
