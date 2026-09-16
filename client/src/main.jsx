import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, Check, CircleAlert, Clock3, Cloud, Command, Film, LoaderCircle, Plus, RefreshCw, Save, Sparkles, Upload, UserRound, Wand2, X } from 'lucide-react';
import DesignerShell from './designer/DesignerShell.jsx';
import HenshinStudio from './henshin/HenshinStudio.jsx';
import './styles.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const labFallback = [
  { slug: 'sakuga-spark', name: 'Sakuga Spark', kind: '日漫', description: '高能关键帧与冲击节奏实验。', accent: '#f2674a', glyph: '✦' },
  { slug: 'panel-punch', name: 'Panel Punch', kind: '美漫', description: '漫画节奏、强切与图形转场实验。', accent: '#f4b942', glyph: '▦' },
  { slug: 'frame-mold', name: 'FrameMold', kind: '定格动画', description: '一帧一帧建立形状语言。', accent: '#8bd5ca', glyph: '◈' },
  { slug: 'pixelpulse', name: 'PixelPulse', kind: '像素动画', description: '微小像素、强烈节拍与清晰循环。', accent: '#74a9ff', glyph: '▥' },
  { slug: 'inkdrift', name: 'InkDrift', kind: '水墨动画', description: '像呼吸一样流动的有机线条。', accent: '#c69cff', glyph: '〰' },
  { slug: 'motion-rift', name: 'Motion Rift', kind: '实验动画', description: '拉伸、拖影与姿态之间的空间弯折。', accent: '#ff7eb6', glyph: '◒' }
];

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || '请求失败，请稍后重试。');
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function App() {
  const [user, setUser] = useState(null);
  const [labs, setLabs] = useState(labFallback);
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({ nodes: [], settings: {} });
  const [loadState, setLoadState] = useState('loading');
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('idle');
  const [showCreate, setShowCreate] = useState(false);
  const [createLab, setCreateLab] = useState(null);
  const [showAccount, setShowAccount] = useState(false);
  // Sakuga Spark 项目进入后先到工具枢纽：battle（战斗镜头设计器）/ henshin（变身演出生成台）
  const [tool, setTool] = useState(null); // null | 'hub' | 'battle' | 'henshin'

  const run = useCallback(async (fn) => { setError(''); try { return await fn(); } catch (err) { setError(err.message); throw err; } }, []);

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      let stored = localStorage.getItem('animation-atlas-user');
      let current;
      if (stored) { current = JSON.parse(stored); await request('/auth/me', { headers: { 'x-user-id': current.id } }); }
      else { const result = await request('/auth/guest', { method: 'POST' }); current = result.user; localStorage.setItem('animation-atlas-user', JSON.stringify(current)); }
      setUser(current);
      const [categoryResult, projectResult] = await Promise.all([request('/categories'), request('/projects', { headers: { 'x-user-id': current.id } })]);
      setLabs(categoryResult.categories); setProjects(projectResult.projects); setLoadState('ready');
    } catch (err) {
      localStorage.removeItem('animation-atlas-user');
      setError(err.message); setLoadState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const chooseProject = useCallback(async (project) => {
    setSelected(project); setSaveState('idle');
    if (project.categorySlug === 'sakuga-spark') {
      // 日漫实验室：先在枢纽里选择战斗镜头设计器或变身演出生成台
      setTool('hub');
      return;
    }
    setTool(null);
    try { const result = await run(() => request(`/projects/${project.id}`, { headers: { 'x-user-id': user.id } })); setDraft(result.project.draft?.content || { nodes: [], settings: {} }); }
    catch { setDraft({ nodes: [], settings: {} }); }
  }, [run, user]);

  const exitTool = useCallback(() => { setTool(null); setSelected(null); }, []);

  const createProject = async ({ name, categorySlug }) => {
    const result = await run(() => request('/projects', { method: 'POST', headers: { 'x-user-id': user.id }, body: JSON.stringify({ name, categorySlug }) }));
    setProjects((items) => [result.project, ...items]); setShowCreate(false); setCreateLab(null); chooseProject(result.project);
  };

  const autosaveTimer = useRef(null);
  const updateDraft = (next) => {
    setDraft(next); setSaveState('saving'); clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      if (!selected) return;
      try { const result = await request(`/projects/${selected.id}/drafts`, { method: 'PUT', headers: { 'x-user-id': user.id }, body: JSON.stringify({ content: next }) }); setSaveState('saved'); setProjects((items) => items.map((p) => p.id === selected.id ? { ...p, updatedAt: result.updatedAt, draftRevision: result.revision } : p)); }
      catch (err) { setError(err.message); setSaveState('error'); }
    }, 700);
  };

  const activeLab = useMemo(() => labs.find((lab) => lab.slug === selected?.categorySlug), [labs, selected]);

  if (loadState === 'loading') return <div className="screen-state"><LoaderCircle className="spin" size={26} /><span>正在连接 Atlas…</span></div>;
  if (loadState === 'error') return <div className="screen-state"><CircleAlert size={26} /><span>加载失败</span><button className="button ghost" onClick={load}><RefreshCw size={15} />重试</button></div>;
  if (tool === 'battle' && selected) {
    return <DesignerShell project={selected} user={user} api={request} onError={setError} onExit={exitTool} />;
  }
  if (tool === 'henshin' && selected) {
    return <HenshinStudio project={selected} user={user} api={request} onError={setError} onExit={exitTool} />;
  }
  if (tool === 'hub' && selected) {
    return (
      <SakugaHub
        project={selected}
        onPickBattle={() => setTool('battle')}
        onPickHenshin={() => setTool('henshin')}
        onBack={exitTool}
      />
    );
  }
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark"><Sparkles size={17} /></div><span>ANIMATION ATLAS</span><em>LAB / 01</em></div><div className="top-actions"><span className="system-status"><span className="status-dot" />系统在线</span><button className="icon-button" title="快捷键"><Command size={17} /></button><button className="profile" onClick={() => setShowAccount(true)}><span className="avatar"><UserRound size={15} /></span>{user?.displayName}<span className="chevron">⌄</span></button></div></header>
    <main className="content"><section className="intro"><div><p className="eyebrow">OPEN WORKSPACE / 2026</p><h1>动画实验，<span>从一帧开始。</span></h1><p className="lede">六个专注的实验室入口。把灵感变成可以反复推敲的运动。</p></div><button className="button primary" onClick={() => { setCreateLab(null); setShowCreate(true); }}><Plus size={17} />新建项目</button></section>
      <section className="lab-grid">{labs.map((lab, index) => <article className="lab-card" key={lab.slug} style={{ '--accent': lab.accent }}><div className="lab-topline"><span className="lab-number">0{index + 1}</span><span className="lab-kind">{lab.kind}</span></div><div className="lab-glyph">{lab.glyph}</div><div className="lab-copy"><h2>{lab.name}</h2><p>{lab.description}</p></div><button className="card-arrow" title={`从 ${lab.name} / ${lab.kind} 创建项目`} onClick={() => { setShowCreate(true); setCreateLab(lab.slug); }}><ArrowUpRight size={18} /></button></article>)}</section>
      <section className="workspace-section"><div className="section-heading"><div><p className="eyebrow">YOUR PROJECTS / {projects.length.toString().padStart(2, '0')}</p><h2>最近的工作</h2></div><span className="section-meta"><Clock3 size={14} />自动保存已开启</span></div>{projects.length === 0 ? <div className="empty-projects"><div className="empty-icon"><Film size={22} /></div><div><h3>你的工作区还很安静</h3><p>选一个实验室，建立第一个可持续迭代的项目。</p></div><button className="button secondary" onClick={() => { setCreateLab(null); setShowCreate(true); }}><Plus size={16} />开始创作</button></div> : <div className="project-list">{projects.map((project) => <button className={`project-row ${selected?.id === project.id ? 'active' : ''}`} key={project.id} onClick={() => chooseProject(project)}><span className="project-accent" style={{ background: project.accent }} /><span className="project-icon" style={{ color: project.accent }}>{project.glyph}</span><span className="project-details"><strong>{project.name}</strong><small>{project.categoryName} · {project.categoryKind || '实验室'} · {project.draftRevision ? `Draft ${String(project.draftRevision).padStart(2, '0')}` : 'Draft'}</small></span><span className="project-time">{formatDate(project.updatedAt)}</span><ArrowUpRight size={16} /></button>)}</div>}</section>
      {selected && <section className="workspace"><div className="workspace-head"><div><p className="eyebrow">WORKSPACE / {activeLab?.name?.toUpperCase()}</p><h2>{selected.name}</h2><span className="workspace-kind">{activeLab?.kind}</span></div><SaveStatus state={saveState} /></div><div className="canvas-shell"><div className="canvas-toolbar"><span className="tool-label"><span className="tool-mark" style={{ background: activeLab?.accent }} />空白容器</span><span className="tool-note">可插拔工作区 · 即将支持画布、时间轴与节点</span><button className="icon-button" title="上传资源" onClick={() => setError('资源上传 API 已就绪，具体编辑器接入后可从这里导入。')}><Upload size={16} /></button></div><div className="canvas-placeholder"><div className="placeholder-cross"><span /><span /></div><div className="placeholder-copy"><h3>Workspace ready</h3><p>这是 {activeLab?.name} / {activeLab?.kind} 的可插拔工作区。</p><small>先记录想法，下一步再把工具接进来。</small></div><textarea aria-label="实验笔记" value={draft.settings?.note || ''} onChange={(event) => updateDraft({ ...draft, settings: { ...draft.settings, note: event.target.value } })} placeholder="写下一句实验笔记…" /></div></div></section>}
    </main><footer><span>ATLAS ENGINE v0.1</span><span>本地草稿 · 私有项目</span><span>API / READY</span></footer>{error && <div className="toast error"><CircleAlert size={17} /><span>{error}</span><button onClick={() => setError('')}><X size={16} /></button></div>}{showCreate && <CreateModal labs={labs} initialLab={createLab} onClose={() => { setShowCreate(false); setCreateLab(null); }} onCreate={createProject} />}{showAccount && <AccountModal user={user} onClose={() => setShowAccount(false)} />}</div>;
}

