import { Pause, Play } from 'lucide-react';
import { mergedBeats } from './engine.js';

// 节拍时间轴：镜头块（顺序与颜色由模板定义）+ 音轨节拍刻度 + 可拖动播放头。
// 三个模板的镜头数量 / 时长完全不同（5 / 6 / 4 镜），这里按数据驱动呈现。
export default function BeatTimeline({ template, config, time, playing, muted, onScrub, onTogglePlay, onToggleMute }) {
  const pct = (t) => `${(t / template.duration) * 100}%`;
  const { beats, downbeats, track } = mergedBeats(template, config);

  const handlePointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const t = Math.max(0, Math.min(template.duration, ((event.clientX - rect.left) / rect.width) * template.duration));
    onScrub(Math.round(t * 1000) / 1000);
  };

  return (
    <div className="henshin-transport">
      <button className="henshin-play" onClick={onTogglePlay} title={playing ? '暂停（空格）' : '播放（空格）'}>
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <button className={`henshin-mute ${muted ? 'is-muted' : ''}`} onClick={onToggleMute} title="节拍音">
        {muted ? '🔇' : '🔊'}
      </button>
      <div className="henshin-timeline" onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); handlePointer(event); }} onPointerMove={(event) => { if (event.buttons === 1) handlePointer(event); }}>
        <div className="henshin-shots">
          {template.shots.map((shot, index) => (
            <div
              key={shot.id}
              className={`henshin-shot ${time >= shot.start && (index === template.shots.length - 1 || time < shot.end) ? 'active' : ''}`}
              style={{ left: pct(shot.start), width: pct(shot.end - shot.start) }}
              title={`${index + 1}. ${shot.name}（${shot.anim}）\n${shot.note}`}
            >
              <span className="henshin-shot-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="henshin-shot-name">{shot.name}</span>
            </div>
          ))}
        </div>
        <div className="henshin-beat-row">
          {beats.map((beat, index) => (
            <i key={`${beat}-${index}`} className={downbeats.includes(beat) ? 'downbeat' : ''} style={{ left: pct(beat) }} title={`${downbeats.includes(beat) ? '重拍' : '节拍'} ${beat.toFixed(2)}s`} />
          ))}
        </div>
        <div className="henshin-playhead" style={{ left: pct(time) }} />
      </div>
      <div className="henshin-timecode">
        <strong>{time.toFixed(2)}</strong><span> / {template.duration}s</span>
        <small>{track?.name}</small>
      </div>
    </div>
  );
}
