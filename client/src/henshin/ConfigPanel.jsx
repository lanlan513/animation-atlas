import { LoaderCircle } from 'lucide-react';
import { HENSHIN_FIELD_LABEL } from './constants.js';

// 配置表单：角色名 / 主色 / 光效符号 / 音轨 / 追加节拍。
// 符号与音轨的合法值来自当前模板（切换模板时白名单随之改变）。
export default function ConfigPanel({ template, config, dirty, saving, onPatch, onAddBeat, onRemoveBeat }) {
  if (!template || !config) return <div className="henshin-panel-loading"><LoaderCircle className="spin" size={16} /></div>;
  return (
    <div className="henshin-config">
      <label className="henshin-field">
        <span>{HENSHIN_FIELD_LABEL.characterName}</span>
        <input
          maxLength={12}
          value={config.characterName}
          onChange={(event) => onPatch({ characterName: event.target.value })}
          placeholder="输入角色名"
        />
      </label>

      <label className="henshin-field">
        <span>{HENSHIN_FIELD_LABEL.primaryColor}</span>
        <div className="henshin-color-row">
          <input
            type="color"
            value={config.primaryColor}
            onChange={(event) => onPatch({ primaryColor: event.target.value })}
            aria-label="选择主色"
          />
          <code>{config.primaryColor}</code>
          <div className="henshin-swatches">
            {template.swatches.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={config.primaryColor.toLowerCase() === swatch.toLowerCase() ? 'active' : ''}
                style={{ background: swatch }}
                title={swatch}
                onClick={() => onPatch({ primaryColor: swatch })}
              />
            ))}
          </div>
        </div>
      </label>

      <div className="henshin-field">
        <span>{HENSHIN_FIELD_LABEL.glowSymbol}</span>
        <div className="henshin-symbol-grid">
          {template.symbols.map((symbol) => (
            <button
              key={symbol.id}
              type="button"
              className={config.glowSymbol === symbol.id ? 'active' : ''}
              style={{ '--sym-color': template.accent }}
              onClick={() => onPatch({ glowSymbol: symbol.id })}
              title={symbol.name}
            >
              <i>{symbol.glyph}</i><small>{symbol.name}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="henshin-field">
        <span>{HENSHIN_FIELD_LABEL.trackId}</span>
        <div className="henshin-track-list">
          {template.tracks.map((track) => (
            <button
              key={track.id}
              type="button"
              className={config.trackId === track.id ? 'active' : ''}
              onClick={() => onPatch({ trackId: track.id })}
            >
              <strong>{track.name}</strong>
              <small>{track.bpm} BPM · {track.beats.length} 拍 · {track.downbeats.length} 重拍</small>
            </button>
          ))}
        </div>
      </div>

      <div className="henshin-field">
        <span>{HENSHIN_FIELD_LABEL.customBeats} <em className="henshin-count">{config.customBeats.length}/16</em></span>
        <button type="button" className="button ghost small full" disabled={config.customBeats.length >= 16} onClick={onAddBeat}>
          + 在当前播放头追加一拍
        </button>
        {config.customBeats.length > 0 && (
          <ul className="henshin-beats">
            {config.customBeats.map((beat, index) => (
              <li key={`${beat}-${index}`}>
                <code>{beat.toFixed(2)}s</code>
                <button type="button" onClick={() => onRemoveBeat(index)} title="删除这一拍">×</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={`henshin-save-hint ${saving ? 'saving' : dirty ? 'dirty' : 'saved'}`}>
        {saving ? <><LoaderCircle className="spin" size={12} /> 保存中…</> : dirty ? '有未保存改动' : '配置已保存'}
      </div>
    </div>
  );
}
