import React, { useEffect, useRef } from 'react';
import { DIRECTIONS, DIR_LABELS, getFrame } from '../../../shared/pixel-core.js';
import { frameImageData } from './export.js';

function FrameThumb({ store, frame, size = 44 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const model = store.model;
    const fresh = getFrame(model, frame.id);
    if (!fresh) return;
    const image = frameImageData(model, fresh);
    const native = document.createElement('canvas');
    native.width = image.width;
    native.height = image.height;
    native.getContext('2d').putImageData(image, 0, 0);
    const scale = Math.max(1, Math.floor(Math.min(canvas.width / model.width, canvas.height / model.height)));
    const w = model.width * scale, h = model.height * scale;
    ctx.drawImage(native, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  });

  return <canvas ref={ref} style={{ width: size, height: size, imageRendering: 'pixelated' }} className="frame-thumb" />;
}

export default function Timeline({ store, frameId, onSelect }) {
  const groups = DIRECTIONS.map((dir) => ({ dir, frames: store.model.frames.filter((f) => f.dir === dir) }));

  return (
    <div className="timeline">
      {groups.map(({ dir, frames }) => (
        <div className={`tl-row ${frames.some((f) => f.id === frameId) ? 'active-dir' : ''}`} key={dir}>
          <div className="tl-dir" title={DIR_LABELS[dir]}>
            <span className="dir-arrow">{dirArrow(dir)}</span>
            <span className="dir-name">{DIR_LABELS[dir]}</span>
            <span className="dir-count">{frames.length}</span>
          </div>
          <div className="tl-frames">
            {frames.map((frame, index) => (
              <div
                key={frame.id}
                className={`tl-frame ${frame.id === frameId ? 'selected' : ''}`}
                onClick={() => onSelect(frame.id)}
                title={`第 ${index + 1} 帧 · ${DIR_LABELS[dir]}`}
              >
                <FrameThumb store={store} frame={frame} />
                <span className="tl-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="tl-actions">
                  <button title="向左移动" onClick={(e) => { e.stopPropagation(); store.moveFrameBy(frame.id, -1); }}>‹</button>
                  <button title="复制帧" onClick={(e) => { e.stopPropagation(); const id = store.duplicateFrame(frame.id); onSelect(id); }}>⧉</button>
                  <button title="向右移动" onClick={(e) => { e.stopPropagation(); store.moveFrameBy(frame.id, 1); }}>›</button>
                  <button
                    title="删除帧"
                    className="danger"
                    onClick={(e) => { e.stopPropagation(); if (store.model.frames.length > 1) store.deleteFrame(frame.id); }}
                  >×</button>
                </div>
                <select
                  className="tl-dir-select"
                  value={dir}
                  title="移动到其他方向"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => { store.changeFrameDir(frame.id, e.target.value); }}
                >
                  {DIRECTIONS.map((d) => <option key={d} value={d}>{DIR_LABELS[d]}</option>)}
                </select>
              </div>
            ))}
            <button className="tl-add" onClick={() => { const id = store.addBlankFrame(dir); onSelect(id); }} title={`在${DIR_LABELS[dir]}末尾添加空白帧`}>
              <span>＋</span>
              <small>空白帧</small>
            </button>
            <button className="tl-add dup" onClick={() => {
              const source = frames[frames.length - 1] || store.model.frames.find((f) => true);
              if (source) { const id = store.duplicateFrame(source.id, dir); onSelect(id); }
            }} title={`复制上一帧到${DIR_LABELS[dir]}`}>
              <span>⧉</span>
              <small>复制上一帧</small>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function dirArrow(dir) {
  const map = { down: '↓', downLeft: '↙', left: '←', upLeft: '↖', up: '↑', upRight: '↗', right: '→', downRight: '↘' };
  return map[dir];
}
