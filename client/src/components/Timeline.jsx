import React, { useRef, useState } from 'react';
import { Copy, GripVertical, Scissors, Trash2 } from 'lucide-react';
import { mediaUrl } from '../api.js';

// 时间尺：帧序列、多选、拖拽排序、复制/删除。
// 排序以服务端为准，拖拽结束时一次性提交全量 order。
export default function Timeline({ frames, selectedIds, ghostId, onSelect, onReorder, onDuplicate, onDelete, disabled }) {
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const listRef = useRef(null);

  const selectedSet = new Set(selectedIds);

  const handleDragStart = (event, frame) => {
    if (disabled) return;
    if (!selectedSet.has(frame.id)) onSelect([frame.id], false, false);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', frame.id);
    setDragId(frame.id);
  };

  const handleDragOver = (event, frame) => {
    if (!dragId) return;
    event.preventDefault();
    if (overId !== frame.id) setOverId(frame.id);
  };

  const reorder = (sourceId, targetId) => {
    if (sourceId === targetId) return;
    const ids = frames.map((frame) => frame.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    onReorder(ids.map((id, order) => ({ id, order })));
  };

  const handleDrop = (event, frame) => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData('text/plain');
    reorder(sourceId, frame.id);
    setDragId(null);
    setOverId(null);
  };

  const handleClick = (event, frame) => {
    if (disabled) return;
    onSelect([frame.id], event.metaKey || event.ctrlKey, event.shiftKey, frames);
  };

  return (
    <div className="timeline" ref={listRef}>
      {frames.length === 0 ? (
        <div className="timeline-empty">
          <Scissors size={16} />
          <span>还没有帧。拍第一帧，或切换到「导入图片」批量加入。</span>
        </div>
      ) : (
        <div className="timeline-track">
          {frames.map((frame, index) => (
            <div
              key={frame.id}
              className={`timeline-frame ${selectedSet.has(frame.id) ? 'selected' : ''} ${dragId === frame.id ? 'dragging' : ''} ${overId === frame.id && dragId !== frame.id ? 'over' : ''}`}
              draggable={!disabled}
              onDragStart={(event) => handleDragStart(event, frame)}
              onDragOver={(event) => handleDragOver(event, frame)}
              onDrop={(event) => handleDrop(event, frame)}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onClick={(event) => handleClick(event, frame)}
              title={`第 ${index + 1} 帧 · ${frame.durationMs}ms`}
            >
              <img src={mediaUrl(frame.thumbUrl)} alt={`帧 ${index + 1}`} loading="lazy" draggable={false} />
              <span className="frame-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="frame-ms">{frame.durationMs}ms</span>
              {ghostId === frame.id && <span className="frame-ghost-badge" title="残影基准帧">残影</span>}
              <span className="frame-grip"><GripVertical size={12} /></span>
              <span className="frame-actions">
                <button title="复制这一帧（插在后面）" onClick={(event) => { event.stopPropagation(); onDuplicate(frame.id); }}>
                  <Copy size={12} />
                </button>
                <button title="删除这一帧" onClick={(event) => { event.stopPropagation(); onDelete(frame.id); }}>
                  <Trash2 size={12} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