function SaveStatus({ state }) { const map = { idle: ['编辑后自动保存', <Cloud size={15} />], saving: ['正在保存…', <LoaderCircle className="spin" size={15} />], saved: ['已保存', <Check size={15} />], error: ['保存失败', <CircleAlert size={15} />] }; const [text, icon] = map[state] || map.idle; return <span className={`save-status ${state}`}>{icon}{text}</span>; }
function formatDate(value) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }); }
function CreateModal({ labs, initialLab, onClose, onCreate }) { const [name, setName] = useState(''); const [categorySlug, setCategorySlug] = useState(initialLab || labs[0]?.slug); const [busy, setBusy] = useState(false); const submit = async (event) => { event.preventDefault(); if (!name.trim()) return; setBusy(true); try { await onCreate({ name, categorySlug }); } finally { setBusy(false); } }; return <div className="modal-backdrop"><form className="modal" onSubmit={submit}><div className="modal-head"><div><p className="eyebrow">NEW PROJECT / 01</p><h2>建立一个实验</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div><label>项目名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：跳跃的第 12 帧" /></label><label>选择实验室<div className="lab-select">{labs.map((lab) => <button type="button" className={categorySlug === lab.slug ? 'selected' : ''} key={lab.slug} onClick={() => setCategorySlug(lab.slug)}><span className="lab-option-glyph" style={{ color: lab.accent }}>{lab.glyph}</span><span className="lab-option-copy"><strong>{lab.name}</strong><small>{lab.kind}</small></span></button>)}</div></label><div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={busy || !name.trim()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}创建项目</button></div></form></div>; }
function AccountModal({ user, onClose }) { return <div className="modal-backdrop"><div className="modal account-modal"><div className="modal-head"><div><p className="eyebrow">IDENTITY / LOCAL</p><h2>你的 Atlas 身份</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="identity-card"><div className="big-avatar"><UserRound size={24} /></div><div><strong>{user.displayName}</strong><p>{user.isGuest ? '匿名访客 · 数据保存在当前设备' : user.email}</p></div><span className="identity-badge">GUEST</span></div><p className="modal-note">现在可以直接开始创作。注册能力已经留在 API 边界中，接入账号系统后可继续同步你的项目。</p><button className="button secondary full" onClick={onClose}>知道了</button></div></div>; }

// Sakuga Spark / 日漫实验室的工具枢纽：同一项目下两条完全独立的生产线
function SakugaHub({ project, onPickBattle, onPickHenshin, onBack }) {
  return (
    <div className="sakuga-hub">
      <header className="hub-bar">
        <button className="button ghost small" onClick={onBack}>← 项目列表</button>
        <div>
          <p className="eyebrow">SAKUGA SPARK / 日漫实验室</p>
          <h2>{project.name}</h2>
        </div>
        <span className="hub-glyph">✦</span>
      </header>
      <div className="hub-choice">
        <button className="tool-entry battle" onClick={onPickBattle}>
          <span className="tool-entry-glyph"><Film size={26} /></span>
          <span className="tool-entry-copy">
            <p className="eyebrow">TOOL / 01</p>
            <h3>高燃战斗镜头设计器</h3>
            <p>十秒固定片段、五层素材库、五种镜头行为（推 / 摇 / 震 / 闪 / 定格），Worker 烤帧 601 帧 O(1) 查表。</p>
            <small>关键帧时间轴 · 乐观锁 · SVG 素材</small>
          </span>
          <ArrowUpRight size={18} />
        </button>
        <button className="tool-entry henshin" onClick={onPickHenshin}>
          <span className="tool-entry-glyph"><Wand2 size={26} /></span>
          <span className="tool-entry-copy">
            <p className="eyebrow">TOOL / 02</p>
            <h3>变身演出生成台</h3>
            <p>魔法少女 / 机甲启动 / 剑士觉醒三套模板，镜头顺序、页面布局与 Canvas 粒子动画逻辑完全不同；替换角色名、主色、光效符号与音轨节拍即可发布。</p>
            <small>Canvas 粒子遮罩 · 异步资源任务 · 不可变发布版本</small>
          </span>
          <ArrowUpRight size={18} />
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
