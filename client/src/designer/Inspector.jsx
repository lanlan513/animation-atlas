import { Trash2 } from 'lucide-react';
import { CAMERA_META, CAMERA_PARAM_META, EASINGS, EASING_LABEL } from '../constants.js';
import { findKeyframeOwner } from './clipFactory.js';

function NumberField({ label, value, min, max, step, onChange }) {
  return (
    <label className="inspector-field">
      <span>{label}</span>
      <input
        type="number" min={min} max={max} step={step} value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : ''}
        onChange={(event) => {
          const v = Number(event.target.value);
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
      />
    </label>
  );
}

function SliderField({ metaKey, value, onChange }) {
  const meta = CAMERA_PARAM_META[metaKey];
  return (
    <label className="inspector-slider">
      <span>{meta.label}<b>{Math.round(value * 1000) / 1000}</b></span>
      <input type="range" min={meta.min} max={meta.max} step={meta.step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export default function Inspector({ clip, selection, time, onPatchKeyframe, onPatchLayer, onPatchCamera, onPatchCameraParams, onDeleteKeyframe, onDeleteLayer, onDeleteCamera, onAddKeyframeAt }) {
  if (selection?.kind === 'keyframe') {
    const owner = findKeyframeOwner(clip, selection.keyframeId);
    if (!owner) return <aside className="inspector" />;
    const { layer, keyframe } = owner;
    return (
      <aside className="inspector">
        <div className="panel-head"><p className="eyebrow">KEYFRAME</p><h3>关键帧</h3><p className="panel-sub">{layer.name}</p></div>
        <NumberField label="时间（秒）" value={keyframe.time} min={0} max={10} step={0.05} onChange={(v) => onPatchKeyframe(keyframe.id, { time: v })} />
        <label className="inspector-field">
          <span>缓动</span>
          <select value={keyframe.easing} onChange={(event) => onPatchKeyframe(keyframe.id, { easing: event.target.value })}>
            {EASINGS.map((e) => <option key={e} value={e}>{EASING_LABEL[e]}</option>)}
          </select>
        </label>
        <div className="inspector-grid">
          <NumberField label="X" value={keyframe.x} min={-1.5} max={1.5} step={0.02} onChange={(v) => onPatchKeyframe(keyframe.id, { x: v })} />
          <NumberField label="Y" value={keyframe.y} min={-1.2} max={1.2} step={0.02} onChange={(v) => onPatchKeyframe(keyframe.id, { y: v })} />
          <NumberField label="缩放" value={keyframe.scale} min={0.05} max={6} step={0.05} onChange={(v) => onPatchKeyframe(keyframe.id, { scale: v })} />
          <NumberField label="旋转°" value={keyframe.rotation} min={-360} max={360} step={1} onChange={(v) => onPatchKeyframe(keyframe.id, { rotation: v })} />
          <NumberField label="不透明度" value={keyframe.opacity} min={0} max={1} step={0.05} onChange={(v) => onPatchKeyframe(keyframe.id, { opacity: v })} />
        </div>
        <button className="button ghost full danger" onClick={() => onDeleteKeyframe(keyframe.id)}><Trash2 size={14} />删除关键帧</button>
      </aside>
    );
  }

  if (selection?.kind === 'camera') {
    const action = clip.cameraActions.find((item) => item.id === selection.actionId);
    if (!action) return <aside className="inspector" />;
    const meta = CAMERA_META[action.type];
    return (
      <aside className="inspector">
        <div className="panel-head"><p className="eyebrow" style={{ color: meta.color }}>CAMERA / {action.type.toUpperCase()}</p><h3><i style={{ color: meta.color }}>{meta.glyph}</i> {meta.label}</h3></div>
        <div className="inspector-grid">
          <NumberField label="开始（秒）" value={action.start} min={0} max={10} step={0.05} onChange={(v) => onPatchCamera(action.id, { start: v })} />
          <NumberField label="结束（秒）" value={action.end} min={0.05} max={10} step={0.05} onChange={(v) => onPatchCamera(action.id, { end: v })} />
        </div>
        {Object.keys(action.params).map((key) => (
          CAMERA_PARAM_META[key] ? <SliderField key={key} metaKey={key} value={action.params[key]} onChange={(v) => onPatchCameraParams(action.id, { [key]: v })} /> : null
        ))}
        {action.type === 'freeze' && <p className="inspector-note">定格生效期间，所有图层锁定在该动作开始时刻的姿态，震屏也会暂停。</p>}
        {action.type === 'flash' && <p className="inspector-note">闪白在动作起点瞬间达到峰值，随后沿动作时长线性消退。</p>}
        <button className="button ghost full danger" onClick={() => onDeleteCamera(action.id)}><Trash2 size={14} />删除镜头动作</button>
      </aside>
    );
  }

  if (selection?.kind === 'layer') {
    const layer = clip.layers.find((item) => item.id === selection.layerId);
    if (!layer) return <aside className="inspector" />;
    return (
      <aside className="inspector">
        <div className="panel-head"><p className="eyebrow">LAYER</p><h3>图层</h3></div>
        <label className="inspector-field">
          <span>名称</span>
          <input type="text" value={layer.name} maxLength={60} onChange={(event) => onPatchLayer(layer.id, { name: event.target.value })} />
        </label>
        <p className="inspector-note">{layer.keyframes.length} 个关键帧 · 在画布上直接拖动可在播放头位置写入位置。</p>
        <button className="button secondary full" onClick={() => onAddKeyframeAt(layer.id, time)}>在 {time.toFixed(2)}s 添加关键帧</button>
        <button className="button ghost full danger" onClick={() => onDeleteLayer(layer.id)}><Trash2 size={14} />删除图层</button>
      </aside>
    );
  }

  return (
    <aside className="inspector">
      <div className="panel-head"><p className="eyebrow">INSPECTOR</p><h3>属性</h3></div>
      <p className="inspector-note">点击时间轴上的关键帧、镜头片段，或画布中的图层来编辑属性。</p>
    </aside>
  );
}
