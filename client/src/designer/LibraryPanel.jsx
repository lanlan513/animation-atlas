import { useState } from 'react';
import { LIBRARY_GROUPS, LAYER_TYPE_LABEL } from '../constants.js';

// 素材以 100x100 的图层空间预览（与画布上的图层同一坐标系）
function AssetThumb({ asset }) {
  const isBg = asset.type === 'background';
  const html = asset.svg.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return (
    <svg viewBox={isBg ? '0 0 960 540' : '-50 -50 100 100'} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <g dangerouslySetInnerHTML={{ __html: html }} />
    </svg>
  );
}

export default function LibraryPanel({ assets, loading, onAdd, activeLayerType }) {
  const [group, setGroup] = useState('character');
  const shown = assets.filter((asset) => asset.type === group);

  return (
    <aside className="library-panel">
      <div className="panel-head"><p className="eyebrow">ASSET LIBRARY</p><h3>素材库</h3></div>
      <div className="library-tabs">
        {LIBRARY_GROUPS.map((item) => (
          <button key={item.type} className={group === item.type ? 'active' : ''} onClick={() => setGroup(item.type)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="library-grid">
        {loading && Array.from({ length: 4 }, (_, i) => <div className="asset-card skeleton" key={i} />)}
        {!loading && shown.map((asset) => (
          <button className="asset-card" key={asset.id} title={`添加「${asset.name}」到时间轴`} onClick={() => onAdd(asset)}>
            <span className={`asset-thumb ${asset.type}`}><AssetThumb asset={asset} /></span>
            <span className="asset-name">{asset.name}</span>
            <span className="asset-tags">{asset.tags}</span>
          </button>
        ))}
      </div>
      {activeLayerType && <p className="library-hint">当前图层类型：{LAYER_TYPE_LABEL[activeLayerType]}</p>}
    </aside>
  );
}
