import { useEffect, useRef } from 'react';
import { Pause, Play, SkipBack } from 'lucide-react';
import { CAMERA_META, CLIP_DURATION, LAYER_TYPE_LABEL } from '../constants.js';

const pct = (t) => `${(t / CLIP_DURATION) * 100}%`;

export default function Timeline({ clip, time, playing, selection, onScrub, onSelect, onMoveKeyframe, onMoveCamera, onAddKeyframe, onTogglePlay }) {
  const tracksRef = useRef(null);
  const drag = useRef(null);

  const timeFromClientX = (clientX) => {
    const rect = tracksRef.current.getBoundingClientRect();
    const t = ((clientX - rect.left) / rect.width) * CLIP_DURATION;
    return Math.max(0, Math.min(CLIP_DURATION, t));
  };

  const beginDrag = (event, mode, payload) => {
    event.preventDefault();
    event.stopPropagation();
    drag.current = { mode, payload, startX: event.clientX, moved: false };
  };

  useEffect(() => {
    const move = (event) => {
      const state = drag.current;
      if (!state) return;
      if (!state.moved && Math.abs(event.clientX - state.startX) < 3) return;
      state.moved = true;
      const t = timeFromClientX(event.clientX);
      if (state.mode === 'playhead') onScrub(t, false);
      if (state.mode === 'keyframe') {
        const { layerId, keyframeId } = state.payload;
        onMoveKeyframe(layerId, keyframeId, Math.round(t * 100) / 100);
      }
      if (state.mode === 'camera-move' || state.mode === 'camera-resize') {
        const { action, edge } = state.payload;
        let { start, end } = action;
        if (state.mode === 'camera-move') {
          const t0 = timeFromClientX(state.startX);
          const dt = t - t0;
          const len = action.end - action.start;
          start = Math.round(Math.max(0, Math.min(CLIP_DURATION - len, action.start + dt)) * 100) / 100;
          end = Math.round((start + len) * 100) / 100;
        } else if (edge === 'start') {
          start = Math.round(Math.min(t, action.end - 0.05) * 100) / 100;
        } else {
          end = Math.round(Math.max(t, action.start + 0.05) * 100) / 100;
        }
        onMoveCamera(action.id, { start, end });
      }
    };
    const up = () => {
      if (drag.current?.mode === 'playhead' && drag.current.moved) onScrub(null, true);
      drag.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [onScrub, onMoveKeyframe, onMoveCamera]);

  const ticks = Array.from({ length: CLIP_DURATION * 2 + 1 }, (_, i) => i / 2);

  return (
    <div className="timeline">
      <div className="tl-transport">
        <button className="tl-btn" onClick={() => onScrub(0, true)} title="回到开头"><SkipBack size={15} /></button>
        <button className="tl-btn primary" onClick={onTogglePlay} title={playing ? '暂停' : '播放'}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <span className="tl-clock">{time.toFixed(2)}<em> / {CLIP_DURATION.toFixed(1)}s</em></span>
        <span className="tl-hint">拖动播放头即时预览 · 双击图层轨道添加关键帧</span>
      </div>
      <div className="tl-body">
        <div className="tl-gutter">
          <div className="tl-gutter-cell ruler-gutter">
            <span>时间</span>
          </div>
          {clip.layers.map((layer) => (
            <button
              key={layer.id}
              className={`tl-gutter-cell layer-gutter ${selection?.kind === 'layer' && selection.layerId === layer.id ? 'active' : ''}`}
              onClick={() => onSelect({ kind: 'layer', layerId: layer.id })}
              title={layer.name}
            >
              <i className={`type-dot ${layer.type}`} />
              <span>{layer.name}</span>
              <em>{layer.keyframes.length}</em>
            </button>
          ))}
          <div className="tl-gutter-cell camera-gutter"><span>镜头行为</span><em>5</em></div>
        </div>

        <div className="tl-tracks" ref={tracksRef}>
          {/* 标尺 */}
          <div className="tl-ruler" onPointerDown={(event) => { onScrub(timeFromClientX(event.clientX), false); beginDrag(event, 'playhead'); }}>
            {ticks.map((tick) => (
              <span key={tick} className={`tl-tick ${Number.isInteger(tick) ? 'major' : ''}`} style={{ left: pct(tick) }}>
                {Number.isInteger(tick) && <b>{tick}</b>}
              </span>
            ))}
          </div>

          {/* 图层行 */}
          {clip.layers.map((layer) => (
            <div
              key={layer.id}
              className={`tl-row ${selection?.kind === 'layer' && selection.layerId === layer.id ? 'active' : ''}`}
              onPointerDown={() => onSelect({ kind: 'layer', layerId: layer.id })}
              onDoubleClick={(event) => onAddKeyframe(layer.id, timeFromClientX(event.clientX))}
            >
              <div className="tl-row-grid" />
              {[...layer.keyframes].sort((a, b) => a.time - b.time).map((kf) => (
                <span
                  key={kf.id}
                  className={`kf-diamond ${kf.easing === 'hold' ? 'hold' : ''} ${selection?.kind === 'keyframe' && selection.keyframeId === kf.id ? 'active' : ''}`}
                  style={{ left: pct(kf.time) }}
                  onPointerDown={(event) => { onSelect({ kind: 'keyframe', keyframeId: kf.id, layerId: layer.id }); beginDrag(event, 'keyframe', { layerId: layer.id, keyframeId: kf.id }); }}
                  title={`${kf.time.toFixed(2)}s · ${kf.easing}`}
                />
              ))}
            </div>
          ))}
          {clip.layers.length === 0 && <div className="tl-row empty-row">从左侧素材库添加角色、冲击波、速度线或背景</div>}

          {/* 镜头行为轨道 */}
          <div className="tl-camera-row">
            <div className="tl-row-grid" />
            {clip.cameraActions.map((action) => {
              const meta = CAMERA_META[action.type];
              const selected = selection?.kind === 'camera' && selection.actionId === action.id;
              return (
                <div
                  key={action.id}
                  className={`cam-clip ${selected ? 'active' : ''}`}
                  style={{ left: pct(action.start), width: pct(action.end - action.start), '--cam-color': meta.color }}
                  onPointerDown={(event) => { onSelect({ kind: 'camera', actionId: action.id }); beginDrag(event, 'camera-move', { action }); }}
                  title={`${meta.label} ${action.start.toFixed(2)}–${action.end.toFixed(2)}s`}
                >
                  <span className="cam-edge start" onPointerDown={(event) => { onSelect({ kind: 'camera', actionId: action.id }); beginDrag(event, 'camera-resize', { action, edge: 'start' }); }} />
                  <span className="cam-label"><i>{meta.glyph}</i>{meta.label}</span>
                  <span className="cam-edge end" onPointerDown={(event) => { onSelect({ kind: 'camera', actionId: action.id }); beginDrag(event, 'camera-resize', { action, edge: 'end' }); }} />
                </div>
              );
            })}
          </div>

          {/* 播放头（覆盖所有轨道） */}
          <div className="playhead" style={{ left: pct(time) }}>
            <div className="playhead-handle" onPointerDown={(event) => beginDrag(event, 'playhead')} />
            <div className="playhead-line" />
          </div>
        </div>
      </div>
      <div className="tl-legend">
        {Object.entries(CAMERA_META).map(([type, meta]) => (
          <span key={type}><i style={{ background: meta.color }} />{meta.label}</span>
        ))}
        <em className="tl-layer-kind-hint">{LAYER_TYPE_LABEL.character} / {LAYER_TYPE_LABEL.shockwave} / {LAYER_TYPE_LABEL.speedline} / {LAYER_TYPE_LABEL.background}</em>
      </div>
    </div>
  );
}
