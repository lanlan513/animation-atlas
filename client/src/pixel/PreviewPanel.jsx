import React, { useEffect, useRef, useState } from 'react';
import { DIRECTIONS, DIR_LABELS, getFrame } from '../../../shared/pixel-core.js';
import { renderPreviewFrame } from './export.js';

export default function PreviewPanel({ store, frameId }) {
  const canvasRef = useRef(null);
  const [playing, setPlaying] = useState(true);
  const [fps, setFps] = useState(store.model.exportConfig?.fps || 8);
  const [dirMode, setDirMode] = useState('all'); // all | current
  const [zoom, setZoom] = useState(2);

  const frame = getFrame(store.model, frameId);
  const dir = frame?.dir || 'down';

  const groups = dirMode === 'current'
    ? [{ dir, frames: store.model.frames.filter((f) => f.dir === dir) }]
    : DIRECTIONS.map((d) => ({ dir: d, frames: store.model.frames.filter((f) => f.dir === d) })).filter((g) => g.frames.length > 0);

  // Current frame pointer across the (possibly multi-dir) sequence.
  const sequence = groups.flatMap((g) => g.frames);
  const [cursor, setCursor] = useState(0);
  const currentFrame = sequence[cursor % Math.max(1, sequence.length)];

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setCursor((c) => (c + 1) % Math.max(1, sequence.length)), Math.max(40, 1000 / Math.max(1, fps)));
    return () => clearInterval(id);
  }, [playing, fps, sequence.length]);

  useEffect(() => { setCursor((c) => Math.min(c, Math.max(0, sequence.length - 1))); }, [sequence.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !currentFrame) return;
    const size = 128;
    if (canvas.width !== size * 2) { canvas.width = size * 2; canvas.height = size * 2; }
    renderPreviewFrame(canvas, store.model, currentFrame);
  });

  return (
    <div className="preview-panel">
      <div className="panel-title">
        <span>即时预览</span>
        <span className="panel-count">{sequence.length} 帧 · {fps} FPS</span>
      </div>
      <div className="preview-stage">
        <canvas
          ref={canvasRef}
          className="preview-canvas"
          style={{ imageRendering: 'pixelated', width: 64 * zoom, height: 64 * zoom }}
        />
        <div className="preview-label">{currentFrame ? DIR_LABELS[getFrame(store.model, currentFrame.id)?.dir || dir] : ''}</div>
      </div>
      <div className="preview-controls">
        <button className={`btn tiny ${playing ? '' : 'primary'}`} onClick={() => setPlaying((p) => !p)}>{playing ? '⏸ 暂停' : '▶ 播放'}</button>
        <label className="fps-row">FPS
          <input type="range" min="1" max="24" value={fps} onChange={(e) => {
            const v = Number(e.target.value);
            setFps(v);
            store.saveExportConfig({ fps: v });
          }} />
          <code>{fps}</code>
        </label>
      </div>
      <div className="preview-modes">
        <button className={dirMode === 'all' ? 'chip selected' : 'chip'} onClick={() => setDirMode('all')}>全部方向</button>
        <button className={dirMode === 'current' ? 'chip selected' : 'chip'} onClick={() => setDirMode('current')}>仅当前方向</button>
      </div>
      <div className="preview-modes">
        <span className="mini-label">预览缩放</span>
        {[1, 2, 3, 4].map((z) => (
          <button key={z} className={zoom === z ? 'chip selected' : 'chip'} onClick={() => setZoom(z)}>{z}×</button>
        ))}
      </div>
      <p className="panel-hint">播放循环仅用于预览；导出尺寸在右侧精灵图面板中设置，像素始终保持硬边。</p>
    </div>
  );
}
