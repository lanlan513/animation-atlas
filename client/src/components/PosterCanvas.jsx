import { forwardRef, useEffect, useRef } from 'react';
import ImpactArt, { ART_HEIGHT, ART_WIDTH } from './ImpactArt.jsx';
import { mulberry32 } from '../../../shared/panel-punch-core.js';

function drawBackground(ctx, layer, width, height, seed = 0) {
  const bg = layer.background;
  ctx.save();
  const gradient = ctx.createRadialGradient(width * 0.52, height * 0.45, 10, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
  gradient.addColorStop(0, bg.type === 'radial' ? '#fff9e7' : '#f8f0dc');
  gradient.addColorStop(1, bg.color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Canvas renders the poster texture; SVG export replaces this canvas layer
  // with a compact vector background, so no binary texture needs embedding.
  if (bg.type === 'speed') {
    ctx.strokeStyle = bg.accent;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 3;
    for (let i = 0; i < 34; i += 1) {
      const y = (i / 33) * height;
      ctx.beginPath();
      ctx.moveTo(-120, y);
      ctx.bezierCurveTo(width * 0.3, y - 80 + (i % 5) * 20, width * 0.7, y + 60, width + 120, y - 24);
      ctx.stroke();
    }
  } else {
    const rand = mulberry32((Number(seed) || 0) + Math.round(width) + Math.round(height));
    const gap = bg.type === 'halftone' ? 13 : 18;
    ctx.fillStyle = bg.accent;
    for (let y = -20; y < height + 20; y += gap) {
      for (let x = -20; x < width + 20; x += gap) {
        const nx = (x - width / 2) / (width * 0.62);
        const ny = (y - height / 2) / (height * 0.72);
        const distance = nx * nx + ny * ny;
        if (distance > (bg.type === 'halftone' ? 0.1 : 0.45)) {
          const radius = Math.max(0.6, 4.6 - distance * 2.6) * (0.55 + rand() * 0.85);
          ctx.globalAlpha = bg.type === 'halftone' ? 0.38 : 0.16;
          ctx.beginPath();
          ctx.arc(x + (rand() - 0.5) * 2, y + (rand() - 0.5) * 2, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  ctx.restore();
}

function BackgroundCanvas({ layer, width, height, seed }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    drawBackground(ctx, layer, width, height, seed);
  }, [layer, width, height, seed]);
  return <canvas ref={ref} width={width} height={height} className="poster-background" aria-hidden="true" />;
}

function PosterCanvas({ poster, selectedId, advancedFilters, onSelect, onMoveLayer, onDropWorkshop }, frameRef) {
  const dragRef = useRef(null);

  const pointFromEvent = (event) => {
    const rect = frameRef.current.getBoundingClientRect();
    const scale = poster.width / rect.width;
    const source = event.touches ? event.touches[0] : event;
    return {
      x: (source.clientX - rect.left) * scale,
      y: (source.clientY - rect.top) * scale
    };
  };

  useEffect(() => {
    const move = (event) => {
      const state = dragRef.current;
      if (!state) return;
      if (event.cancelable) event.preventDefault();
      const point = (() => {
        const rect = frameRef.current.getBoundingClientRect();
        const scale = poster.width / rect.width;
        const source = event.touches ? event.touches[0] : event;
        return {
          x: (source.clientX - rect.left) * scale,
          y: (source.clientY - rect.top) * scale
        };
      })();
      onMoveLayer(state.id, Math.round(point.x - state.offsetX), Math.round(point.y - state.offsetY));
    };
    const end = () => {
      dragRef.current = null;
      document.body.classList.remove('is-dragging-layer');
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
    };
  }, [frameRef, onMoveLayer, poster.width]);

  const startLayerDrag = (event, layer) => {
    if (layer.locked || !layer.visible) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(layer.id);
    const point = pointFromEvent(event);
    dragRef.current = { id: layer.id, offsetX: point.x - layer.x, offsetY: point.y - layer.y };
    document.body.classList.add('is-dragging-layer');
  };

  const drop = (event) => {
    event.preventDefault();
    const specText = event.dataTransfer.getData('application/x-panel-punch');
    if (!specText) return;
    try {
      const spec = JSON.parse(specText);
      const point = pointFromEvent(event);
      onDropWorkshop(spec, point);
    } catch {
      // Drop payloads from other pages are ignored.
    }
  };

  return (
    <div
      ref={frameRef}
      className="poster-frame"
      style={{ aspectRatio: `${poster.width} / ${poster.height}` }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={drop}
    >
      <svg viewBox={`0 0 ${poster.width} ${poster.height}`} className="poster-svg" role="img" aria-label={`${poster.name} 可编辑海报`}>
        <rect width={poster.width} height={poster.height} fill="#efe6d0" />
        {poster.layers.map((layer) => {
          if (!layer.visible) return null;
          if (layer.kind === 'background') {
            return (
              <foreignObject key={layer.id} x="0" y="0" width={poster.width} height={poster.height}>
                <BackgroundCanvas layer={layer} width={poster.width} height={poster.height} seed={poster.seed} />
              </foreignObject>
            );
          }
          const selected = selectedId === layer.id;
          const transform = `translate(${layer.x} ${layer.y}) rotate(${layer.rotation}) scale(${layer.scale || 1}) translate(${-ART_WIDTH / 2} ${-ART_HEIGHT / 2})`;
          return (
            <g
              key={layer.id}
              className={`poster-layer ${selected ? 'selected' : ''} ${layer.locked ? 'locked' : ''}`}
              transform={transform}
              onMouseDown={(event) => startLayerDrag(event, layer)}
              onTouchStart={(event) => startLayerDrag(event, layer)}
              role="button"
              tabIndex="0"
              onClick={() => onSelect(layer.id)}
              onKeyDown={(event) => event.key === 'Enter' && onSelect(layer.id)}
            >
              <rect x="0" y="0" width={ART_WIDTH} height={ART_HEIGHT} fill="transparent" />
              <ImpactArt
                spec={layer.impact}
                filterId={`pp-filter-${layer.id.replace(/[^a-z0-9_-]/gi, '')}`}
                advancedFilters={advancedFilters}
              />
              {selected && <rect x="4" y="4" width={ART_WIDTH - 8} height={ART_HEIGHT - 8} fill="none" className="selection-box" />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export const serializeCurrentSvg = (svgElement, poster) => {
  const clone = svgElement.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', poster.width);
  clone.setAttribute('height', poster.height);
  clone.querySelectorAll('.selection-box').forEach((node) => node.remove());
  clone.querySelectorAll('foreignObject').forEach((node) => {
    const bg = poster.layers.find((layer) => layer.kind === 'background')?.background;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', poster.width);
    rect.setAttribute('height', poster.height);
    rect.setAttribute('fill', bg?.color || '#efe6d0');
    node.replaceWith(rect);
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
};

export default forwardRef(PosterCanvas);
