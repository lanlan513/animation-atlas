import React, { useMemo, useState } from 'react';
import { downloadSheet, renderSheet, sheetGeometry } from './export.js';

export default function ExportPanel({ store }) {
  const cfg = store.model.exportConfig || { scale: 4, layout: 'grid', gap: 0, fps: 8 };
  const [scale, setScale] = useState(cfg.scale ?? 4);
  const [layout, setLayout] = useState(cfg.layout ?? 'grid');
  const [gap, setGap] = useState(cfg.gap ?? 0);
  const [lastInfo, setLastInfo] = useState(cfg.lastExport || null);

  const model = store.model;
  const geo = useMemo(() => sheetGeometry(model, layout, scale, gap), [model, layout, scale, gap]);

  const persist = (next) => store.saveExportConfig(next);

  const onExport = () => {
    const slug = (model.name || 'pixelpulse').replace(/[^\w一-龥-]+/g, '_').slice(0, 40);
    const info = downloadSheet(model, { scale, layout, gap }, `${slug}_${model.width}x${model.height}_${scale}x.png`);
    const record = { at: new Date().toISOString(), width: info.width, height: info.height, scale, layout, gap };
    setLastInfo(record);
    persist({ scale, layout, gap, lastExport: record });
  };

  return (
    <div className="export-panel">
      <div className="panel-title">
        <span>PNG 精灵图导出</span>
        <span className="panel-count">{geo.canvasWidth}×{geo.canvasHeight}px</span>
      </div>

      <label className="export-field">导出倍率（整数像素，不抗锯齿）
        <div className="scale-row">
          {[1, 2, 3, 4, 6, 8].map((s) => (
            <button key={s} className={scale === s ? 'chip selected' : 'chip'} onClick={() => { setScale(s); persist({ scale: s }); }}>{s}×</button>
          ))}
        </div>
      </label>

      <label className="export-field">排列方式
        <div className="scale-row">
          <button className={layout === 'grid' ? 'chip selected' : 'chip'} onClick={() => { setLayout('grid'); persist({ layout: 'grid' }); }}>八方向分行（网格）</button>
          <button className={layout === 'strip' ? 'chip selected' : 'chip'} onClick={() => { setLayout('strip'); persist({ layout: 'strip' }); }}>单行长条</button>
        </div>
      </label>

      <label className="export-field">帧间距
        <input
          type="range" min="0" max="8" value={gap}
          onChange={(e) => { const v = Number(e.target.value); setGap(v); persist({ gap: v }); }}
        />
        <code>{gap}px</code>
      </label>

      <SheetPreview model={model} config={{ scale, layout, gap }} />

      <button className="btn primary full" onClick={onExport}>⬇ 导出 PNG（硬边像素）</button>
      {lastInfo && (
        <p className="panel-hint">
          上次导出：{lastInfo.width}×{lastInfo.height}px · {new Date(lastInfo.at).toLocaleTimeString('zh-CN')}
        </p>
      )}
      <p className="panel-hint warn">导出走离屏 <code>putImageData</code> + 整数倍 <code>drawImage</code>，并全程关闭 imageSmoothing，浏览器不会产生半透明插值像素。</p>
    </div>
  );
}

function SheetPreview({ model, config }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const sheet = renderSheet(model, config);
    const maxW = 240, maxH = 160;
    const fit = Math.min(maxW / sheet.width, maxH / sheet.height, 1);
    canvas.width = Math.max(1, Math.round(sheet.width * fit));
    canvas.height = Math.max(1, Math.round(sheet.height * fit));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sheet, 0, 0, canvas.width, canvas.height);
  });
  return (
    <div className="sheet-preview">
      <canvas ref={ref} style={{ imageRendering: 'pixelated' }} />
    </div>
  );
}
