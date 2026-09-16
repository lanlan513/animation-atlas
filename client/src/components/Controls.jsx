import { Dices, Lock, LockOpen, Trash2, Eye, EyeOff, ArrowUp, ArrowDown, CopyPlus } from 'lucide-react';
import { BOUNCE_CURVES, randomSeed } from '../../../shared/panel-punch-core.js';

export function Slider({ label, value, min, max, step = 1, suffix = '', onChange }) {
  return (
    <label className="control-row">
      <span>{label}<b>{value}{suffix}</b></span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function ColorField({ label, value, onChange }) {
  return (
    <label className="color-field">
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
      <span>{label}<code>{value}</code></span>
    </label>
  );
}

function SegmentedButton({ active, children, onClick }) {
  return <button type="button" className={active ? 'active' : ''} onClick={onClick}>{children}</button>;
}

export default function ImpactControls({ layer, onChange, onDuplicate, onDelete, canDelete }) {
  if (!layer) return null;
  const impact = layer.impact;
  const patch = (patchValues) => onChange({ ...impact, ...patchValues });

  return (
    <div className="control-panel">
      <div className="control-title">
        <span>重新编辑冲击字</span>
        <button type="button" title="复制为新图层" onClick={onDuplicate}><CopyPlus size={15} /></button>
        {canDelete && <button type="button" title="删除图层" className="danger" onClick={onDelete}><Trash2 size={15} /></button>}
      </div>

      <label className="text-input">
        冲击词（最多 12 字符）
        <input
          value={impact.text}
          maxLength={12}
          onChange={(event) => patch({ text: event.target.value })}
          placeholder="BAM"
        />
      </label>

      <div className="shape-switch">
        <SegmentedButton active={impact.shape === 'burst'} onClick={() => patch({ shape: 'burst' })}>尖角爆炸</SegmentedButton>
        <SegmentedButton active={impact.shape === 'blob'} onClick={() => patch({ shape: 'blob' })}>不规则云朵</SegmentedButton>
        <SegmentedButton active={impact.shape === 'badge'} onClick={() => patch({ shape: 'badge' })}>徽章轮廓</SegmentedButton>
      </div>

      <Slider label="爆炸尖角" value={impact.spikes} min={8} max={48} onChange={(spikes) => patch({ spikes })} />
      <Slider label="轮廓锯齿" value={impact.jagged} min={0} max={100} suffix="%" onChange={(jagged) => patch({ jagged })} />
      <Slider label="粗黑描边" value={impact.strokeWidth} min={0} max={28} onChange={(strokeWidth) => patch({ strokeWidth })} />

      <div className="control-subhead">半色调网点</div>
      <Slider label="网点半径" value={impact.dotRadius} min={1} max={12} onChange={(dotRadius) => patch({ dotRadius })} />
      <Slider label="网点间距" value={impact.dotGap} min={6} max={42} onChange={(dotGap) => patch({ dotGap })} />
      <Slider label="网点浓度" value={impact.dotOpacity} min={0} max={100} suffix="%" onChange={(dotOpacity) => patch({ dotOpacity })} />

      <div className="control-subhead">弹跳曲线</div>
      <select value={impact.bounceCurve} onChange={(event) => patch({ bounceCurve: event.target.value })}>
        {Object.entries(BOUNCE_CURVES).map(([key, curve]) => (
          <option value={key} key={key}>{curve.label}</option>
        ))}
      </select>
      <Slider label="弹跳幅度" value={impact.bounceAmplitude} min={0} max={24} onChange={(bounceAmplitude) => patch({ bounceAmplitude })} />

      <div className="control-subhead">颜色通道偏移</div>
      <Slider label="RGB 错位" value={impact.channelDistance} min={0} max={28} onChange={(channelDistance) => patch({ channelDistance })} />
      <Slider label="错位角度" value={impact.channelAngle} min={-180} max={180} suffix="°" onChange={(channelAngle) => patch({ channelAngle })} />

      <Slider label="Safari 兼容手绘扰动" value={impact.roughAmount} min={0} max={18} onChange={(roughAmount) => patch({ roughAmount })} />

      <div className="color-grid">
        <ColorField label="爆炸" value={impact.burstColor} onChange={(burstColor) => patch({ burstColor })} />
        <ColorField label="阴影" value={impact.accentColor} onChange={(accentColor) => patch({ accentColor })} />
        <ColorField label="字体" value={impact.textColor} onChange={(textColor) => patch({ textColor })} />
        <ColorField label="描边" value={impact.strokeColor} onChange={(strokeColor) => patch({ strokeColor })} />
        <ColorField label="网点" value={impact.dotColor} onChange={(dotColor) => patch({ dotColor })} />
      </div>

      <button type="button" className="seed-button" onClick={() => patch({ seed: randomSeed() })}>
        <Dices size={15} /> 重投随机种子 <code>#{impact.seed}</code>
      </button>

      <div className="layer-state-buttons">
        <span><Lock size={13} />锁定图层可防止画布拖拽</span>
        <span><LockOpen size={13} />当前{layer.locked ? '已锁定' : '可拖拽'}</span>
      </div>
    </div>
  );
}

export function LayerPanel({ poster, selectedId, onSelect, onMove, onToggleLock, onToggleHidden, onRename }) {
  const topToBottom = [...poster.layers].reverse();
  return (
    <div className="layer-list">
      {topToBottom.map((layer) => (
        <div className={`layer-row ${selectedId === layer.id ? 'selected' : ''} ${layer.visible ? '' : 'is-hidden'}`} key={layer.id}>
          <button type="button" className="layer-main" onClick={() => onSelect(layer.id)}>
            <span className="layer-kind">{layer.kind === 'background' ? 'BG' : 'POW'}</span>
            <input
              value={layer.name}
              maxLength={42}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onRename(layer.id, event.target.value)}
              aria-label="图层名称"
            />
          </button>
          <div className="layer-actions">
            <button type="button" title="上移图层" onClick={() => onMove(layer.id, 1)}><ArrowUp size={14} /></button>
            <button type="button" title="下移图层" onClick={() => onMove(layer.id, -1)}><ArrowDown size={14} /></button>
            <button type="button" title={layer.locked ? '解锁' : '锁定'} onClick={() => onToggleLock(layer.id)}>
              {layer.locked ? <Lock size={14} /> : <LockOpen size={14} />}
            </button>
            <button type="button" title={layer.visible ? '隐藏' : '显示'} onClick={() => onToggleHidden(layer.id)}>
              {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
