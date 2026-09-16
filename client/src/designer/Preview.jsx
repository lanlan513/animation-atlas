import { useRef } from 'react';

// 世界坐标：viewBox 960x540；图层 (x, y) 是归一化位移，1 单位 = 480px。
export const WORLD_W = 960;
export const WORLD_H = 540;
const UNIT = WORLD_W / 2;

function assetInner(asset) {
  // 服务端给的是完整 <svg>，取其内部标记与 viewBox；失败时回退为整段
  if (!asset) return { html: '', viewBox: '-50 -50 100 100' };
  if (asset._inner) return asset._inner;
  const match = /viewBox="([^"]+)"/.exec(asset.svg || '');
  const inner = asset.svg ? asset.svg.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '') : '';
  asset._inner = { html: inner, viewBox: match?.[1] || '-50 -50 100 100' };
  return asset._inner;
}

export default function Preview({ assets, frame, clip, selection, onSelect, onDragLayer, playing }) {
  const svgRef = useRef(null);
  const dragRef = useRef(null);

  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const ordered = [...frame.layers].sort((a, b) => {
    const rank = { background: 0, character: 1, shockwave: 2, speedline: 3 };
    return rank[a.type] - rank[b.type];
  });

  const toWorld = (event) => {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WORLD_W,
      y: ((event.clientY - rect.top) / rect.height) * WORLD_H
    };
  };

  const onPointerDownLayer = (event, layer) => {
    if (layer.type === 'background') return;
    event.stopPropagation();
    onSelect({ kind: 'layer', layerId: layer.layerId });
    const point = toWorld(event);
    dragRef.current = { layerId: layer.layerId, startX: point.x, startY: point.y, origX: layer.x, origY: layer.y, moved: false };
    svgRef.current.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = toWorld(event);
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    onDragLayer(drag.layerId, {
      x: Math.round((drag.origX + dx / UNIT) * 1000) / 1000,
      y: Math.round((drag.origY + dy / UNIT) * 1000) / 1000
    });
  };

  const endDrag = (event) => {
    dragRef.current = null;
    try { svgRef.current?.releasePointerCapture(event.pointerId); } catch { /* noop */ }
  };

  const cam = frame.camera;
  // 推镜/横摇作用于世界；震屏只做屏幕空间抖动
  const camTransform = `translate(${WORLD_W / 2} ${WORLD_H / 2}) scale(${cam.zoom}) translate(${-cam.panX * UNIT} ${-cam.panY * UNIT}) translate(${-WORLD_W / 2} ${-WORLD_H / 2})`;
  const shakeTransform = `translate(${cam.shakeX * WORLD_W} ${cam.shakeY * WORLD_W})`;

  return (
    <div className="preview-wrap">
      <svg
        ref={svgRef}
        className="preview-svg"
        viewBox={`0 0 ${WORLD_W} ${WORLD_H}`}
        preserveAspectRatio="xMidYMid slice"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={() => onSelect(null)}
      >
        <rect width={WORLD_W} height={WORLD_H} fill="#0a0b0e" />
        <g transform={shakeTransform}>
          <g transform={camTransform}>
            {ordered.map((layer) => {
              const asset = byId.get(layer.assetId);
              const inner = assetInner(asset);
              const isBg = layer.type === 'background';
              const selected = selection?.kind === 'layer' && selection.layerId === layer.layerId;
              const wrapper = isBg
                ? `translate(${WORLD_W / 2 + layer.x * UNIT} ${WORLD_H / 2 + layer.y * UNIT}) scale(${layer.scale * 9.6}) rotate(${layer.rotation}) translate(${-WORLD_W / 2} ${-WORLD_H / 2})`
                : `translate(${WORLD_W / 2 + layer.x * UNIT} ${WORLD_H / 2 + layer.y * UNIT}) scale(${layer.scale}) rotate(${layer.rotation})`;
              return (
                <g
                  key={layer.layerId}
                  transform={wrapper}
                  opacity={layer.opacity}
                  className={`layer-node ${isBg ? '' : 'draggable'} ${selected ? 'selected' : ''}`}
                  onPointerDown={(event) => onPointerDownLayer(event, layer)}
                  dangerouslySetInnerHTML={{ __html: inner.html }}
                />
              );
            })}
          </g>
        </g>
        {/* 闪白覆盖 */}
        {cam.flash > 0.001 && <rect width={WORLD_W} height={WORLD_H} fill="#ffffff" opacity={cam.flash} style={{ pointerEvents: 'none' }} />}
        {/* 定格角标 */}
        {cam.frozen && (
          <g style={{ pointerEvents: 'none' }}>
            <rect x={WORLD_W - 132} y={18} width={114} height={30} rx={4} fill="#0a0b0ecc" stroke="#8bd5ca" />
            <text x={WORLD_W - 75} y={38} textAnchor="middle" fontSize="15" fill="#8bd5ca" fontFamily="DM Mono, monospace" fontWeight={600}>⏸ FREEZE</text>
          </g>
        )}
      </svg>
      <div className={`preview-badge ${playing ? 'playing' : ''}`}>
        <span className="badge-dot" />
        {playing ? 'PLAYING' : cam.frozen ? 'FREEZE FRAME' : 'SCRUB'}
        <em>{frame.time.toFixed(2)}s</em>
      </div>
    </div>
  );
}
