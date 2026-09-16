import React, { useState } from 'react';
import { LoaderCircle, Plus, X } from 'lucide-react';

export default function CreateModal({ labs, initialSlug = 'frame-mold', onClose, onCreate, onError }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categorySlug, setCategorySlug] = useState(initialSlug);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreate({ name: name.trim(), categorySlug, description: description.trim() });
    } catch (error) {
      onError?.(error.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">NEW SHOOT / FRAMEMOLD</p>
            <h2>建立拍摄项目</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>
        <label className="field">
          项目名称
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：黏土小怪兽的第一跳" maxLength={80} />
        </label>
        <label className="field">
          备注（可选）
          <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="灯光、帧率、动作设计…" maxLength={200} />
        </label>
        <div className="field">
          选择实验室
          <div className="lab-select">
            {labs.map((lab) => (
              <button
                type="button"
                className={categorySlug === lab.slug ? 'selected' : ''}
                key={lab.slug}
                onClick={() => setCategorySlug(lab.slug)}
              >
                <span className="lab-option-glyph" style={{ color: lab.accent }}>{lab.glyph}</span>
                <span className="lab-option-copy">
                  <strong>{lab.name}</strong>
                  <small>{lab.kind}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose}>取消</button>
          <button className="button primary" disabled={busy || !name.trim()}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}进入拍摄台
          </button>
        </div>
      </form>
    </div>
  );
}
