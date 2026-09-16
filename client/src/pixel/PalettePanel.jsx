import React, { useState } from 'react';

const LockIcon = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
const UnlockIcon = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 7.5-2" />
  </svg>
);
const TrashIcon = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);
const PlusIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg>
);

const PRESET_SWATCHES = [
  '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070',
  '#38b764', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86',
  '#333c57', '#b0a9e6', '#f2674a'
];

export default function PalettePanel({ store, activeColor, onPick }) {
  const [newColor, setNewColor] = useState('#f4f4f4');
  const palette = store.model.palette;

  return (
    <div className="palette-panel">
      <div className="panel-title">
        <span>调色板</span>
        <span className="panel-count">{palette.length} 色 · 锁定 {palette.filter((s) => s.locked).length}</span>
      </div>
      <div className="swatch-grid">
        {palette.map((slot) => (
          <div
            key={slot.id}
            className={`swatch ${activeColor === slot.id ? 'active' : ''} ${slot.locked ? 'locked' : ''}`}
            title={`${slot.color}${slot.locked ? '（已锁定）' : ''}`}
          >
            <button className="swatch-color" style={{ background: slot.color }} onClick={() => onPick(slot.id)}>
              {activeColor === slot.id && <span className="swatch-pick" />}
            </button>
            <div className="swatch-tools">
              <button title={slot.locked ? '解锁' : '锁定（绘制时不覆盖此色像素）'} onClick={() => store.toggleLock(slot.id)}>
                {slot.locked ? <LockIcon /> : <UnlockIcon />}
              </button>
              <label className="swatch-edit" title="编辑颜色">
                <input
                  type="color"
                  value={slot.color}
                  disabled={slot.locked}
                  onChange={(e) => store.updateColor(slot.id, e.target.value)}
                />
                <span>✎</span>
              </label>
              <button title="删除颜色（所有帧中的该色像素将变透明，可撤销）" className="danger" onClick={() => store.deleteColor(slot.id)}>
                <TrashIcon />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="palette-add">
        <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} />
        <button className="btn tiny" onClick={() => { const id = store.addColor(newColor); onPick(id); }}><PlusIcon />加入色板</button>
      </div>
      <details className="presets">
        <summary>预设色板</summary>
        <div className="preset-row">
          {PRESET_SWATCHES.map((c) => (
            <button key={c} className="preset-chip" style={{ background: c }} title={c} onClick={() => { const id = store.addColor(c); onPick(id); }} />
          ))}
        </div>
      </details>
    </div>
  );
}
