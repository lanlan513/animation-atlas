import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle, Check, ChevronDown, Cloud, Download, FilePlus2, GripVertical,
  Layers, LoaderCircle, Lock, Plus, Save, Shuffle, Sparkles, Swords, Trash2, Wand2, X
} from 'lucide-react';
import PosterCanvas, { serializeCurrentSvg } from './components/PosterCanvas.jsx';
import ImpactControls, { LayerPanel, Slider } from './components/Controls.jsx';
import ImpactArt, { ART_HEIGHT, ART_WIDTH } from './components/ImpactArt.jsx';
import DuelPage from './duel/DuelPage.jsx';
import { createPoster, getGuest, listPosters, loadPoster, savePoster } from './api.js';
import {
  PANEL_LIMITS, createImpact, createImpactLayer, createPoster as defaultPoster,
  randomSeed, sanitizeComicText, sanitizeName, sanitizePoster
} from '../../shared/panel-punch-core.js';
import './styles.css';

const PRESET_WORDS = ['BAM', 'POW', 'CRASH', 'KAPOW', 'ZAP', 'WHAM'];

function detectAdvancedFilters() {
  if (typeof window === 'undefined') return true;
  const ua = window.navigator.userAgent;
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  if (!isSafari) return true;
  const version = Number(ua.match(/Version\/(\d+)/)?.[1] || 0);
  // feTurbulence/feDisplacementMap are historically unreliable on Safari; the
  // offset/duplicate fallback still communicates hand-printed roughness.
  return version >= 17 && typeof SVGElement !== 'undefined' && 'feTurbulence' in window;
}

