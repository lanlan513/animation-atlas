import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, ChevronLeft, ChevronRight, CircleAlert, Cloud, LoaderCircle, Maximize2, MousePointerClick, Pause, Play, TriangleAlert, Wand2, ZoomIn, ZoomOut } from 'lucide-react';
import { request } from '../api.js';
import { clamp, expandRect, fitRectToAspect, fullPageRect, pointsToAttr, polygonBounds, polygonCenter } from './geometry.js';
import { useCamera } from './camera.js';
import { ActorFigure, Bubble, GuidePath, PanelArt, Sfx } from './panelArt.jsx';

const ISSUE_LABELS = {
  'svg-corrupted': 'SVG 热区已损坏，使用备用矩形热区',
  'coords-clamped': '坐标越界，已钳制到页面内',
  'focus-fallback': '聚焦框缺失，已根据热区自动推算'
};

export default function ComicReader({ project, user, onError }) {
  const headers = useMemo(() => ({ 'x-user-id': user.id }), [user.id]);
  const [comic, setComic] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | empty
  const [pageId, setPageId] = useState(null);
  const [mode, setMode] = useState('free'); // free 自由点读 / auto 自动导读
  const [focusKey, setFocusKey] = useState(null);
  const [visitedOrder, setVisitedOrder] = useState(0);
  const [autoPlaying, setAutoPlaying] = useState(false);
  const [beats, setBeats] = useState([]);
  const [notice, setNotice] = useState('');
  const [saveState, setSaveState] = useState('idle');
  const [busy, setBusy] = useState(false);
  const [camera, flyTo, cancelFlight, cameraRef] = useCamera(null);

  const stageRef = useRef(null);
  const aspectRef = useRef(3 / 4);
  const timers = useRef([]);
  const autoRef = useRef(false);
  const modeRef = useRef('free');
  const saveTimer = useRef(null);
  const noticeTimer = useRef(null);
  const pendingRestore = useRef(null);

  /* ------------------------------ 数据派生 ------------------------------ */
  const chapters = comic?.chapters || [];
  const chapter = chapters.find((c) => c.pages.some((p) => p.id === pageId)) || chapters[0] || null;
  const page = chapter?.pages.find((p) => p.id === pageId) || chapter?.pages[0] || null;
  const panels = useMemo(() => [...(page?.panels || [])].sort((a, b) => a.readingOrder - b.readingOrder), [page]);
  const focusedPanel = panels.find((p) => p.panelKey === focusKey) || null;

  /* ------------------------------ 定时器 ------------------------------ */
  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.current.push(id); return id; };
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => () => { clearTimers(); clearTimeout(saveTimer.current); clearTimeout(noticeTimer.current); }, []);

  const showNotice = (text) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 3600);
  };

  /* --------------------------- 阅读进度持久化 ---------------------------
   * 每次聚焦 / 切页 / 切换模式都会带上当前位置快照，
   * 自由点读与自动导读共用同一条记录，切换模式不会丢进度。 */
  const queueSaveProgress = useCallback((snapshot) => {
    setSaveState('saving');
    try { localStorage.setItem(`panel-punch-progress-${project.id}`, JSON.stringify(snapshot)); } catch { /* 本地兜底失败可忽略 */ }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await request(`/comic/pages/${snapshot.pageId}/progress`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ panelId: snapshot.panelId, readingOrder: snapshot.readingOrder, mode: snapshot.mode })
        });
        setSaveState('saved');
      } catch { setSaveState('error'); }
    }, 450);
  }, [headers, project.id]);

  /* ------------------------------ 演出调度 ------------------------------ */
  const scheduleBeats = (panel) => {
    [...panel.beats].sort((a, b) => a.seq - b.seq).forEach((beat) => {
      later(() => {
        const inst = `${beat.id}-${Math.random().toString(36).slice(2, 8)}`;
        setBeats((cur) => [...cur, { ...beat, inst }]);
        later(() => setBeats((cur) => cur.filter((b) => b.inst !== inst)), beat.durationMs);
      }, 260 + beat.delayMs);
    });
  };

  const panelDuration = (panel) => 300 + panel.beats.reduce((max, b) => Math.max(max, (b.delayMs || 0) + (b.durationMs || 0)), 0) + 450;

  // 镜头聚焦到某一格，并按需播放该格的角色动作 / 对白 / 拟声词
  const focusPanel = (panel, { play = true, save = true, instant = false } = {}) => {
    if (!panel || !page) return;
    cancelFlight();
    clearTimers();
    setBeats([]);
    setFocusKey(panel.panelKey);
    setVisitedOrder((v) => Math.max(v, panel.readingOrder));
    flyTo(fitRectToAspect(expandRect(panel.focus, 1.16), aspectRef.current, page), instant ? 0 : 760);
    if (save) queueSaveProgress({ pageId: page.id, panelId: panel.id, readingOrder: panel.readingOrder, mode: modeRef.current });
    if (play) scheduleBeats(panel);
  };

  /* ------------------------------ 自动导读 ------------------------------ */
  const stopAuto = () => { autoRef.current = false; setAutoPlaying(false); };
  const autoStep = (fromOrder) => {
    if (!autoRef.current) return;
    const next = panels.find((p) => p.readingOrder >= fromOrder);
    if (!next) { stopAuto(); showNotice('本章导读结束，进度已保存'); return; }
    focusPanel(next);
    later(() => autoStep(next.readingOrder + 1), panelDuration(next) + 260);
  };
  const startAuto = (fromOrder) => {
    if (!panels.length) { showNotice('这一页还没有可导读的分镜'); return; }
    autoRef.current = true;
    setAutoPlaying(true);
    autoStep(fromOrder ?? focusedPanel?.readingOrder ?? panels[0].readingOrder);
  };

  // 模式切换：进度快照原样保留，只换播放方式
  const switchMode = (next) => {
    if (next === mode || !page) return;
    setMode(next);
    modeRef.current = next;
    queueSaveProgress({ pageId: page.id, panelId: focusedPanel?.id ?? null, readingOrder: focusedPanel?.readingOrder ?? visitedOrder, mode: next });
    if (next === 'auto') startAuto();
    else stopAuto();
  };

  const stepPanel = (dir) => {
    if (!panels.length) return;
    stopAuto();
    const idx = focusedPanel ? panels.indexOf(focusedPanel) : (dir > 0 ? -1 : 0);
    focusPanel(panels[clamp(idx + dir, 0, panels.length - 1)]);
  };

  /* ------------------------------ 镜头缩放 ------------------------------ */
  const zoomBy = (factor) => {
    if (!page) return;
    const cam = cameraRef.current || fullPageRect(page);
    const cx = cam.x + cam.w / 2;
    const cy = cam.y + cam.h / 2;
    let w = clamp(cam.w * factor, page.width * 0.1, page.width);
    let h = w / aspectRef.current;
    if (h > page.height) { h = page.height; w = h * aspectRef.current; }
    flyTo(fitRectToAspect({ x: cx - w / 2, y: cy - h / 2, w, h }, aspectRef.current, page), 300);
  };
  const resetCamera = () => { if (page) flyTo(fitRectToAspect(fullPageRect(page), aspectRef.current, page), 500); };

  /* ------------------------------ 加载与恢复 ------------------------------ */
  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const struct = await request(`/projects/${project.id}/comic`, { headers });
      if (!struct.chapters?.length) { setComic({ chapters: [] }); setStatus('empty'); return; }
      setComic(struct);
      const allPages = struct.chapters.flatMap((c) => c.pages);
      const firstPage = allPages[0];
      let progress = null;
      try { const r = await request(`/comic/pages/${firstPage.id}/progress`, { headers }); progress = r.progress; } catch { /* 离线时用本地快照 */ }
      if (!progress) { try { progress = JSON.parse(localStorage.getItem(`panel-punch-progress-${project.id}`)); } catch { /* 忽略损坏的本地快照 */ } }
      const targetPage = allPages.find((p) => p.id === progress?.pageId) || firstPage;
      setPageId(targetPage.id);
      const restoredMode = progress?.mode === 'auto' ? 'auto' : 'free';
      setMode(restoredMode);
      modeRef.current = restoredMode;
      setVisitedOrder(progress?.readingOrder || 0);
      pendingRestore.current = progress ? { ...progress, pageId: targetPage.id } : null;
      setStatus('ready');
    } catch (err) {
      onError?.(err.message);
      setStatus('empty');
    }
  }, [headers, project.id, onError]);
  useEffect(() => { load(); }, [load]);

  // 舞台宽高比：镜头聚焦计算依赖它
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) aspectRef.current = r.width / r.height;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [status]);

  // 切页：清场并把镜头拉回整页（要在恢复进度之前声明，保证同批 effect 里先执行）
  const pageKey = page?.id;
  useEffect(() => {
    if (!pageKey) return;
    stopAuto();
    clearTimers();
    setBeats([]);
    setFocusKey(null);
    const pg = chapters.flatMap((c) => c.pages).find((p) => p.id === pageKey);
    if (pg) flyTo(fitRectToAspect(fullPageRect(pg), aspectRef.current, pg), 0);
  }, [pageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 恢复上次阅读位置：分镜还在就镜头直达；已被删除则降级回页首并提示
  useEffect(() => {
    if (status !== 'ready' || !page || !pendingRestore.current) return;
    const saved = pendingRestore.current;
    pendingRestore.current = null;
    if (saved.panelId) {
      const panel = (page.panels || []).find((p) => p.id === saved.panelId);
      if (panel) focusPanel(panel, { play: false, save: false, instant: true });
      else if (page.panels?.length) {
        showNotice('上次阅读的分镜已缺失，已回到本页开头');
        focusPanel([...page.panels].sort((a, b) => a.readingOrder - b.readingOrder)[0], { play: false, save: false, instant: true });
      }
    }
    if (modeRef.current === 'auto') later(() => startAuto(saved.readingOrder || undefined), 900);
  }, [status, page]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------ 操作入口 ------------------------------ */
  const generateSample = async () => {
    setBusy(true);
    try {
      const struct = await request(`/projects/${project.id}/comic/sample`, { method: 'POST', headers });
      setComic(struct);
      setPageId(struct.chapters?.[0]?.pages?.[0]?.id || null);
      setStatus('ready');
      showNotice('示例章节已生成：含跨格角色、拟声词与降级演示分镜');
    } catch (err) { onError?.(err.message); } finally { setBusy(false); }
  };

  const togglePublish = async () => {
    if (!chapter) return;
    const next = chapter.status === 'published' ? 'draft' : 'published';
    try {
      const r = await request(`/projects/${project.id}/comic/chapters/${chapter.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: next }) });
      setComic((cur) => ({ chapters: cur.chapters.map((c) => (c.id === chapter.id ? { ...c, status: r.chapter.status } : c)) }));
      showNotice(next === 'published' ? '章节已发布，访客现在可以阅读' : '已撤回为私有草稿，访客无法再看');
    } catch (err) { onError?.(err.message); }
  };

  const choosePage = (id) => {
    if (id === pageId) return;
    setPageId(id);
    setVisitedOrder(0);
    queueSaveProgress({ pageId: id, panelId: null, readingOrder: 0, mode: modeRef.current });
  };

  /* ------------------------------ 渲染 ------------------------------ */
  if (status === 'loading') {
    return <div className="reader-state"><LoaderCircle className="spin" size={22} /><span>正在装订分镜…</span></div>;
  }
  if (status === 'empty' || !chapter) {
    return (
      <div className="reader-state empty">
        <div className="empty-icon"><BookOpen size={22} /></div>
        <h3>这个 Panel Punch 项目还没有分镜</h3>
        <p>生成一份示例章节：不规则热区、跨格角色、拟声词演出与降级演示一次到位。</p>
        <button className="button primary" onClick={generateSample} disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={15} /> : <Wand2 size={15} />}生成示例章节
        </button>
      </div>
    );
  }

  const camShaking = beats.some((b) => b.type === 'camera' && b.payload?.move === 'shake');
  const actorActions = {};
  for (const b of beats) if (b.type === 'action' && b.payload?.actorId) actorActions[b.payload.actorId] = b.payload.move;

  return (
    <div className="reader">
      <div className="reader-toolbar">
        <div className="mode-switch" role="tablist" aria-label="阅读模式">
          <button className={mode === 'free' ? 'on' : ''} onClick={() => switchMode('free')}><MousePointerClick size={14} />自由点读</button>
          <button className={mode === 'auto' ? 'on' : ''} onClick={() => switchMode('auto')}><Play size={14} />自动导读</button>
        </div>
        {mode === 'auto' && (
          <button className="icon-button" title={autoPlaying ? '暂停导读' : '继续导读'} onClick={() => (autoPlaying ? stopAuto() : startAuto())}>
            {autoPlaying ? <Pause size={15} /> : <Play size={15} />}
          </button>
        )}
        <div className="reader-nav">
          <button className="icon-button" title="上一格" onClick={() => stepPanel(-1)} disabled={!panels.length}><ChevronLeft size={15} /></button>
          <span className="reader-pos">{focusedPanel ? `${panels.indexOf(focusedPanel) + 1} / ${panels.length}` : `– / ${panels.length}`}</span>
          <button className="icon-button" title="下一格" onClick={() => stepPanel(1)} disabled={!panels.length}><ChevronRight size={15} /></button>
        </div>
        <div className="reader-zoom">
          <button className="icon-button" title="放大" onClick={() => zoomBy(0.72)}><ZoomIn size={15} /></button>
          <button className="icon-button" title="缩小" onClick={() => zoomBy(1.38)}><ZoomOut size={15} /></button>
          <button className="icon-button" title="整页" onClick={resetCamera}><Maximize2 size={15} /></button>
        </div>
        <span className={`chapter-badge ${chapter.status}`}>{chapter.status === 'published' ? '已发布' : '私有草稿'}</span>
        <button className="button ghost small" onClick={togglePublish}>{chapter.status === 'published' ? '撤回为草稿' : '发布章节'}</button>
        <SaveDot state={saveState} />
      </div>

      <div className="reader-subbar">
        <span className="reader-chapter">{chapter.title}</span>
        <div className="page-tabs">
          {chapter.pages.map((p) => (
            <button key={p.id} className={p.id === page?.id ? 'on' : ''} onClick={() => choosePage(p.id)}>
              P{p.pageNumber}
              {!p.panels.length && <TriangleAlert size={11} />}
            </button>
          ))}
        </div>
      </div>

      <div className="reader-stage" ref={stageRef}>
        {page && camera && (
          <svg className={`reader-svg${camShaking ? ' cam-shake' : ''}`} viewBox={`${camera.x} ${camera.y} ${camera.w} ${camera.h}`} preserveAspectRatio="xMidYMid meet">
            <defs>
              <pattern id={`ht-${page.id}`} width="14" height="14" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1.1" fill="#ffffff10" />
              </pattern>
              {panels.map((p) => (
                <clipPath key={p.id} id={`clip-${p.id}`}><polygon points={pointsToAttr(p.polygon)} /></clipPath>
              ))}
            </defs>
            <rect x="0" y="0" width={page.width} height={page.height} fill={page.background?.tone || '#14161f'} />
            <rect x="0" y="0" width={page.width} height={page.height} fill={`url(#ht-${page.id})`} />
            {panels.map((panel) => {
              const bounds = polygonBounds(panel.polygon);
              const [cx, cy] = polygonCenter(panel.polygon);
              const active = focusKey === panel.panelKey;
              const corrupted = panel.issues?.includes('svg-corrupted');
              return (
                <g key={panel.id} className={`panel${active ? ' active' : ''}${panel.readingOrder <= visitedOrder ? ' visited' : ''}${panel.degraded ? ' degraded' : ''}${corrupted ? ' corrupted' : ''}`}>
                  <g clipPath={`url(#clip-${panel.id})`}>
                    <PanelArt art={panel.art} bounds={bounds} />
                  </g>
                  <polygon className="panel-frame" points={pointsToAttr(panel.polygon)} />
                  {/* 命中热区与视觉边框是同一个 polygon、同一个 viewBox 坐标系，
                      镜头任意缩放时两者始终重合 */}
                  <polygon className="panel-hit" points={pointsToAttr(panel.polygon)} onClick={() => { stopAuto(); focusPanel(panel); }}>
                    <title>{panel.degraded ? panel.issues.map((i) => ISSUE_LABELS[i] || i).join('；') : `第 ${panel.readingOrder} 格 · ${panel.panelKey}`}</title>
                  </polygon>
                  <g className="order-badge" transform={`translate(${cx} ${cy})`}>
                    <circle r="15" />
                    <text y="1">{panel.readingOrder}</text>
                  </g>
                  {panel.degraded && (
                    <g className="degraded-tag" transform={`translate(${bounds.x + 12} ${bounds.y + 12})`}>
                      <rect width="86" height="22" rx="5" />
                      <text x="10" y="15">⚠ 热区降级</text>
                      <title>{panel.issues.map((i) => ISSUE_LABELS[i] || i).join('；')}</title>
                    </g>
                  )}
                </g>
              );
            })}
            <GuidePath panels={panels} visitedOrder={visitedOrder} />
            {(page.actors || []).map((a) => <ActorFigure key={a.id} actor={a} action={actorActions[a.id]} />)}
            {beats.map((b) => (b.type === 'bubble'
              ? <Bubble key={b.inst} beat={b} page={page} />
              : b.type === 'sfx' ? <Sfx key={b.inst} beat={b} page={page} /> : null))}
          </svg>
        )}
        {page && !page.panels.length && (
          <div className="missing-panels">
            <TriangleAlert size={20} />
            <h3>这一页的分镜还没画好</h3>
            <p>服务器中没有本页的分镜数据，已切换为占位显示。</p>
            {chapter.pages.length > 1 && (
              <button className="button ghost small" onClick={() => choosePage(chapter.pages[0].id)}>返回第 1 页</button>
            )}
          </div>
        )}
        {notice && <div className="reader-notice">{notice}</div>}
      </div>

      <div className="panel-strip">
        {panels.map((p) => (
          <button key={p.id} className={`panel-chip${focusKey === p.panelKey ? ' on' : ''}${p.degraded ? ' warn' : ''}`} onClick={() => { stopAuto(); focusPanel(p); }}>
            <span className="chip-order">{String(p.readingOrder).padStart(2, '0')}</span>
            <span className="chip-key">{p.panelKey}</span>
            {p.degraded && <TriangleAlert size={11} />}
          </button>
        ))}
        {!panels.length && <span className="chip-empty">本页暂无分镜数据</span>}
      </div>
    </div>
  );
}

function SaveDot({ state }) {
  const map = {
    idle: ['阅读进度自动保存', <Cloud size={13} key="i" />],
    saving: ['保存中…', <LoaderCircle className="spin" size={13} key="i" />],
    saved: ['进度已保存', <Check size={13} key="i" />],
    error: ['保存失败，已保留在本地', <CircleAlert size={13} key="i" />]
  };
  const [text, icon] = map[state] || map.idle;
  return <span className={`save-dot ${state}`}>{icon}{text}</span>;
}
