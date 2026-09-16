import { useCallback, useEffect, useRef, useState } from 'react';
import { StrokeSampler, packPoints, extractBleeds } from './sampler.js';
import { BrushEngine } from './brush.js';
import { TileManager } from './tiles.js';
import { OpLog, opBBox, localId } from './history.js';
import { createElementOp, renderElement, ELEMENT_KINDS } from './elements.js';
import { buildTimeline, progressAt } from './timeline.js';
import { SyncClient } from './sync.js';

const WORLD_W = 16000;   // 超长画卷(世界坐标)
const WORLD_H = 1080;
const WINDOW_THRESHOLD = 2000; // 操作数超过它就走视口懒加载

const TONES = [
  { label: '焦', v: 1 }, { label: '浓', v: 0.85 }, { label: '重', v: 0.65 },
  { label: '淡', v: 0.45 }, { label: '清', v: 0.28 }
];
const TOOLS = [
  { id: 'brush', label: '毛笔', glyph: '✎' },
  { id: 'mountain', label: '山峰', glyph: '山' },
  { id: 'river', label: '河流', glyph: '川' },
  { id: 'birds', label: '飞鸟', glyph: '鸟' },
  { id: 'inscription', label: '题字', glyph: '字' }
];

export function InkDriftWorkspace({ project, user, apiBase }) {
  const [tool, setTool] = useState('brush');
  const [brushSize, setBrushSize] = useState(16);
  const [tone, setTone] = useState(0.85);
  const [syncState, setSyncState] = useState({ state: 'pending', pending: 0, version: 0 });
  const [elements, setElements] = useState([]);
  const [undoable, setUndoable] = useState(false);
  const [redoable, setRedoable] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playT, setPlayT] = useState(0);
  const [duration, setDuration] = useState(0);
  const [worldPx, setWorldPx] = useState(0);
  const [inscriptionDraft, setInscriptionDraft] = useState(null); // {x,y}
  const [inscText, setInscText] = useState('山高水长');
  const [inscSeal, setInscSeal] = useState('印');
  const [loadNote, setLoadNote] = useState('正在铺开画卷…');

  const scrollRef = useRef(null);
  const paperRef = useRef(null);
  const overlayRef = useRef(null);
  const miniRef = useRef(null);
  const brushRef = useRef(new BrushEngine());
  const tilesRef = useRef(null);
  const opLogRef = useRef(new OpLog());
  const opMapRef = useRef(new Map());
  const timingRef = useRef(new Map());
  const syncRef = useRef(null);
  const samplerRef = useRef(new StrokeSampler());
  const liveRef = useRef(null);          // 进行中的笔画
  const strokeClockRef = useRef(null);   // 录制时间轴的会话起点
  const scrollXRef = useRef(0);
  const loadedRangesRef = useRef([]);
  const metaRef = useRef({ opCount: 0 });
  const playingRef = useRef(false);
  const playStartRef = useRef(0);
  const rafRef = useRef(0);
  const thumbTimerRef = useRef(0);
  const ensureTimerRef = useRef(0);
  const timelineRef = useRef({ items: [], duration: 0 });

  // ---------- 视图 ----------
  const getView = useCallback(() => {
    const el = scrollRef.current;
    const viewW = el?.clientWidth || 800;
    const viewH = el?.clientHeight || 600;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    return { scrollX: scrollXRef.current, viewW, viewH, scale: viewH / WORLD_H, dpr };
  }, []);

  const render = useCallback(() => {
    const canvas = paperRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const view = getView();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#f3ecdc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // 宣纸纹理(淡淡的横向纤维)
    ctx.fillStyle = 'rgba(180,160,120,0.05)';
    for (let y = 0; y < canvas.height; y += 6 * view.dpr) ctx.fillRect(0, y, canvas.width, 1);
    tilesRef.current?.composite(ctx, view);
  }, [getView]);

  const renderLive = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const live = liveRef.current;
    if (!live) return;
    const view = getView();
    ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, -view.scrollX * view.dpr * view.scale, 0);
    brushRef.current.renderStroke(ctx, live, 1);
  }, [getView]);

  // ---------- 时间轴 ----------
  const rebuildTimeline = useCallback(() => {
    const ops = opLogRef.current.effectiveOps().map((op) => {
      if (op.kind !== 'element') return op;
      const t = timingRef.current.get(op.id);
      return t ? { ...op, ...t } : op;
    });
    timelineRef.current = buildTimeline(ops);
    setDuration(timelineRef.current.duration);
    setElements(ops.filter((op) => op.kind === 'element'));
    setUndoable(opLogRef.current.canUndo());
    setRedoable(opLogRef.current.canRedo());
  }, []);

  // ---------- 缩略图 ----------
  const scheduleThumb = useCallback(() => {
    clearTimeout(thumbTimerRef.current);
    thumbTimerRef.current = setTimeout(() => {
      const paper = paperRef.current;
      const sync = syncRef.current;
      if (!paper || !sync || sync.queue.length > 0) return;
      const c = document.createElement('canvas');
      c.width = 384;
      c.height = Math.max(24, Math.round((384 * paper.height) / paper.width));
      c.getContext('2d').drawImage(paper, 0, 0, c.width, c.height);
      sync.uploadThumbnail(c.toDataURL('image/png'));
    }, 2500);
  }, []);

  // ---------- 远端操作落地 ----------
  const applyOps = useCallback((ops) => {
    const log = opLogRef.current;
    const tiles = tilesRef.current;
    let added = 0;
    for (const op of ops) {
      if (!log.append(op)) continue;
      added += 1;
      if (op.kind === 'stroke' || op.kind === 'element') {
        opMapRef.current.set(op.id, op);
        if (!log.isUndone(op.id)) tiles?.bakeOp(op);
      } else if (op.kind === 'undo' || op.kind === 'redo') {
        const target = opMapRef.current.get(op.target);
        if (target?.bbox) tiles?.invalidateBBox(target.bbox);
      } else if (op.kind === 'meta' && op.target) {
        timingRef.current.set(op.target, { ...(timingRef.current.get(op.target) || {}), ...op.patch });
      }
    }
    if (added === 0) return;
    render();
    rebuildTimeline();
    scheduleThumb();
  }, [render, rebuildTimeline, scheduleThumb]);

  // ---------- 初始化 ----------
  useEffect(() => {
    const tiles = new TileManager(WORLD_W, WORLD_H, brushRef.current);
    tilesRef.current = tiles;
    const sync = new SyncClient({
      apiBase, projectId: project.id, userId: user.id,
      onRemoteOps: (ops) => applyOps(ops),
      onStatus: (s) => setSyncState((prev) => ({ ...s, extra: s.extra || prev?.extra }))
    });
    syncRef.current = sync;
    let cancelled = false;

    (async () => {
      await sync.init();
      try {
        const meta = await sync.fetchMeta();
        if (cancelled) return;
        metaRef.current = meta;
        sync.version = meta.version;
        if (meta.opCount === 0) {
          setLoadNote('');
        } else if (meta.opCount <= WINDOW_THRESHOLD) {
          setLoadNote(`正在加载 ${meta.opCount} 笔…`);
          await sync.pull();
        } else {
          // 超长画卷：先加载视口附近两段，其余随滚动懒加载
          setLoadNote(`长卷共 ${meta.opCount} 笔，按视野分段加载…`);
          const view = getView();
          const half = view.viewW / view.scale;
          await sync.pullRange(-half, half * 2);
          loadedRangesRef.current = [[-half, half * 2]];
        }
        setLoadNote('');
      } catch {
        setLoadNote('离线模式：内容将保存在本地，网络恢复后自动补传。');
        setTimeout(() => setLoadNote(''), 4000);
      }
      if (!cancelled) {
        tiles.effectiveOps = opLogRef.current.effectiveOps();
        render();
        rebuildTimeline();
        sync.flush(); // 补传上次未提交的内容
      }
    })();

    const onResize = () => {
      const el = scrollRef.current;
      if (!el) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      for (const c of [paperRef.current, overlayRef.current]) {
        c.width = el.clientWidth * dpr;
        c.height = el.clientHeight * dpr;
      }
      setWorldPx(Math.ceil(WORLD_W * (el.clientHeight / WORLD_H)));
      render();
    };
    onResize();
    window.addEventListener('resize', onResize);
    const poll = setInterval(() => { if (sync.online) sync.pull().catch(() => {}); }, 20000);
    const onHidden = () => { if (document.visibilityState === 'hidden') sync.flush(); };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onHidden);
      clearInterval(poll);
      clearInterval(dwellTimerRef.current);
      cancelAnimationFrame(rafRef.current);
      sync.destroy();
    };
  }, [project.id, user.id, apiBase, applyOps, getView, render, rebuildTimeline]);

  // 每次操作变化后同步瓦片重放源
  useEffect(() => {
    if (tilesRef.current) tilesRef.current.effectiveOps = opLogRef.current.effectiveOps();
  });

  // ---------- 滚动 ----------
  const drawMinimap = useCallback(() => {
    const canvas = miniRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width; const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#efe7d3';
    ctx.fillRect(0, 0, w, h);
    const sx = w / WORLD_W; const sy = h / WORLD_H;
    ctx.strokeStyle = 'rgba(40,40,40,0.55)';
    ctx.lineWidth = 1;
    for (const op of opLogRef.current.effectiveOps()) {
      if (op.kind === 'stroke' && op.pts?.length > 1) {
        ctx.beginPath();
        const step = Math.max(1, Math.floor(op.pts.length / 40));
        for (let i = 0; i < op.pts.length; i += step) {
          const p = op.pts[i];
          if (i === 0) ctx.moveTo(p[0] * sx, p[1] * sy); else ctx.lineTo(p[0] * sx, p[1] * sy);
        }
        ctx.stroke();
      } else if (op.kind === 'element' && op.bbox) {
        ctx.fillStyle = 'rgba(60,60,60,0.25)';
        ctx.fillRect(op.bbox[0] * sx, op.bbox[1] * sy, Math.max(2, (op.bbox[2] - op.bbox[0]) * sx), Math.max(2, (op.bbox[3] - op.bbox[1]) * sy));
      }
    }
    // 视口框
    const view = getView();
    const vx = view.scrollX * sx;
    const vw = (view.viewW / view.scale) * sx;
    ctx.strokeStyle = '#b3322c';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx, 1, vw, h - 2);
  }, [getView]);

  const ensureRange = useCallback(() => {
    const meta = metaRef.current;
    const sync = syncRef.current;
    if (!sync || meta.opCount <= WINDOW_THRESHOLD) return;
    const view = getView();
    const half = view.viewW / view.scale;
    const x0 = Math.max(0, view.scrollX - half);
    const x1 = Math.min(WORLD_W, view.scrollX + half * 2);
    const covered = loadedRangesRef.current.some(([a, b]) => a <= x0 && b >= x1);
    if (covered) return;
    sync.pullRange(x0, x1).then(() => {
      loadedRangesRef.current.push([x0, x1]);
      loadedRangesRef.current.sort((a, b) => a[0] - b[0]);
    }).catch(() => {});
  }, [getView]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const view = getView();
    scrollXRef.current = el.scrollLeft / view.scale;
    if (!playingRef.current) render();
    renderLive();
    drawMinimap();
    clearTimeout(ensureTimerRef.current);
    ensureTimerRef.current = setTimeout(ensureRange, 220);
  }, [getView, render, renderLive, drawMinimap, ensureRange]);

  useEffect(() => { drawMinimap(); }, [elements, drawMinimap]);

  // ---------- 坐标 ----------
  const toWorld = useCallback((e) => {
    const rect = overlayRef.current.getBoundingClientRect();
    const view = getView();
    return [(e.clientX - rect.left) / view.scale + view.scrollX, (e.clientY - rect.top) / view.scale];
  }, [getView]);

  // ---------- 绘画 ----------
  const dwellTimerRef = useRef(0);

  const finishStroke = useCallback(() => {
    const live = liveRef.current;
    if (!live) return;
    clearInterval(dwellTimerRef.current);
    liveRef.current = null;
    renderLive();
    // 以采样器的最终点序列为准(end 会补上笔锋终点)
    live.pointObjs = samplerRef.current.end(live.lastX, live.lastY, performance.now() - live.startedAt).slice();
    if (live.pointObjs.length === 0) return;
    const now = performance.now();
    const op = {
      ...live,
      pts: packPoints(live.pointObjs),
      bleeds: extractBleeds(live.pointObjs),
      dur: Math.max(0.15, (now - live.startedAt) / 1000),
      pointObjs: undefined,
      startedAt: undefined,
      lastX: undefined,
      lastY: undefined,
      lastEvent: undefined
    };
    op.bbox = opBBox(op);
    opLogRef.current.append(op);
    opMapRef.current.set(op.id, op);
    tilesRef.current.bakeOp(op);
    syncRef.current?.enqueue(op);
    render();
    rebuildTimeline();
    scheduleThumb();
  }, [render, renderLive, rebuildTimeline, scheduleThumb]);

  const placeElement = useCallback((el, x, y, extraParams = {}) => {
    const appearAt = Math.round(timelineRef.current.duration * 2) / 2;
    const op = createElementOp(localId('el'), el, x, y, extraParams, appearAt, el === 'inscription' ? 3 : 2.5);
    opLogRef.current.append(op);
    opMapRef.current.set(op.id, op);
    tilesRef.current.bakeOp(op);
    syncRef.current?.enqueue(op);
    render();
    rebuildTimeline();
    scheduleThumb();
  }, [render, rebuildTimeline, scheduleThumb]);

  const onPointerDown = useCallback((e) => {
    if (playingRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const [x, y] = toWorld(e);
    if (tool !== 'brush') {
      if (tool === 'inscription') setInscriptionDraft({ x, y });
      else placeElement(tool, x, tool === 'mountain' ? y + 200 : y);
      return;
    }
    overlayRef.current.setPointerCapture(e.pointerId);
    const t = performance.now();
    if (strokeClockRef.current == null) strokeClockRef.current = t;
    const sampler = samplerRef.current;
    sampler.begin(x, y, 0, e.pressure);
    liveRef.current = {
      id: localId('stroke'), kind: 'stroke',
      style: { size: brushSize, tone },
      seed: Math.floor(Math.random() * 1e9),
      // 新笔画接在当前时间轴末尾之后，保证回放顺序与绘制顺序一致
      t0: Math.max((t - strokeClockRef.current) / 1000, timelineRef.current.duration),
      startedAt: t,
      lastX: x, lastY: y, lastEvent: t,
      pointObjs: [{ x, y, p: sampler.pressure, t: 0, dwell: 0 }],
      pts: []
    };
    liveRef.current.pts = packPoints(liveRef.current.pointObjs);
    renderLive();
    // 停顿看门狗：指针完全静止时浏览器不上报事件，需定时注入原地点来累积停顿(晕墨)
    clearInterval(dwellTimerRef.current);
    dwellTimerRef.current = setInterval(() => {
      const live = liveRef.current;
      if (!live) { clearInterval(dwellTimerRef.current); return; }
      const now = performance.now();
      if (now - live.lastEvent < 90) return;
      const accepted = sampler.push(live.lastX, live.lastY, now - live.startedAt, 0);
      if (accepted.length) {
        live.pointObjs.push(...accepted);
        live.pts = packPoints(live.pointObjs);
        renderLive();
      }
    }, 100);
  }, [tool, toWorld, brushSize, tone, placeElement, renderLive]);

  const onPointerMove = useCallback((e) => {
    const live = liveRef.current;
    if (!live) return;
    const sampler = samplerRef.current;
    const events = e.nativeEvent.getCoalescedEvents?.() || [e.nativeEvent];
    let added = false;
    for (const ev of events) {
      const [x, y] = toWorld(ev);
      live.lastX = x; live.lastY = y;
      live.lastEvent = performance.now();
      const accepted = sampler.push(x, y, ev.timeStamp - live.startedAt, ev.pressure);
      if (accepted.length) { live.pointObjs.push(...accepted); added = true; }
    }
    if (added) {
      live.pts = packPoints(live.pointObjs);
      renderLive();
    }
  }, [toWorld, renderLive]);

  const onPointerUp = useCallback((e) => {
    const live = liveRef.current;
    if (!live) return;
    if (e?.clientX != null) {
      const [x, y] = toWorld(e);
      live.lastX = x; live.lastY = y;
    }
    finishStroke();
  }, [toWorld, finishStroke]);

  // ---------- 撤销 / 重做 ----------
  const doUndo = useCallback(() => {
    const op = opLogRef.current.createUndo();
    if (!op) return;
    opLogRef.current.append(op);
    const target = opMapRef.current.get(op.target);
    if (target?.bbox) tilesRef.current.invalidateBBox(target.bbox);
    syncRef.current?.enqueue(op);
    render();
    rebuildTimeline();
    scheduleThumb();
  }, [render, rebuildTimeline, scheduleThumb]);

  const doRedo = useCallback(() => {
    const op = opLogRef.current.createRedo();
    if (!op) return;
    opLogRef.current.append(op);
    const target = opMapRef.current.get(op.target);
    if (target?.bbox) tilesRef.current.invalidateBBox(target.bbox);
    syncRef.current?.enqueue(op);
    render();
    rebuildTimeline();
    scheduleThumb();
  }, [render, rebuildTimeline, scheduleThumb]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) doRedo(); else doUndo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doUndo, doRedo]);

  // ---------- 播放 ----------
  const renderPlayback = useCallback((t) => {
    const canvas = paperRef.current;
    const ctx = canvas.getContext('2d');
    const view = getView();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#f3ecdc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, -view.scrollX * view.dpr * view.scale, 0);
    const x0 = view.scrollX - 100; const x1 = view.scrollX + view.viewW / view.scale + 100;
    for (const item of timelineRef.current.items) {
      const p = progressAt(item, t);
      if (p <= 0) continue;
      const b = item.op.bbox;
      if (b && (b[2] < x0 || b[0] > x1)) continue;
      if (item.op.kind === 'stroke') brushRef.current.renderStroke(ctx, item.op, p);
      else renderElement(ctx, item.op, p, t * 1000);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [getView]);

  const stopPlayback = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
    render();
  }, [render]);

  const play = useCallback(() => {
    if (playingRef.current) { stopPlayback(); return; }
    if (timelineRef.current.duration === 0) return;
    const startT = playT >= timelineRef.current.duration - 0.05 ? 0 : playT;
    setPlaying(true);
    playingRef.current = true;
    playStartRef.current = performance.now() - startT * 1000;
    const step = () => {
      const t = (performance.now() - playStartRef.current) / 1000;
      if (t >= timelineRef.current.duration) { setPlayT(0); stopPlayback(); return; }
      setPlayT(t);
      renderPlayback(t);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [playT, renderPlayback, stopPlayback]);

  const scrub = useCallback((v) => {
    const t = Number(v);
    setPlayT(t);
    if (playingRef.current) playStartRef.current = performance.now() - t * 1000;
    else renderPlayback(t);
  }, [renderPlayback]);

  // ---------- 元素时间调整 ----------
  const updateTiming = useCallback((el, patch) => {
    const next = { appearAt: el.appearAt, duration: el.duration, ...(timingRef.current.get(el.id) || {}), ...patch };
    timingRef.current.set(el.id, next);
    const op = { id: localId('meta'), kind: 'meta', target: el.id, patch };
    opLogRef.current.append(op);
    syncRef.current?.enqueue(op);
    rebuildTimeline();
  }, [rebuildTimeline]);

  const confirmInscription = useCallback(() => {
    if (inscriptionDraft && inscText.trim()) {
      placeElement('inscription', inscriptionDraft.x, inscriptionDraft.y, { text: inscText.trim(), seal: inscSeal.trim() || '印' });
    }
    setInscriptionDraft(null);
  }, [inscriptionDraft, inscText, inscSeal, placeElement]);

  const minimapJump = useCallback((e) => {
    const rect = miniRef.current.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const el = scrollRef.current;
    el.scrollLeft = frac * WORLD_W * getView().scale - el.clientWidth / 2;
  }, [getView]);

  const statusText = { offline: '离线 · 等待补传', pending: `未提交 ${syncState.pending} 条`, synced: '已同步' }[syncState.state] || '同步中';

  return (
    <div className="inkdrift">
      <div className="ink-toolbar">
        <div className="ink-tools">
          {TOOLS.map((t) => (
            <button key={t.id} className={`ink-tool ${tool === t.id ? 'active' : ''}`} title={t.label}
              onClick={() => setTool(t.id)}>{t.glyph}<span>{t.label}</span></button>
          ))}
        </div>
        <label className="ink-field">笔锋
          <input type="range" min="4" max="48" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
        </label>
        <div className="ink-tones">
          {TONES.map((tn) => (
            <button key={tn.label} className={`ink-tone ${tone === tn.v ? 'active' : ''}`}
              style={{ opacity: 0.35 + tn.v * 0.65 }} onClick={() => setTone(tn.v)}>{tn.label}</button>
          ))}
        </div>
        <div className="ink-actions">
          <button className="ink-btn" disabled={!undoable} onClick={doUndo}>撤销</button>
          <button className="ink-btn" disabled={!redoable} onClick={doRedo}>重做</button>
          <button className="ink-btn play" onClick={play}>{playing ? '停止' : '播放生长'}</button>
        </div>
        <span className={`ink-sync ${syncState.state}`}>{statusText} · v{syncState.version}</span>
      </div>

      <div className="ink-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="ink-stage">
          <canvas ref={paperRef} className="ink-paper" />
          <canvas ref={overlayRef} className="ink-overlay"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
          {loadNote && <div className="ink-loadnote">{loadNote}</div>}
        </div>
        <div className="ink-spacer" style={{ width: worldPx || '100%' }} />
      </div>

      <div className="ink-bottom">
        <canvas ref={miniRef} className="ink-minimap" width={560} height={54} onPointerDown={minimapJump} />
        <div className="ink-playbar">
          <input type="range" min="0" max={duration || 1} step="0.05" value={playT} onChange={(e) => scrub(e.target.value)} />
          <span>{playT.toFixed(1)}s / {duration.toFixed(1)}s</span>
        </div>
      </div>

      {elements.length > 0 && (
        <div className="ink-elements">
          <h4>元素出场时间</h4>
          {elements.map((el, i) => {
            const timing = { appearAt: el.appearAt, duration: el.duration, ...(timingRef.current.get(el.id) || {}) };
            const label = el.el === 'inscription' ? `题字「${el.params.text}」` : ELEMENT_KINDS[el.el].label;
            return (
              <div className="ink-el-row" key={el.id}>
                <span className="ink-el-name">{i + 1}. {label}</span>
                <label>出现
                  <input type="number" min="0" step="0.5" value={timing.appearAt}
                    onChange={(e) => updateTiming(el, { appearAt: Math.max(0, Number(e.target.value) || 0) })} />s
                </label>
                <label>时长
                  <input type="number" min="0.2" step="0.5" value={timing.duration}
                    onChange={(e) => updateTiming(el, { duration: Math.max(0.2, Number(e.target.value) || 0.2) })} />s
                </label>
              </div>
            );
          })}
        </div>
      )}

      {inscriptionDraft && (
        <div className="modal-backdrop" onClick={() => setInscriptionDraft(null)}>
          <div className="modal ink-insc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h2>题字</h2></div>
            <label>内容<input autoFocus value={inscText} onChange={(e) => setInscText(e.target.value)} placeholder="例如：山高水长" /></label>
            <label>印章<input value={inscSeal} onChange={(e) => setInscSeal(e.target.value)} maxLength={2} placeholder="印" /></label>
            <div className="modal-actions">
              <button className="button ghost" onClick={() => setInscriptionDraft(null)}>取消</button>
              <button className="button primary" onClick={confirmInscription}>落印</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
