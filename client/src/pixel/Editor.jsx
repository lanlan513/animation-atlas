import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { PixelStore } from './store.js';
import PixelCanvas from './PixelCanvas.jsx';
import Timeline from './Timeline.jsx';
import PalettePanel from './PalettePanel.jsx';
import PreviewPanel from './PreviewPanel.jsx';
import ExportPanel from './ExportPanel.jsx';
import {
  TRANSPARENT, mirrorCells, floodFill,
  unpackPixels, getFrame
} from '../../../shared/pixel-core.js';

const TOOLS = [
  { id: 'pencil', label: '画笔', key: 'B', glyph: '✏' },
  { id: 'eraser', label: '橡皮', key: 'E', glyph: '⌫' },
  { id: 'fill', label: '油漆桶', key: 'G', glyph: '🪣' },
  { id: 'picker', label: '吸色', key: 'I', glyph: '💧' }
];

export default function Editor({ projectId, userId, onExit }) {
  const [store, setStore] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [, setTick] = useState(0);
  const [frameId, setFrameId] = useState(null);
  const [tool, setTool] = useState('pencil');
  const [colorId, setColorId] = useState(null);
  const [mirror, setMirror] = useState('off');
  const [onion, setOnion] = useState({ enabled: true, back: 1, forward: 1 });
  const [showGrid, setShowGrid] = useState(true);
  const [cellZoom, setCellZoom] = useState(null); // null = auto
  const [notice, setNotice] = useState('');
  const [showResize, setShowResize] = useState(false);
  const noticeTimer = useRef(null);

  // ---------- load ----------
  useEffect(() => {
    let cancelled = false;
    api.loadProject(projectId).then(({ state: model, version }) => {
      if (cancelled) return;
      const pending = PixelStore.loadPending(projectId);
      const instance = new PixelStore({ model, version, userId, pending });
      if (pending?.queue?.length) {
        // Notice surfaces on first tick.
        instance.notice = `恢复了离线时缓存的 ${pending.queue.length} 个未提交操作，正在尝试同步…`;
      }
      setStore(instance);
      setFrameId(instance.model.frames[0]?.id ?? null);
      setColorId(instance.model.palette[0]?.id ?? null);
    }).catch((err) => {
      if (!cancelled) setLoadError(err.message || '项目加载失败');
    });
    return () => { cancelled = true; };
  }, [projectId, userId]);

  // ---------- reactive subscription ----------
  useEffect(() => {
    if (!store) return;
    const rerender = () => {
      const note = store.consumeNotice();
      if (note) {
        setNotice(note);
        clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(''), 6000);
      }
      setTick((t) => t + 1);
    };
    return store.subscribe(rerender);
  }, [store]);

  // If the active frame disappears (delete / conflict), select a neighbor.
  useEffect(() => {
    if (!store || !frameId) return;
    if (!getFrame(store.model, frameId)) {
      setFrameId(store.model.frames[0]?.id ?? null);
    }
  });

  // If the active color disappears, fall back to the first swatch.
  useEffect(() => {
    if (!store) return;
    if (colorId != null && !store.model.palette.some((s) => s.id === colorId)) {
      setColorId(store.model.palette[0]?.id ?? null);
    }
  });

  // Flush on tab close (best effort); queue itself is already in localStorage.
  useEffect(() => {
    if (!store) return;
    const onUnload = () => { if (store.pendingCount) store.flush(); };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [store]);

  // ---------- keyboard ----------
  useEffect(() => {
    if (!store) return;
    const onKey = (e) => {
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo(); else store.undo();
      } else if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
      } else if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        store.flush();
      } else if (!meta) {
        const map = { b: 'pencil', e: 'eraser', g: 'fill', i: 'picker' };
        if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
        else if (e.key.toLowerCase() === 'x') setMirror((m) => (m === 'off' ? 'x' : m === 'x' ? 'xy' : m === 'xy' ? 'y' : 'off'));
        else if (e.key.toLowerCase() === 'o') setOnion((o) => ({ ...o, enabled: !o.enabled }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  // ---------- painting ----------
  const activeValue = tool === 'eraser' ? TRANSPARENT : colorId;

  const stroke = useCallback((cells) => {
    if (!store || frameId == null) return;
    const expanded = [];
    for (const [x, y] of cells) {
      for (const [mx, my] of mirrorCells([x, y], store.model.width, store.model.height, mirror)) {
        expanded.push([mx, my]);
      }
    }
    // Dedup within one call (mirror axis overlaps).
    const seen = new Set();
    const unique = expanded.filter(([x, y]) => {
      const k = y * 512 + x;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    store.paintCells(frameId, unique.map(([x, y]) => [x, y, activeValue]));
  }, [store, frameId, mirror, activeValue]);

  const onPaintStart = useCallback((pos) => {
    if (!store || frameId == null) return;
    if (tool === 'fill') {
      const frame = getFrame(store.model, frameId);
      const { width, height } = store.model;
      const pixels = unpackPixels(frame.data, width * height);
      // Flood from each (possibly mirrored) seed, mutating pixels live so
      // overlapping mirrored regions don't get stale old-values.
      const seeds = [];
      for (const [x, y] of mirrorCells(pos, width, height, mirror)) seeds.push([x, y]);
      const seenSeed = new Set();
      const cells = [];
      const touched = new Set();
      for (const [sx, sy] of seeds) {
        const key = sy * 512 + sx;
        if (seenSeed.has(key)) continue;
        seenSeed.add(key);
        const filled = floodFill(pixels, width, height, sx, sy, activeValue);
        for (const [x, y, value, old] of filled) {
          const ck = y * 512 + x;
          // Apply immediately so a later mirrored seed inside an already
          // filled region doesn't expand into it again.
          pixels[y * width + x] = value;
          if (touched.has(ck)) continue;
          touched.add(ck);
          cells.push([x, y, value, old]);
        }
      }
      store.paintCells(frameId, cells);
      // No beginGesture for fill: paintCells commits atomically on its own.
    } else if (tool === 'pencil' || tool === 'eraser') {
      stroke([pos]);
    }
  }, [store, frameId, tool, mirror, activeValue, stroke]);

  const onPaintMove = useCallback((cells) => {
    if (tool !== 'pencil' && tool !== 'eraser') return;
    stroke(cells);
  }, [stroke, tool]);

  // ---------- derived ----------
  const cell = useMemo(() => {
    if (!store) return 24;
    if (cellZoom) return cellZoom;
    return Math.max(10, Math.min(40, Math.floor(480 / store.model.width)));
  }, [store, cellZoom]);

  if (loadError) {
    return (
      <div className="screen-state">
        <p>{loadError}</p>
        <button className="btn secondary" onClick={onExit}>返回列表</button>
      </div>
    );
  }
  if (!store) return <div className="screen-state"><span className="loader" />正在载入像素矩阵…</div>;

  const model = store.model;
  const currentFrame = getFrame(model, frameId);
  const frameIndexInDir = currentFrame ? model.frames.filter((f) => f.dir === currentFrame.dir).findIndex((f) => f.id === currentFrame.id) : -1;

  return (
    <div className="editor">
      <header className="editor-head">
        <button className="btn ghost tiny" onClick={onExit} title="返回项目列表">←</button>
        <input
          className="project-name"
          defaultValue={model.name}
          key={model.id}
          onBlur={(e) => store.rename(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
        />
        <span className="size-badge">{model.width}×{model.height}</span>
        <span className="version-badge">v{store.serverVersion}{store.pendingCount ? ` · 待提交 ${store.pendingCount}` : ''}</span>
        <div className="head-right">
          <SyncBadge state={store.syncState} pending={store.pendingCount} />
          <button className="btn tiny" onClick={() => store.flush()} title="立即同步（Ctrl+S）">⇪ 同步</button>
          <button className="btn tiny" onClick={() => setShowResize((v) => !v)}>画布尺寸</button>
          <label className="offline-toggle" title="模拟断网，验证离线绘制与冲突恢复">
            <input type="checkbox" checked={store.forceOffline} onChange={(e) => store.setForceOffline(e.target.checked)} />
            模拟离线
          </label>
        </div>
      </header>

      {showResize && <ResizeBar store={store} onClose={() => setShowResize(false)} />}

      <div className="editor-body">
        <aside className="tool-rail">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`tool-btn ${tool === t.id ? 'active' : ''}`}
              title={`${t.label}（${t.key}）`}
              onClick={() => setTool(t.id)}
            >
              <span className="tool-glyph">{t.glyph}</span>
              <small>{t.label}</small>
            </button>
          ))}
          <div className="rail-divider" />
          <button className={`tool-btn ${mirror !== 'off' ? 'active' : ''}`} title="镜像绘制（X 切换，多按切换双轴）" onClick={() => setMirror((m) => (m === 'off' ? 'x' : m === 'x' ? 'xy' : m === 'xy' ? 'y' : 'off'))}>
            <span className="tool-glyph">◈</span><small>镜像 {mirror === 'off' ? '关' : mirror.toUpperCase()}</small>
          </button>
          <button className={`tool-btn ${onion.enabled ? 'active' : ''}`} title="洋葱皮（O 开关）" onClick={() => setOnion((o) => ({ ...o, enabled: !o.enabled }))}>
            <span className="tool-glyph">◐</span><small>洋葱皮</small>
          </button>
          <button className={`tool-btn ${showGrid ? 'active' : ''}`} title="网格" onClick={() => setShowGrid((v) => !v)}>
            <span className="tool-glyph">▦</span><small>网格</small>
          </button>
          <div className="rail-divider" />
          <button className="tool-btn" title="撤销 Ctrl+Z" onClick={() => store.undo()}><span className="tool-glyph">↶</span><small>撤销</small></button>
          <button className="tool-btn" title="重做 Ctrl+Shift+Z" onClick={() => store.redo()}><span className="tool-glyph">↷</span><small>重做</small></button>
          <div className="zoom-cluster">
            <button className="tool-btn" onClick={() => setCellZoom((z) => Math.max(8, (z || cell) - 4))}><small>−</small></button>
            <button className="tool-btn" onClick={() => setCellZoom(null)}><small>{cell}px</small></button>
            <button className="tool-btn" onClick={() => setCellZoom((z) => Math.min(64, (z || cell) + 4))}><small>＋</small></button>
          </div>
        </aside>

        <main className="canvas-area">
          <div className="canvas-frame">
            <PixelCanvas
              store={store}
              frameId={frameId}
              cell={cell}
              tool={tool}
              mirror={mirror}
              onion={onion}
              showGrid={showGrid}
              onPaintStart={onPaintStart}
              onPaintMove={onPaintMove}
              onPickColor={(id) => {
                if (id == null) setTool('eraser');
                else { setColorId(id); setTool('pencil'); }
              }}
            />
          </div>
          <div className="canvas-caption">
            {currentFrame && <>当前：<b>{dirName(currentFrame.dir)}</b> · 第 {frameIndexInDir + 1} 帧 · 镜像 {mirror === 'off' ? '关闭' : mirror.toUpperCase()} · {onion.enabled ? `洋葱皮 前${onion.back} 后${onion.forward}` : '洋葱皮关闭'}</>}
            <span className="shortcut-hint">B 画笔 · E 橡皮 · G 填充 · I 吸色 · X 镜像循环 · O 洋葱皮 · Ctrl+Z 撤销 · 右键吸色</span>
          </div>
        </main>

        <aside className="side-panels">
          <PalettePanel store={store} activeColor={colorId} onPick={(id) => { setColorId(id); if (tool === 'eraser') setTool('pencil'); }} />
          <PreviewPanel store={store} frameId={frameId} />
          <ExportPanel store={store} />
        </aside>
      </div>

      <Timeline store={store} frameId={frameId} onSelect={setFrameId} />

      {notice && (
        <div className="toast">
          <span>{notice}</span>
          <button onClick={() => setNotice('')}>×</button>
        </div>
      )}
    </div>
  );
}

function dirName(dir) {
  const map = { down: '下 ↓', downLeft: '左下 ↙', left: '左 ←', upLeft: '左上 ↖', up: '上 ↑', upRight: '右上 ↗', right: '右 →', downRight: '右下 ↘' };
  return map[dir] || dir;
}

function SyncBadge({ state, pending }) {
  const map = {
    idle: ['已同步', 'ok'],
    saved: ['已保存', 'ok'],
    queued: ['待同步', 'queued'],
    saving: ['增量提交中…', 'saving'],
    offline: [`离线${pending ? ` · ${pending} 个操作缓存中` : ''}`, 'offline'],
    recovering: ['冲突恢复中…', 'saving'],
    conflict: ['存在冲突', 'error'],
    error: ['同步失败，将重试', 'error']
  };
  const [text, kind] = map[state] || map.idle;
  return <span className={`sync-badge ${kind}`}><i />{text}</span>;
}

function ResizeBar({ store, onClose }) {
  const [w, setW] = useState(store.model.width);
  const [h, setH] = useState(store.model.height);
  return (
    <div className="resize-bar">
      <span>画布尺寸（像素）：</span>
      <label>宽 <input type="number" min="4" max="128" value={w} onChange={(e) => setW(Number(e.target.value))} /></label>
      <label>高 <input type="number" min="4" max="128" value={h} onChange={(e) => setH(Number(e.target.value))} /></label>
      <button className="btn tiny primary" onClick={() => {
        const cw = Math.max(4, Math.min(128, Math.round(w)));
        const ch = Math.max(4, Math.min(128, Math.round(h)));
        store.resize(cw, ch);
        onClose();
      }}>应用（左上角对齐，超出部分裁掉，可撤销）</button>
      <button className="btn tiny ghost" onClick={onClose}>取消</button>
    </div>
  );
}
