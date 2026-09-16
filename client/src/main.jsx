import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ensureGuest } from './api.js';
import Editor from './pixel/Editor.jsx';
import './styles.css';

function App() {
  const [userId, setUserId] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState('loading'); // loading | ready | error
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);

  const boot = useCallback(async () => {
    setLoading('loading');
    try {
      const id = await ensureGuest();
      setUserId(id);
      const list = await api.listProjects();
      setProjects(list.projects);
      setLoading('ready');
    } catch (err) {
      setError(err.message || '无法连接到服务。');
      setLoading('error');
    }
  }, []);

  useEffect(() => { boot(); }, [boot]);

  const onCreate = useCallback(async (payload) => {
    const result = await api.createProject(payload);
    setProjects((items) => [result.project, ...items]);
    setOpenId(result.project.id);
  }, []);

  const onDeleteFromList = useCallback((id) => {
    setProjects((items) => items.filter((p) => p.id !== id));
  }, []);

  if (loading === 'loading') {
    return <div className="screen-state"><span className="loader" />正在启动 PixelPulse…</div>;
  }
  if (loading === 'error') {
    return (
      <div className="screen-state">
        <p>{error}</p>
        <button className="btn secondary" onClick={boot}>重试</button>
        <p className="hint">提示：请先在仓库根目录运行 <code>npm run dev</code> 启动 API。</p>
      </div>
    );
  }

  if (openId) {
    return <Editor projectId={openId} userId={userId} onExit={() => { setOpenId(null); boot(); }} />;
  }

  return <Dashboard
    userId={userId}
    projects={projects}
    creating={creating}
    setCreating={setCreating}
    onCreate={onCreate}
    onOpen={setOpenId}
    onDeleted={onDeleteFromList}
  />;
}

function Dashboard({ userId, projects, creating, setCreating, onCreate, onOpen }) {
  return (
    <div className="dashboard">
      <header className="dash-head">
        <div className="brand"><span className="brand-mark">▥</span><strong>PixelPulse</strong><em>像素走路循环编辑器</em></div>
        <div className="dash-user"><code>{userId.slice(0, 8)}</code> · 访客模式</div>
      </header>
      <main className="dash-main">
        <div className="dash-intro">
          <h1>八方向像素角色，<span>逐帧跳动起来。</span></h1>
          <p>放大网格逐帧绘制；洋葱皮、镜像、调色板锁定、帧复制；即时预览与无损 PNG 精灵图导出；增量提交，离线不丢稿。</p>
          <button className="btn primary big" onClick={() => setCreating(true)}>+ 新建走路循环</button>
        </div>
        {projects.length > 0 && (
          <section className="project-grid">
            {projects.map((p) => (
              <button key={p.id} className="project-card" onClick={() => onOpen(p.id)}>
                <strong>{p.name}</strong>
                <span className="meta">{p.width}×{p.height} · {p.frameCount} 帧 · v{p.version}</span>
                <span className="open-hint">打开 →</span>
              </button>
            ))}
          </section>
        )}
        {projects.length === 0 && !creating && (
          <div className="empty-hint">还没有项目。点击「新建走路循环」开始，默认 16×16、八方向、每方向 4 帧循环。</div>
        )}
      </main>
      {creating && <CreateDialog onCreate={onCreate} onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateDialog({ onCreate, onClose }) {
  const [name, setName] = useState('');
  const [size, setSize] = useState(16);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await onCreate({ name: name.trim() || '未命名走路循环', width: size, height: size });
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>新建走路循环</h2>
        <label>名称
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：骑士 · 草地行走" maxLength={80} />
        </label>
        <label>画布尺寸（方形）
          <div className="size-row">
            {[8, 16, 24, 32, 48].map((s) => (
              <button type="button" key={s} className={size === s ? 'chip selected' : 'chip'} onClick={() => setSize(s)}>{s}×{s}</button>
            ))}
          </div>
        </label>
        {err && <p className="form-error">{err}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={busy}>{busy ? '创建中…' : '创建并开始绘制'}</button>
        </div>
      </form>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
