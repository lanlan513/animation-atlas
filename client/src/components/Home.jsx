import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Clock3, Film, LoaderCircle, Plus, Sparkles, Trash2, Upload, UserRound } from 'lucide-react';
import { api } from '../api.js';
import CreateModal from './CreateModal.jsx';
import AccountModal from './AccountModal.jsx';
import { formatBytes } from '../lib/image.js';

const FALLBACK_LABS = [
  { slug: 'frame-mold', name: 'FrameMold', kind: '定格动画', description: '黏土逐帧拍摄台：摄像头逐帧拍摄，残影校正模型位置。', accent: '#8bd5ca', glyph: '◈' }
];

export default function Home({ user, onOpen, onError }) {
  const [labs, setLabs] = useState(FALLBACK_LABS);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createSlug, setCreateSlug] = useState('frame-mold');
  const [showAccount, setShowAccount] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [categoryResult, projectResult] = await Promise.all([api('/categories'), api('/projects')]);
      setLabs(categoryResult.categories);
      setProjects(projectResult.projects);
    } catch (error) {
      onError(error.message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const createProject = async ({ name, categorySlug, description }) => {
    const result = await api('/projects', { method: 'POST', body: { name, categorySlug, description } });
    setProjects((items) => [result.project, ...items]);
    onOpen(result.project.id);
  };

  const removeProject = async (event, project) => {
    event.stopPropagation();
    if (!confirm(`确定删除「${project.name}」吗？全部帧素材会一起删除，且无法恢复。`)) return;
    try {
      await api(`/projects/${project.id}`, { method: 'DELETE' });
      setProjects((items) => items.filter((item) => item.id !== project.id));
    } catch (error) {
      onError(error.message);
    }
  };

  const frameMold = labs.find((lab) => lab.slug === 'frame-mold') || labs[0];

  return (
    <div className="app-shell">
      <Topbar user={user} onAccount={() => setShowAccount(true)} />
      <main className="content">
        <section className="intro">
          <div>
            <p className="eyebrow">CLAYMATION SHOOT STATION / 2026</p>
            <h1>FrameMold<br /><span>黏土逐帧拍摄台</span></h1>
            <p className="lede">调用摄像头逐帧拍摄，以上一帧残影校正模型位置；时间尺排序、复制、批量调时长，播放成定格短片。重开项目，进度原样还在。</p>
          </div>
          <button className="button primary" onClick={() => { setCreateSlug('frame-mold'); setShowCreate(true); }}>
            <Plus size={17} />新建拍摄项目
          </button>
        </section>

        <section className="lab-grid">
          {labs.map((lab, index) => {
            const isMold = lab.slug === 'frame-mold';
            return (
              <article
                className={`lab-card ${isMold ? 'lab-card-hot' : ''}`}
                key={lab.slug}
                style={{ '--accent': lab.accent }}
              >
                <div className="lab-topline">
                  <span className="lab-number">0{index + 1}</span>
                  <span className="lab-kind">{lab.kind}</span>
                  {isMold && <span className="lab-badge">已就绪</span>}
                </div>
                <div className="lab-glyph">{lab.glyph}</div>
                <div className="lab-copy">
                  <h2>{lab.name}</h2>
                  <p>{lab.description}</p>
                </div>
                {isMold && (
                  <button className="card-arrow" title="进入 FrameMold 拍摄台" onClick={() => { setCreateSlug(lab.slug); setShowCreate(true); }}>
                    <ArrowUpRight size={18} />
                  </button>
                )}
              </article>
            );
          })}
        </section>

        <section className="workspace-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR PROJECTS / {String(projects.length).padStart(2, '0')}</p>
              <h2>最近的拍摄</h2>
            </div>
            <span className="section-meta"><Clock3 size={14} />编辑进度自动保存</span>
          </div>
          {loading ? (
            <div className="empty-projects"><LoaderCircle className="spin" size={20} /><span>正在取回项目…</span></div>
          ) : projects.length === 0 ? (
            <div className="empty-projects">
              <div className="empty-icon"><Film size={22} /></div>
              <div>
                <h3>还没有拍摄项目</h3>
                <p>搭好黏土模型与灯光，从第一帧开始。</p>
              </div>
              <button className="button secondary" onClick={() => { setCreateSlug('frame-mold'); setShowCreate(true); }}>
                <Plus size={16} />开始拍摄
              </button>
            </div>
          ) : (
            <div className="project-list">
              {projects.map((project) => (
                <button className="project-row" key={project.id} onClick={() => onOpen(project.id)}>
                  <span className="project-accent" style={{ background: project.accent || frameMold?.accent }} />
                  <span className="project-thumb">
                    {project.frameCount > 0 ? <Film size={16} /> : <Upload size={15} />}
                  </span>
                  <span className="project-details">
                    <strong>{project.name}</strong>
                    <small>
                      {project.categoryName} · {project.frameCount} 帧 · {formatDuration(project.durationMs)} · {formatBytes(project.usageBytes)}
                    </small>
                  </span>
                  <span className="project-time">{formatDate(project.updatedAt)}</span>
                  <span className="row-delete" role="button" tabIndex={0} title="删除项目" onClick={(event) => removeProject(event, project)}>
                    <Trash2 size={14} />
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
      <Footer />
      {showCreate && (
        <CreateModal
          labs={labs}
          initialSlug={createSlug}
          onClose={() => setShowCreate(false)}
          onCreate={createProject}
          onError={onError}
        />
      )}
      {showAccount && <AccountModal user={user} onClose={() => setShowAccount(false)} />}
    </div>
  );
}

function formatDuration(ms) {
  const seconds = ms / 1000;
  return seconds >= 60 ? `${Math.floor(seconds / 60)}分${Math.round(seconds % 60)}秒` : `${seconds.toFixed(1)}秒`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function Topbar({ user, onAccount, onClose }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark"><Sparkles size={17} /></div>
        <span>FRAMEMOLD</span>
        <em>CLAYMATION / 定格</em>
      </div>
      <div className="top-actions">
        <span className="system-status"><span className="status-dot" />系统在线</span>
        <button className="profile" onClick={onAccount}>
          <span className="avatar"><UserRound size={15} /></span>
          {user?.displayName}
          <span className="chevron">⌄</span>
        </button>
        {onClose && <button className="button ghost small" onClick={onClose}>返回首页</button>}
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer>
      <span>FRAMEMOLD ENGINE v0.2</span>
      <span>本地压缩 · 服务端复检 · 原子存储</span>
      <span>API / READY</span>
    </footer>
  );
}
