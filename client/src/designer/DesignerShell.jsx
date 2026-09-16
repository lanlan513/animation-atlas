import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, Cloud, LoaderCircle, RefreshCw, Save, X } from 'lucide-react';
import { CAMERA_META, CAMERA_TYPES, CLIP_DURATION } from '../constants.js';
import LibraryPanel from './LibraryPanel.jsx';
import Preview from './Preview.jsx';
import Timeline from './Timeline.jsx';
import Inspector from './Inspector.jsx';
import { useComputeWorker } from './useComputeWorker.js';
import {
  addCameraAction, addLayer, deleteCameraAction, deleteKeyframe, deleteLayer, emptyClip,
  findKeyframeOwner, renameLayer, updateCameraAction, updateCameraParams, updateKeyframe, upsertKeyframe
} from './clipFactory.js';

export default function DesignerShell({ project, user, api, onError, onExit }) {
  const [assets, setAssets] = useState([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [clip, setClip] = useState(() => emptyClip(`${project.name} · 十秒`));
  const [version, setVersion] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState(null);
  const [saveState, setSaveState] = useState('idle');
  const [conflict, setConflict] = useState(null);

  const saveTimer = useRef(0);
  const saveInFlight = useRef(false);
  const pendingSave = useRef(null);
  const versionRef = useRef(0);
  const clipRef = useRef(clip);
  clipRef.current = clip;
  versionRef.current = version;

  const { frame, workerReady } = useComputeWorker(clip, time);

  // ---------- 载入素材库与片段 ----------
  useEffect(() => {
    let cancelled = false;
    api('/library/assets').then((result) => {
      if (!cancelled) { setAssets(result.assets); setAssetsLoading(false); }
    }).catch(() => !cancelled && setAssetsLoading(false));
    api(`/projects/${project.id}/clip`, { headers: { 'x-user-id': user.id } }).then((result) => {
      if (cancelled) return;
      if (result.clip) { setClip(result.clip); setVersion(result.version); }
    }).catch(() => { /* 空片段也允许编辑 */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // ---------- 自动保存（乐观锁） ----------
  const persist = useCallback(async (document, expectedVersion) => {
    try {
      const result = await api(`/projects/${project.id}/clip`, {
        method: 'PUT',
        headers: { 'x-user-id': user.id },
        body: JSON.stringify({ clip: document, expectedVersion })
      });
      setVersion(result.version);
      setSaveState('saved');
      setConflict(null);
      if (pendingSave.current) {
        const next = pendingSave.current;
        pendingSave.current = null;
        persist(next, result.version);
      } else {
        saveInFlight.current = false;
      }
      return true;
    } catch (err) {
      saveInFlight.current = false;
      if (err.status === 409 && err.body?.code === 'VERSION_CONFLICT') {
        setSaveState('conflict');
        setConflict({ serverVersion: err.body.serverVersion, serverClip: err.body.serverClip });
        pendingSave.current = null; // 冲突期间的本地编辑不再偷偷重试，等用户选择解决方式
        setPlaying(false);
        return false;
      }
      setSaveState('error');
      onError(err.message);
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, project.id, user.id, onError]);

  const scheduleSave = useCallback((document) => {
    if (conflict) { pendingSave.current = document; return; } // 冲突未解决前只暂存最新本地文档
    if (saveInFlight.current) { pendingSave.current = document; return; }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveInFlight.current = true;
      setSaveState('saving');
      persist(document, versionRef.current);
    }, 500);
  }, [conflict, persist]);

  const mutate = useCallback((updater) => {
    setClip((current) => {
      const next = updater(current);
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const saveNow = useCallback(() => {
    clearTimeout(saveTimer.current);
    if (saveInFlight.current) { pendingSave.current = clipRef.current; return; }
    saveInFlight.current = true;
    setSaveState('saving');
    persist(clipRef.current, versionRef.current);
  }, [persist]);  // ---------- 播放 ----------
  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    let last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => {
        const next = t + dt;
        if (next >= CLIP_DURATION) { setPlaying(false); return CLIP_DURATION; }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // ---------- 键盘 ----------
  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.code === 'Space') { event.preventDefault(); setPlaying((p) => !p); }
      if (event.code === 'ArrowLeft') setTime((t) => Math.max(0, t - (event.shiftKey ? 1 : 0.1)));
      if (event.code === 'ArrowRight') setTime((t) => Math.min(CLIP_DURATION, t + (event.shiftKey ? 1 : 0.1)));
      if (event.code === 'Delete' || event.code === 'Backspace') {
        if (selection?.kind === 'keyframe') mutate((c) => deleteKeyframe(c, selection.keyframeId));
        if (selection?.kind === 'camera') mutate((c) => deleteCameraAction(c, selection.actionId));
        if (selection?.kind === 'layer') mutate((c) => deleteLayer(c, selection.layerId));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, mutate]);

  // ---------- 操作 ----------
  const handleAddAsset = (asset) => {
    mutate((current) => addLayer(current, asset, time).clip);
  };

  const handleAddKeyframeAt = (layerId, at) => {
    mutate((current) => upsertKeyframe(current, layerId, at, {}).clip);
  };

  const handleDragLayer = (layerId, xy) => {
    setPlaying(false);
    mutate((current) => upsertKeyframe(current, layerId, time, xy).clip);
  };

  const handleAddCamera = (type) => {
    const { clip: next, action } = addCameraAction(clipRef.current, type, time);
    mutate(() => next);
    setSelection({ kind: 'camera', actionId: action.id });
  };

  const scrub = useCallback((t, commit) => {
    setPlaying(false);
    if (t !== null) setTime(Math.round(t * 1000) / 1000);
    void commit;
  }, []);

  const activeLayerType = selection?.kind === 'layer'
    ? clip.layers.find((l) => l.id === selection.layerId)?.type
    : null;

  const saveStatus = useMemo(() => ({
    idle: ['编辑后自动保存', <Cloud size={15} key="c" />],
    saving: ['正在保存…', <LoaderCircle className="spin" size={15} key="s" />],
    saved: [`已保存 v${version}`, <Check size={15} key="ok" />],
    error: ['保存失败', <CircleAlert size={15} key="e" />],
    conflict: ['版本冲突', <CircleAlert size={15} key="cf" />]
  }[saveState]), [saveState, version]);

  return (
    <div className="designer">
      <div className="designer-bar">
        <button className="button ghost small" onClick={onExit}>← 项目列表</button>
        <div className="designer-title">
          <p className="eyebrow">SAKUGA SPARK / BATTLE SHOT DESIGNER</p>
          <h2>{project.name}</h2>
        </div>
        <input
          className="clip-name-input" value={clip.name} maxLength={60}
          onChange={(event) => mutate((current) => ({ ...current, name: event.target.value }))}
          aria-label="片段名称"
        />
        <div className="designer-bar-right">
          <span className={`worker-pill ${workerReady ? 'ready' : ''}`} title="关键帧计算运行在 Web Worker 中">
            <i />WORKER {workerReady ? 'READY' : 'BAKING'}
          </span>
          <span className={`save-status ${saveState}`}>{saveStatus[1]}{saveStatus[0]}</span>
          <button className="button secondary small" onClick={saveNow}><Save size={14} />保存</button>
        </div>
      </div>

      <div className="designer-layout">
        <LibraryPanel assets={assets} loading={assetsLoading} onAdd={handleAddAsset} activeLayerType={activeLayerType} />
        <section className="stage-column">
          <div className="camera-toolbar">
            <span className="tool-caption">镜头行为</span>
            {CAMERA_TYPES.map((type) => {
              const meta = CAMERA_META[type];
              return (
                <button key={type} className="cam-add" style={{ '--cam-color': meta.color }} onClick={() => handleAddCamera(type)}>
                  <i>{meta.glyph}</i>{meta.label}
                </button>
              );
            })}
            <span className="tool-tip">添加在播放头位置，可在时间轴上拖动 / 拉伸</span>
          </div>
          <Preview assets={assets} frame={frame} clip={clip} selection={selection} onSelect={setSelection} onDragLayer={handleDragLayer} playing={playing} />
          <Timeline
            clip={clip} time={time} playing={playing} selection={selection}
            onScrub={scrub} onSelect={setSelection} onTogglePlay={() => setPlaying((p) => !p)}
            onMoveKeyframe={(layerId, keyframeId, t) => mutate((c) => {
              const bounded = Math.max(0, Math.min(CLIP_DURATION, t));
              const others = c.layers.find((l) => l.id === layerId)?.keyframes.filter((k) => k.id !== keyframeId) || [];
              if (others.some((k) => Math.abs(k.time - bounded) < 0.001)) return c;
              return updateKeyframe(c, keyframeId, { time: bounded });
            })}
            onMoveCamera={(actionId, range) => mutate((c) => {
              if (range.end <= range.start) return c;
              return updateCameraAction(c, actionId, range);
            })}
            onAddKeyframe={(layerId, at) => mutate((c) => upsertKeyframe(c, layerId, at, {}).clip)}
          />
        </section>
        <Inspector
          clip={clip} selection={selection} time={time}
          onPatchKeyframe={(id, patch) => mutate((c) => {
            if (patch.time !== undefined) {
              const t = Math.max(0, Math.min(CLIP_DURATION, patch.time));
              const owner = findKeyframeOwner(c, id);
              if (!owner) return c;
              if (owner.layer.keyframes.some((k) => k.id !== id && Math.abs(k.time - t) < 0.001)) return c;
              return updateKeyframe(c, id, { ...patch, time: Math.round(t * 1000) / 1000 });
            }
            return updateKeyframe(c, id, patch);
          })}
          onPatchLayer={(id, patch) => mutate((c) => (patch.name !== undefined ? renameLayer(c, id, patch.name) : c))}
          onPatchCamera={(id, patch) => mutate((c) => updateCameraAction(c, id, patch))}
          onPatchCameraParams={(id, params) => mutate((c) => updateCameraParams(c, id, params))}
          onDeleteKeyframe={(id) => { mutate((c) => deleteKeyframe(c, id)); setSelection(null); }}
          onDeleteLayer={(id) => { mutate((c) => deleteLayer(c, id)); setSelection(null); }}
          onDeleteCamera={(id) => { mutate((c) => deleteCameraAction(c, id)); setSelection(null); }}
          onAddKeyframeAt={handleAddKeyframeAt}
        />
      </div>

      {conflict && <ConflictModal conflict={conflict} onReload={() => {
        if (conflict.serverClip) { setClip(conflict.serverClip); setVersion(conflict.serverVersion); }
        setConflict(null); setSaveState('saved');
      }} onForce={async () => {
        // 强制覆盖：以服务器版本号提交，服务端会把版本继续递增（对方改动被当前文档覆盖）
        const ok = await persist(clipRef.current, conflict.serverVersion);
        if (ok) setConflict(null);
      }} />}
    </div>
  );
}

function ConflictModal({ conflict, onReload, onForce }) {
  return (
    <div className="modal-backdrop">
      <div className="modal conflict-modal">
        <div className="conflict-icon"><RefreshCw size={22} /></div>
        <p className="eyebrow">OPTIMISTIC LOCK / 409</p>
        <h2>片段已在其他标签页被修改</h2>
        <p className="modal-note">
          服务端版本已经走到 v{conflict.serverVersion}，继续保存会覆盖另一个标签页的改动。
          你可以载入服务器版本，或以当前画面强制覆盖（版本号将跳到最新）。
        </p>
        <div className="modal-actions conflict-actions">
          <button className="button ghost" onClick={onReload}><RefreshCw size={15} />采用服务器版本</button>
          <button className="button primary" onClick={onForce}><X size={15} />放弃对方改动，强制保存</button>
        </div>
      </div>
    </div>
  );
}
