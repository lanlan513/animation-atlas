import React, { useEffect, useState } from 'react';
import { Clock3, Copy, Layers, ScanEye, Trash2, X } from 'lucide-react';

// 选中帧的批量工具条：统一改时长、批量复制/删除。
// 时长支持直接填毫秒，也支持按帧率换算。
export default function FrameToolbar({ selectionCount, totalCount, commonMs, onBatchDuration, onBatchDuplicate, onBatchDelete, onClearSelection }) {
  const [ms, setMs] = useState(commonMs ?? 130);
  const [fps, setFps] = useState(12);

  useEffect(() => { setMs(commonMs ?? Math.round(1000 / fps)); }, [commonMs, fps]);

  const applyMs = () => onBatchDuration(Number(ms));
  const applyFps = (value) => {
    const nextFps = Math.min(60, Math.max(1, Number(value) || 1));
    setFps(nextFps);
    onBatchDuration(Math.round(1000 / nextFps));
  };

  return (
    <div className="frame-toolbar">
      <span className="selection-pill">
        <Layers size={13} />
        已选 {selectionCount} / {totalCount} 帧
        <button className="plain-link" onClick={onClearSelection} title="清除选择"><X size={12} /></button>
      </span>
      <div className="duration-control">
        <Clock3 size={13} />
        <input type="number" min={40} max={5000} step={10} value={ms} onChange={(event) => setMs(event.target.value)} />
        <span>ms / 帧</span>
        <button className="button secondary tiny" onClick={applyMs}>应用</button>
        <span className="control-divider" />
        <input className="fps-input" type="number" min={1} max={60} value={fps} onChange={(event) => applyFps(event.target.value)} />
        <span>fps（自动换算）</span>
      </div>
      <div className="toolbar-spacer" />
      <button className="button secondary tiny" onClick={onBatchDuplicate} title="按当前顺序复制选中帧并插在后面"><Copy size={13} />复制选中</button>
      <button className="button danger tiny" onClick={onBatchDelete}><Trash2 size={13} />删除选中</button>
    </div>
  );
}

export function GhostControl({ ghostId, frames, onSetGhost, ghostVisible, onToggleVisible, opacity, onOpacity }) {
  const ghostOrder = frames.findIndex((frame) => frame.id === ghostId);
  return (
    <div className="ghost-control" title="残影：把某一帧半透明叠到实时画面上用于对齐">
      <ScanEye size={13} />
      <label className="switch">
        <input type="checkbox" checked={ghostVisible} onChange={(event) => onToggleVisible(event.target.checked)} />
        <span>残影</span>
      </label>
      <select
        value={ghostId || ''}
        onChange={(event) => onSetGhost(event.target.value || null)}
      >
        <option value="">上一帧（自动）</option>
        {frames.map((frame, index) => (
          <option key={frame.id} value={frame.id}>第 {index + 1} 帧</option>
        ))}
      </select>
      {ghostOrder >= 0 && <span className="ghost-hint">当前基准：第 {ghostOrder + 1} 帧</span>}
      <input
        className="opacity-range"
        type="range"
        min={0.1}
        max={0.9}
        step={0.05}
        value={opacity}
        onChange={(event) => onOpacity(Number(event.target.value))}
        aria-label="残影不透明度"
      />
    </div>
  );
}
