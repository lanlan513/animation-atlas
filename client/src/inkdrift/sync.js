// 同步客户端：
// - 本地操作先进入待提交队列(IndexedDB 持久化，刷新/断网不丢)
// - 队列按"段"批量 POST，携带 baseVersion；版本冲突(409)时先拉远端操作重基再重试
// - 网络恢复(online 事件/退避重试)后自动补传未提交内容
// - 空闲时上传视口缩略图，供列表页与超长画卷快速预览

const SEGMENT_SIZE = 120;

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('no idb'));
    const req = indexedDB.open('inkdrift-outbox', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('queue');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class SyncClient {
  constructor({ apiBase, projectId, userId, onRemoteOps, onStatus }) {
    this.api = apiBase;
    this.projectId = projectId;
    this.userId = userId;
    this.onRemoteOps = onRemoteOps || (() => {});
    this.onStatus = onStatus || (() => {});
    this.version = 0;        // 已确认的服务端版本
    this.queue = [];         // 待提交操作
    this.flushing = false;
    this.timer = null;
    this.retryDelay = 800;
    this.online = typeof navigator === 'undefined' ? true : navigator.onLine;
    this.destroyed = false;
    this._onlineHandler = () => { this.online = true; this.flush(); };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this._onlineHandler);
      window.addEventListener('offline', () => { this.online = false; this.emitStatus(); });
    }
  }

  headers() { return { 'Content-Type': 'application/json', 'x-user-id': this.userId }; }

  emitStatus(extra = '') {
    const state = !this.online ? 'offline' : this.queue.length > 0 ? 'pending' : 'synced';
    this.onStatus({ state, pending: this.queue.length, version: this.version, extra });
  }

  async init() {
    try {
      this.db = await openDB();
      const saved = await this.idbGet(`q:${this.projectId}`);
      if (saved?.queue?.length) {
        this.queue = saved.queue;
        this.emitStatus('恢复未提交内容');
      }
    } catch { this.db = null; }
    this.emitStatus();
  }

  idbGet(key) {
    return new Promise((resolve) => {
      const tx = this.db.transaction('queue', 'readonly');
      const req = tx.objectStore('queue').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }

  idbPut(key, value) {
    return new Promise((resolve) => {
      const tx = this.db.transaction('queue', 'readwrite');
      tx.objectStore('queue').put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  }

  persistQueue() {
    if (!this.db) return;
    this.idbPut(`q:${this.projectId}`, { queue: this.queue, savedAt: Date.now() });
  }

  enqueue(op) {
    this.queue.push(op);
    this.persistQueue();
    this.emitStatus();
    clearTimeout(this.timer);
    // 攒一批或停顿 600ms 就提交一段
    this.timer = setTimeout(() => this.flush(), this.queue.length >= SEGMENT_SIZE ? 0 : 600);
  }

  async flush() {
    if (this.flushing || this.queue.length === 0 || this.destroyed) return;
    this.flushing = true;
    while (this.queue.length > 0 && this.online && !this.destroyed) {
      const segment = this.queue.slice(0, SEGMENT_SIZE);
      try {
        const res = await fetch(`${this.api}/projects/${this.projectId}/inkdrift/segments`, {
          method: 'POST', headers: this.headers(),
          body: JSON.stringify({ baseVersion: this.version, ops: segment })
        });
        if (res.status === 409) {
          await this.pull(); // 版本落后：先同步远端再重试
          continue;
        }
        if (!res.ok) throw new Error(`segment ${res.status}`);
        const body = await res.json();
        this.version = body.version;
        this.queue.splice(0, segment.length);
        this.persistQueue();
        this.retryDelay = 800;
        this.emitStatus();
      } catch {
        this.online = typeof navigator === 'undefined' ? false : navigator.onLine;
        this.emitStatus('等待网络，稍后补传');
        this.flushing = false;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), this.retryDelay);
        this.retryDelay = Math.min(15000, this.retryDelay * 2);
        return;
      }
    }
    this.flushing = false;
    this.emitStatus();
  }

  // 拉取远端 after=version 之后的操作(含他人/他端提交)
  async pull() {
    const res = await fetch(`${this.api}/projects/${this.projectId}/inkdrift/ops?after=${this.version}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`pull ${res.status}`);
    const body = await res.json();
    if (body.ops.length) this.onRemoteOps(body.ops);
    this.version = body.version;
    this.emitStatus();
    return body;
  }

  // 超长画卷懒加载：按视口 x 范围拉取该区域的全部历史操作
  async pullRange(x0, x1) {
    const res = await fetch(`${this.api}/projects/${this.projectId}/inkdrift/ops?x0=${Math.floor(x0)}&x1=${Math.ceil(x1)}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`range ${res.status}`);
    const body = await res.json();
    if (body.ops.length) this.onRemoteOps(body.ops);
    return body;
  }

  async fetchMeta() {
    const res = await fetch(`${this.api}/projects/${this.projectId}/inkdrift`, { headers: this.headers() });
    if (!res.ok) throw new Error(`meta ${res.status}`);
    return res.json();
  }

  async uploadThumbnail(dataUrl) {
    try {
      await fetch(`${this.api}/projects/${this.projectId}/inkdrift/thumbnail`, {
        method: 'PUT', headers: this.headers(), body: JSON.stringify({ dataUrl })
      });
    } catch { /* 缩略图失败不影响主流程 */ }
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    if (typeof window !== 'undefined') window.removeEventListener('online', this._onlineHandler);
  }
}