function App() {
  const [user, setUser] = useState(null);
  const [bootState, setBootState] = useState('loading');
  const [error, setError] = useState('');
  const [mode, setMode] = useState('workshop');
  const [posters, setPosters] = useState([]);
  const [posterId, setPosterId] = useState(null);
  const [poster, setPoster] = useState(null);
  const [revision, setRevision] = useState(0);
  const [saveState, setSaveState] = useState('idle');
  const [workshopText, setWorkshopText] = useState('POW');
  const [advancedFilters, setAdvancedFilters] = useState(true);
  const frameRef = useRef(null);

  const timerRef = useRef(null);
  const saveQueueRef = useRef(Promise.resolve());
  const latestRef = useRef(null);
  const pendingRef = useRef(false);

  latestRef.current = poster;

  useEffect(() => {
    setAdvancedFilters(detectAdvancedFilters());
  }, []);

  const flashError = useCallback((message) => {
    setError(message);
    window.clearTimeout(flashError.timer);
    flashError.timer = window.setTimeout(() => setError(''), 4200);
  }, []);

  const applyServerPoster = useCallback((serverPoster, serverRevision) => {
    const clean = sanitizePoster(serverPoster);
    setPoster(clean);
    setRevision(serverRevision || 0);
    pendingRef.current = false;
    return clean;
  }, []);

  useEffect(() => {
    let alive = true;
    getGuest()
      .then((guest) => listPosters().then((items) => ({ guest, items })))
      .then(async ({ guest, items }) => {
        if (!alive) return;
        setUser(guest);
        setPosters(items);
        if (items[0]) {
          const result = await loadPoster(items[0].id);
          if (!alive) return;
          setPosterId(items[0].id);
          applyServerPoster(result.poster, result.revision);
        } else {
          const result = await createPoster(defaultPoster({ name: '第一页动作海报' }));
          if (!alive) return;
          setPosters([result.record]);
          setPosterId(result.record.id);
          applyServerPoster(result.poster, result.record.revision);
        }
        setBootState('ready');
      })
      .catch((err) => {
        if (!alive) return;
        // Backend may still be starting: keep a deterministic local document
        // instead of blocking the whole editor.
        const local = sanitizePoster(defaultPoster({ name: '离线动作海报' }));
        setPoster(local);
        setPosterId(null);
        setRevision(0);
        setBootState('ready');
        flashError(`${err.message} 已进入离线草稿，恢复后端后请刷新。`);
      });
    return () => { alive = false; };
  }, [applyServerPoster, flashError]);

  const flushSave = useCallback(async (useKeepalive = false) => {
    const current = latestRef.current;
    if (!posterId || !current || !pendingRef.current) return;
    window.clearTimeout(timerRef.current);
    setSaveState('saving');
    const payload = sanitizePoster({ ...current, updatedAt: new Date().toISOString() });
    pendingRef.current = false;

    try {
      // keepalive lets the final flush survive tab close / page refresh while
      // still carrying the x-user-id auth header (sendBeacon cannot).
      const result = await savePoster(posterId, payload, revision, { keepalive: useKeepalive });
      setRevision(result.revision);
      setSaveState('saved');
      setPosters((items) => items.map((item) => item.id === posterId
        ? { ...item, name: result.poster.name, width: result.poster.width, height: result.poster.height, revision: result.revision, updatedAt: result.updatedAt }
        : item));
    } catch (err) {
      pendingRef.current = true;
      setSaveState('error');
      if (err.status === 409 && err.body?.poster) {
        applyServerPoster(err.body.poster, err.body.revision);
        flashError('检测到其他标签页更新，服务器版本已载入，未合并本次冲突操作。');
      } else {
        flashError(err.message);
      }
    }
  }, [applyServerPoster, flashError, posterId, revision]);

  const queueSave = useCallback(() => {
    if (!posterId) { setSaveState('idle'); return; }
    pendingRef.current = true;
    setSaveState('queued');
    window.clearTimeout(timerRef.current);
    // Frequent mousemoves only reset this timer; requests are coalesced and the
    // prior request must finish before a newer revision is sent.
    timerRef.current = window.setTimeout(() => {
      saveQueueRef.current = saveQueueRef.current.then(() => flushSave()).catch(() => {});
    }, 420);
  }, [flushSave, posterId]);

  useEffect(() => () => {
    window.clearTimeout(timerRef.current);
    flushSave(true);
  }, [flushSave]);

  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') flushSave(true); };
    window.addEventListener('beforeunload', () => flushSave(true));
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [flushSave]);

  const updatePoster = useCallback((producer, shouldSave = true) => {
    setPoster((current) => {
      const next = sanitizePoster(typeof producer === 'function' ? producer(current) : producer);
      return next;
    });
    if (shouldSave) queueSave();
  }, [queueSave]);

  const activeLayer = useMemo(
    () => poster?.layers.find((layer) => layer.id === poster.activeLayerId) || poster?.layers.find((layer) => layer.kind === 'impact'),
    [poster]
  );

  const addWorkshopToPoster = useCallback((overrides, point = null) => {
    if (!poster) return;
    const impact = createImpact({ text: workshopText, seed: randomSeed(), ...overrides });
    const layer = createImpactLayer({
      impact,
      name: `${impact.text} ${poster.layers.filter((item) => item.kind === 'impact').length + 1}`,
      x: point ? point.x : Math.round(poster.width / 2),
      y: point ? point.y : Math.round(poster.height / 2),
      scale: 0.82
    });
    updatePoster((current) => sanitizePoster({
      ...current,
      activeLayerId: layer.id,
      layers: [...current.layers, layer]
    }));
  }, [poster, updatePoster, workshopText]);

  const patchActiveImpact = useCallback((impactPatch) => {
    updatePoster((current) => ({
      ...current,
      layers: current.layers.map((layer) => layer.id === current.activeLayerId && layer.kind === 'impact'
        ? { ...layer, name: layer.name === layer.impact.text ? impactPatch.text : layer.name, impact: { ...layer.impact, ...impactPatch } }
        : layer)
    }));
  }, [updatePoster]);

  const duplicateLayer = useCallback(() => {
    if (!activeLayer) return;
    const copy = createImpactLayer({
      ...activeLayer,
      id: undefined,
      impact: { ...activeLayer.impact },
      x: activeLayer.x + 34,
      y: activeLayer.y - 28,
      name: `${activeLayer.impact.text} 副本`,
      locked: false
    });
    updatePoster((current) => ({ ...current, activeLayerId: copy.id, layers: [...current.layers, copy] }));
  }, [activeLayer, updatePoster]);

  const deleteLayer = useCallback((id = activeLayer?.id) => {
    updatePoster((current) => {
      const layers = current.layers.filter((layer) => layer.kind === 'background' || layer.id !== id);
      const activeLayerId = current.activeLayerId === id ? layers.find((layer) => layer.kind === 'impact')?.id : current.activeLayerId;
      return { ...current, layers, activeLayerId };
    });
  }, [activeLayer?.id, updatePoster]);

  const moveLayerOrder = useCallback((id, direction) => {
    updatePoster((current) => {
      const index = current.layers.findIndex((layer) => layer.id === id);
      const target = index + direction;
      if (index < 0 || target <= 0 || target >= current.layers.length) return current;
      const layers = [...current.layers];
      const [layer] = layers.splice(index, 1);
      layers.splice(target, 0, layer);
      return { ...current, layers };
    });
  }, [updatePoster]);

  const moveLayerPosition = useCallback((id, x, y) => {
    updatePoster((current) => ({
      ...current,
      layers: current.layers.map((layer) => layer.id === id ? { ...layer, x, y } : layer)
    }));
  }, [updatePoster]);

  const selectLayer = useCallback((id) => {
    updatePoster((current) => ({ ...current, activeLayerId: id }), false);
  }, [updatePoster]);

  const toggleLayer = useCallback((key, id) => {
    updatePoster((current) => ({
      ...current,
      layers: current.layers.map((layer) => layer.id === id ? { ...layer, [key]: !layer[key] } : layer)
    }));
  }, [updatePoster]);

  const renameLayer = useCallback((id, name) => {
    updatePoster((current) => ({
      ...current,
      layers: current.layers.map((layer) => layer.id === id ? { ...layer, name: sanitizeName(name) } : layer)
    }));
  }, [updatePoster]);

  const newPoster = async () => {
    await flushSave();
    const result = await createPoster(defaultPoster({ name: `动作海报 ${posters.length + 1}` }));
    setPosters((items) => [result.record, ...items]);
    setPosterId(result.record.id);
    applyServerPoster(result.poster, result.record.revision);
  };

  const switchPoster = async (id) => {
    if (id === posterId) return;
    await flushSave();
    const result = await loadPoster(id);
    setPosterId(id);
    applyServerPoster(result.poster, result.revision);
  };

  const exportFile = async (format) => {
    if (!poster || !frameRef.current) return;
    const scale = poster.exportConfig.scale;
    updatePoster((current) => ({
      ...current,
      exportConfig: { ...current.exportConfig, format, lastExport: { format, at: new Date().toISOString() } }
    }), true);

    const svgNode = frameRef.current.querySelector('svg');
    const source = serializeCurrentSvg(svgNode, poster);
    if (format === 'svg') {
      downloadBlob(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }), `${sanitizeName(poster.name) || 'panel-punch'}.svg`);
      return;
    }

    try {
      const image = new Image();
      const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('SVG 栅格化失败，请改用 SVG 导出。'));
        image.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = poster.width * scale;
      canvas.height = poster.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => downloadBlob(blob, `${sanitizeName(poster.name) || 'panel-punch'}.png`), 'image/png');
    } catch (err) {
      flashError(err.message);
    }
  };

  if (bootState === 'loading') {
    return <div className="screen-state"><LoaderCircle className="spin" size={28} /><strong>PANEL PUNCH</strong><span>正在还原随机种子与图层关系…</span></div>;
  }

  const workshopImpact = createImpact({ text: sanitizeComicText(workshopText) || 'POW', seed: 4242 });

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Sparkles size={17} /></div><strong>PANEL PUNCH</strong><span>{mode === 'duel' ? '英雄双人对决' : '超级英雄冲击字工坊'}</span></div>
        <nav className="mode-switch">
          <button className={mode === 'workshop' ? 'active' : ''} onClick={() => setMode('workshop')}><Wand2 size={14} />冲击字工坊</button>
          <button className={mode === 'duel' ? 'active' : ''} onClick={() => setMode('duel')}><Swords size={14} />英雄对决</button>
        </nav>
        <div className="top-actions">
          {mode === 'workshop' && <SaveBadge state={saveState} />}
          {mode === 'workshop' && <button className="comic-button" onClick={newPoster}><FilePlus2 size={15} />新海报</button>}
        </div>
      </header>

      {mode === 'duel' ? (
        <DuelPage user={user} flashError={flashError} />
      ) : (
      <main className="workspace-shell">
        <aside className="sidebar">
          <section className="side-block poster-switcher">
            <div className="side-heading"><span>作品</span><ChevronDown size={14} /></div>
            {posters.map((item) => (
              <button key={item.id} className={item.id === posterId ? 'active' : ''} onClick={() => switchPoster(item.id)}>
                <GripVertical size={13} />
                <span>{sanitizeName(item.name)}</span>
                <small>v{String(item.revision || 0).padStart(2, '0')}</small>
              </button>
            ))}
            {!posterId && <button className="active offline"><GripVertical size={13} /><span>离线草稿</span><small>LOCAL</small></button>}
          </section>

          <section className="side-block workshop" draggable onDragStart={(event) => {
            event.dataTransfer.setData('application/x-panel-punch', JSON.stringify(workshopImpact));
            event.dataTransfer.effectAllowed = 'copy';
          }}>
            <div className="side-heading"><span>冲击字工坊</span><Shuffle size={14} /></div>
            <input
              className="word-input"
              value={workshopText}
              maxLength={PANEL_LIMITS.text}
              onChange={(event) => setWorkshopText(sanitizeComicText(event.target.value))}
              placeholder="BAM / POW / CRASH"
            />
            <div className="preset-row">
              {PRESET_WORDS.map((word) => <button key={word} onClick={() => setWorkshopText(word)}>{word}</button>)}
            </div>
            <div className="mini-art">
              <svg viewBox={`0 0 ${ART_WIDTH} ${ART_HEIGHT}`}><ImpactArt spec={workshopImpact} filterId="workshop-filter" advancedFilters={advancedFilters} /></svg>
            </div>
            <p className="drag-help">拖到海报，或直接添加为新图层。超长字符会在输入、前端状态和后端三处截断。</p>
            <button className="comic-button wide" onClick={() => addWorkshopToPoster()}><Plus size={16} />添加到动作海报</button>
          </section>

          <section className="side-block safari-panel">
            <label>
              <input type="checkbox" checked={advancedFilters} onChange={(event) => setAdvancedFilters(event.target.checked)} />
              启用 SVG turbulence 高级滤镜
            </label>
            <p>Safari 不稳定时自动关闭，并保留错位/重影兼容效果。</p>
          </section>
        </aside>

        <section className="stage-area">
          <div className="stage-toolbar">
            <div>
              <input className="poster-name" value={poster?.name || ''} maxLength={60} onChange={(event) => updatePoster((current) => ({ ...current, name: sanitizeName(event.target.value) }))} />
              <p>{poster?.width} × {poster?.height} · seed #{poster?.seed} · 所有编辑保存为 SVG 参数而不是位图</p>
            </div>
            <div className="export-tools">
              <select value={poster?.exportConfig.scale || 2} onChange={(event) => updatePoster((current) => ({ ...current, exportConfig: { ...current.exportConfig, scale: Number(event.target.value) } }))}>
                <option value={1}>1× PNG</option>
                <option value={2}>2× PNG</option>
                <option value={3}>3× PNG</option>
                <option value={4}>4× PNG</option>
              </select>
              <button onClick={() => exportFile('svg')}><Download size={15} />SVG</button>
              <button className="primary" onClick={() => exportFile('png')}><Download size={15} />PNG</button>
            </div>
          </div>

          <div className="canvas-and-layers">
            <div className="canvas-wrap">
              <PosterCanvas
                ref={frameRef}
                poster={poster}
                selectedId={poster?.activeLayerId}
                advancedFilters={advancedFilters}
                onSelect={selectLayer}
                onMoveLayer={moveLayerPosition}
                onDropWorkshop={(spec, point) => addWorkshopToPoster(spec, point)}
              />
              <div className="canvas-caption"><Layers size={14} />拖放工坊词块；选中图层后可移动。锁定图层不会响应画布拖拽。</div>
            </div>
            <aside className="layer-sidebar">
              <h2><Layers size={16} /> 图层顺序</h2>
              <LayerPanel
                poster={poster}
                selectedId={poster.activeLayerId}
                onSelect={selectLayer}
                onMove={moveLayerOrder}
                onToggleLock={(id) => toggleLayer('locked', id)}
                onToggleHidden={(id) => toggleLayer('visible', id)}
                onRename={renameLayer}
              />
              {activeLayer?.locked && <div className="locked-note"><Lock size={14} />图层已锁定，仍可在右侧重新编辑参数。</div>}
            </aside>
          </div>

          <div className="poster-controls">
            <Slider label="选中图层缩放" value={Math.round((activeLayer?.scale || 1) * 100) / 100} min={0.2} max={3} step={0.05} onChange={(scale) => updatePoster((current) => ({ ...current, layers: current.layers.map((layer) => layer.id === current.activeLayerId ? { ...layer, scale } : layer) }))} />
            <Slider label="旋转" value={activeLayer?.rotation || 0} min={-180} max={180} suffix="°" onChange={(rotation) => updatePoster((current) => ({ ...current, layers: current.layers.map((layer) => layer.id === current.activeLayerId ? { ...layer, rotation } : layer) }))} />
            <Slider label="背景样式种子" value={poster?.seed || 0} min={0} max={999999} onChange={(seed) => updatePoster((current) => ({ ...current, seed }))} />
          </div>
        </section>

        <aside className="inspector">
          {activeLayer?.kind === 'impact' ? (
            <>
              <ImpactControls
                layer={activeLayer}
                onChange={patchActiveImpact}
                onDuplicate={duplicateLayer}
                onDelete={() => deleteLayer(activeLayer.id)}
                canDelete
              />
              <button className="text-button danger-text" onClick={() => deleteLayer(activeLayer.id)}><Trash2 size={14} />删除当前冲击字</button>
            </>
          ) : (
            <div className="control-panel">
              <div className="control-title"><span>背景层</span></div>
              <p className="muted">背景默认锁定以避免误拖。可在图层面板隐藏、解锁或排序。</p>
              <select value={poster?.layers[0]?.background?.type || 'radial'} onChange={(event) => updatePoster((current) => ({ ...current, layers: current.layers.map((layer) => layer.kind === 'background' ? { ...layer, background: { ...layer.background, type: event.target.value } } : layer) }))}>
                <option value="radial">径向网点纸</option>
                <option value="speed">Canvas 速度线</option>
                <option value="halftone">密集半色调</option>
              </select>
            </div>
          )}
        </aside>
      </main>
      )}

      {error && <div className="toast error"><AlertTriangle size={17} /><span>{error}</span><button onClick={() => setError('')}><X size={16} /></button></div>}
    </div>
  );
}

function SaveBadge({ state }) {
  const map = {
    idle: ['已同步', <Cloud size={15} />],
    queued: ['自动保存排队', <Save size={15} />],
    saving: ['保存 SVG 参数…', <LoaderCircle className="spin" size={15} />],
    saved: ['已保存 / 可刷新还原', <Check size={15} />],
    error: ['保存失败，稍后重试', <AlertTriangle size={15} />]
  };
  const [text, icon] = map[state] || map.idle;
  return <span className={`save-badge ${state}`}>{icon}{text}</span>;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

createRoot(document.getElementById('root')).render(<App />);
