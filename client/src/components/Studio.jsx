import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, CircleAlert, Cloud, Copy, Film, LoaderCircle, Play, Trash2, UploadCloud } from 'lucide-react';
import { api, uploadFrame } from '../api.js';
import { Topbar } from './Home.jsx';
import CameraStage from './CameraStage.jsx';
import ImportStage from './ImportStage.jsx';
import Timeline from './Timeline.jsx';
import Player from './Player.jsx';
import QuotaBar from './QuotaBar.jsx';
import FrameToolbar, { GhostControl } from './FrameToolbar.jsx';
import { formatDuration } from '../lib/image.js';

const DEFAULT_SETTINGS = {
  tab: 'camera',          // camera | import
  ghostVisible: true,
  ghostOpacity: 0.5,
  ghostId: null,          // 指定残影基准帧；null 表示自动取最后一帧
  selectedIds: [],
  defaultMs: 130
};

export default function Studio({ user, projectId, onClose, onError }) {
  const [project, setProject] = useState(null);
  const [frames, setFrames] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState('idle');
  const [showPlayer, setShowPlayer] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // 首次打开拍摄台、且摄像头不可用时允许自动降级；之后手动切回不再自动跳走。
  const manualCameraRef = useRef(false);

  const framesRef = useRef(frames);
  framesRef.current = frames;

  // ---------- 载入：帧序列 + 草稿设置都要回来，编辑进度完整还原 ----------
  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    api(`/projects/${projectId}`)
      .then((result) => {
        if (cancelled) return;
        setProject(result.project);
        const ordered = (result.project.frames || []).slice().sort((a, b) => a.order - b.order);
        setFrames(ordered);
        const restored = { ...DEFAULT_SETTINGS, ...(result.project.draft?.content?.settings || {}) };
        // 还原时清掉已不存在帧的残影/选择
        const ids = new Set(ordered.map((frame) => frame.id));
        restored.ghostId = ids.has(restored.ghostId) ? restored.ghostId : null;
        restored.selectedIds = (restored.selectedIds || []).filter((id) => ids.has(id));
        restored.tab = restored.tab === 'import' ? 'import' : 'camera';
        setSettings(restored);
      })
      .catch((error) => { if (!cancelled) setLoadError(error.message); });
    return () => { cancelled = true; };
  }, [projectId, reloadKey]);

  // ---------- 设置自动保存（防抖），重开项目时还原 ----------
  const saveTimer = useRef(null);
  const persistSettings = useCallback((nextSettings) => {
    setSaveState('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api(`/projects/${projectId}/drafts`, { method: 'PUT', body: { content: { settings: nextSettings } } });
        setSaveState('saved');
      } catch (error) {
        setSaveState('error');
        onError(error.message);
      }
    }, 600);
  }, [onError, projectId]);

  const updateSettings = useCallback((patch, { persist = true } = {}) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      if (persist) persistSettings(next);
      return next;
    });
  }, [persistSettings]);

  const switchTab = (nextTab, message = '', { manual = true } = {}) => {
    if (manual && nextTab === 'camera') manualCameraRef.current = true;
    updateSettings({ tab: nextTab });
    if (message) onError(message, 'info');
  };

  // ---------- 帧操作 ----------
  const handleCapture = useCallback(async (blob) => {
    if (busy) return null;
    setBusy(true);
    try {
      const result = await uploadFrame(projectId, blob, { durationMs: settings.defaultMs });
      setFrames((current) => [...current, result.frame]);
      setProject((p) => p && ({ ...p, usageBytes: result.usageBytes, quotaBytes: result.quotaBytes }));
      return result;
    } catch (error) {
      onError(error.message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy, onError, projectId, settings.defaultMs]);

  const reorder = useCallback(async (orders) => {
    // 乐观更新
    const orderById = new Map(orders.map((item) => [item.id, item.order]));
    setFrames((current) => current.slice().sort((a, b) => orderById.get(a.id) - orderById.get(b.id)));
    try {
      const result = await api(`/projects/${projectId}/frames/order`, { method: 'PUT', body: { orders } });
      const byId = new Map(result.frames.map((item) => [item.id, item]));
      setFrames((current) => current.map((frame) => byId.has(frame.id) ? { ...frame, order: byId.get(frame.id).order } : frame)
        .sort((a, b) => a.order - b.order));
    } catch (error) {
      onError(error.message);
      setReloadKey((key) => key + 1);
    }
  }, [onError, projectId]);

  const duplicateFrame = useCallback(async (frameId) => {
    try {
      const result = await api(`/projects/${projectId}/frames/${frameId}/duplicate`, { method: 'POST' });
      setFrames((current) => {
        const next = [...current, result.frame];
        return next.sort((a, b) => a.order - b.order);
      });
      setProject((p) => p && ({ ...p, usageBytes: result.usageBytes }));
    } catch (error) {
      onError(error.message);
    }
  }, [onError, projectId]);

  const deleteFrame = useCallback(async (frameId) => {
    try {
      const result = await api(`/projects/${projectId}/frames/${frameId}`, { method: 'DELETE' });
      setFrames((current) => {
        const removed = current.find((frame) => frame.id === frameId);
        const next = current.filter((frame) => frame.id !== frameId)
          .map((frame) => frame.order > removed.order ? { ...frame, order: frame.order - 1 } : frame);
        return next;
      });
      setProject((p) => p && ({ ...p, usageBytes: result.usageBytes }));
      updateSettings({
        selectedIds: settings.selectedIds.filter((id) => id !== frameId),
        ghostId: settings.ghostId === frameId ? null : settings.ghostId
      });
    } catch (error) {
      onError(error.message);
    }
  }, [onError, projectId, settings.ghostId, settings.selectedIds, updateSettings]);

  // ---------- 多选 ----------
  const selectFrames = useCallback((ids, additive, range) => {
    const currentFrames = framesRef.current;
    const [id] = ids;
    let next;
    if (range && settings.selectedIds.length > 0) {
      const anchorId = settings.selectedIds[settings.selectedIds.length - 1];
      const anchorIndex = currentFrames.findIndex((frame) => frame.id === anchorId);
      const targetIndex = currentFrames.findIndex((frame) => frame.id === id);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [from, to] = [anchorIndex, targetIndex].sort((a, b) => a - b);
        next = currentFrames.slice(from, to + 1).map((frame) => frame.id);
      } else next = [id];
    } else if (additive) {
      next = settings.selectedIds.includes(id)
        ? settings.selectedIds.filter((item) => item !== id)
        : [...settings.selectedIds, id];
    } else {
      next = ids;
    }
    updateSettings({ selectedIds: next });
  }, [settings.selectedIds, updateSettings]);

  // ---------- 批量操作 ----------
  const batchDuration = useCallback(async (durationMs) => {
    const frameIds = settings.selectedIds;
    try {
      const result = await api(`/projects/${projectId}/frames`, { method: 'PATCH', body: { frameIds, durationMs } });
      const msById = new Map(result.frames.map((item) => [item.id, item.durationMs]));
      setFrames((current) => current.map((frame) => msById.has(frame.id) ? { ...frame, durationMs: msById.get(frame.id) } : frame));
    } catch (error) {
      onError(error.message);
    }
  }, [onError, projectId, settings.selectedIds]);

  const batchDelete = useCallback(async () => {
    const ids = settings.selectedIds;
    if (ids.length === 0) return;
    if (!confirm(`确定删除选中的 ${ids.length} 帧吗？`)) return;
    for (const id of ids) {
      // 串行删除，服务端 order 每次重排
      // eslint-disable-next-line no-await-in-loop
      await api(`/projects/${projectId}/frames/${id}`, { method: 'DELETE' }).catch((error) => onError(error.message));
    }
    setReloadKey((key) => key + 1);
    updateSettings({ selectedIds: [], ghostId: ids.includes(settings.ghostId) ? null : settings.ghostId });
  }, [onError, projectId, settings.ghostId, settings.selectedIds, updateSettings]);

  const batchDuplicate = useCallback(async () => {
    const ids = settings.selectedIds;
    if (ids.length === 0) return;
    // 按当前序列从后往前复制：每次副本插在源帧之后，最终形成「原选中块 + 副本块」。
    const orderedIds = frames.filter((frame) => ids.includes(frame.id)).map((frame) => frame.id);
    for (let i = orderedIds.length - 1; i >= 0; i--) {
      // eslint-disable-next-line no-await-in-loop
      await duplicateFrame(orderedIds[i]);
    }
  }, [duplicateFrame, frames, settings.selectedIds]);

  // ---------- 残影基准：默认自动取最后一帧 ----------
  const ghostFrame = useMemo(() => {
    if (!settings.ghostVisible) return null;
    if (settings.ghostId) return frames.find((frame) => frame.id === settings.ghostId) || null;
    return frames.length > 0 ? frames[frames.length - 1] : null;
  }, [frames, settings.ghostId, settings.ghostVisible]);

  const totalMs = useMemo(() => frames.reduce((sum, frame) => sum + frame.durationMs, 0), [frames]);
  const selectedMs = useMemo(() => {
    const selected = frames.filter((frame) => settings.selectedIds.includes(frame.id));
    if (selected.length === 0) return null;
    const values = new Set(selected.map((frame) => frame.durationMs));
    return values.size === 1 ? selected[0].durationMs : null;
  }, [frames, settings.selectedIds]);

  if (loadError && !project) {
    return (
      <div className="app-shell">
        <Topbar user={user} onClose={onClose} />
        <div className="screen-state">
          <CircleAlert size={26} />
          <span>打不开这个项目：{loadError}</span>
          <button className="button ghost" onClick={onClose}>返回首页</button>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="app-shell">
        <Topbar user={user} onClose={onClose} />
        <div className="screen-state"><LoaderCircle className="spin" size={26} /><span>正在还原拍摄进度…</span></div>
      </div>
    );
  }

  return (
    <div className="app-shell studio-shell">
      <Topbar user={user} onClose={onClose} />
      <main className="studio-content">
        <header className="studio-head">
          <div className="studio-title">
            <p className="eyebrow">FRAME-MOLD / 定格动画</p>
            <h2>{project.name}</h2>
            <div className="studio-stats">
              <span><Film size={13} />{frames.length} 帧</span>
              <span><ClockIcon />{formatDuration(totalMs)}</span>
              <SaveState state={saveState} />
            </div>
          </div>
          <div className="studio-head-actions">
            <GhostControl
              ghostId={settings.ghostId}
              frames={frames}
              ghostVisible={settings.ghostVisible}
              opacity={settings.ghostOpacity}
              onSetGhost={(ghostId) => updateSettings({ ghostId })}
              onToggleVisible={(ghostVisible) => updateSettings({ ghostVisible })}
              onOpacity={(ghostOpacity) => updateSettings({ ghostOpacity })}
            />
            <button className="button secondary" onClick={() => setShowPlayer(true)} disabled={frames.length === 0}>
              <Play size={15} />播放成片
            </button>
          </div>
        </header>

        <div className="studio-tabs" role="tablist">
          <button role="tab" className={settings.tab === 'camera' ? 'active' : ''} onClick={() => switchTab('camera')}>
            <Camera size={15} />摄像头拍摄
          </button>
          <button role="tab" className={settings.tab === 'import' ? 'active' : ''} onClick={() => switchTab('import')}>
            <UploadCloud size={15} />导入图片
          </button>
          <span className="tab-hint">
            {settings.tab === 'camera'
              ? '摄像头权限被拒绝时会自动切换到「导入图片」。'
              : '逐张压缩上传；也可随时切回摄像头。'}
          </span>
        </div>

        <section className="studio-stage">
          {settings.tab === 'camera' ? (
            <CameraStage
              key="camera"
              frames={frames}
              ghostFrame={ghostFrame}
              settings={settings}
              busy={busy}
              autoFallback={!manualCameraRef.current}
              onCapture={handleCapture}
              onSwitchImport={(message) => switchTab('import', message, { manual: false })}
              onNotice={(msg) => onError(msg, 'info')}
            />
          ) : (
            <ImportStage
              busy={busy}
              onImport={handleCapture}
              onNotice={onError}
            />
          )}
        </section>

        <section className="timeline-section">
          <div className="timeline-head">
            <p className="eyebrow">TIMELINE / 时间尺</p>
            <QuotaBar usageBytes={project.usageBytes || 0} quotaBytes={project.quotaBytes} frameCount={frames.length} />
          </div>
          <Timeline
            frames={frames}
            selectedIds={settings.selectedIds}
            ghostId={ghostFrame?.id}
            onSelect={selectFrames}
            onReorder={reorder}
            onDuplicate={duplicateFrame}
            onDelete={deleteFrame}
            disabled={busy}
          />
          {settings.selectedIds.length > 0 && (
            <FrameToolbar
              selectionCount={settings.selectedIds.length}
              totalCount={frames.length}
              commonMs={selectedMs}
              onBatchDuration={batchDuration}
              onBatchDuplicate={batchDuplicate}
              onBatchDelete={batchDelete}
              onClearSelection={() => updateSettings({ selectedIds: [] })}
            />
          )}
          {frames.length === 0 && (
            <div className="timeline-actions-empty">
              <Copy size={13} /><Trash2 size={13} />
              <span>有帧之后：拖拽缩略图排序，单击/Shift 连选/Ctrl 点选，批量改时长，或复制、删除。</span>
            </div>
          )}
        </section>
      </main>

      {showPlayer && <Player frames={frames} onClose={() => setShowPlayer(false)} />}
    </div>
  );
}

function ClockIcon() {
  return <span className="ms-dot" style={{ width: 13, height: 13, display: 'inline-flex' }}>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>
  </span>;
}

function SaveState({ state }) {
  const map = {
    idle: ['编辑后自动保存', <Cloud size={13} key="c" />],
    saving: ['正在保存…', <LoaderCircle className="spin" size={13} key="l" />],
    saved: ['进度已保存', <Check size={13} key="s" />],
    error: ['保存失败', <CircleAlert size={13} key="e" />]
  };
  const [text, icon] = map[state] || map.idle;
  return <span className={`save-status ${state}`}>{icon}{text}</span>;
}
