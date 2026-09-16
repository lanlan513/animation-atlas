import { useEffect, useRef } from 'react';
import { STAGE_W, STAGE_H } from './constants.js';
import { evaluateHenshin, crossedBeats } from './engine.js';
import { RENDERER_FACTORIES } from './renderers/index.js';

// Canvas2D 舞台：DPR 自适应 + 每帧纯求值渲染。
// 粒子状态保存在渲染器闭包内；时间倒退（拖播放头）时渲染器自行清空，保证画面可复现。
export default function CanvasStage({ template, config, timeRef, playing, muted, onSyncTime }) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const templateRef = useRef(template);
  const configRef = useRef(config);
  const playingRef = useRef(playing);
  const mutedRef = useRef(muted);
  const audioRef = useRef(null);
  const lastFrameTime = useRef(-1);
  const lastBeatFrom = useRef(0);
  const frameCount = useRef(0);

  templateRef.current = template;
  configRef.current = config;
  playingRef.current = playing;
  mutedRef.current = muted;

  // 切模板：重建对应渲染器（三种动画逻辑互不相同）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const factory = RENDERER_FACTORIES[template.renderer];
    rendererRef.current = factory ? factory(ctx, STAGE_W, STAGE_H) : null;
    lastFrameTime.current = -1;
  }, [template.renderer]);

  // 播放开始时解锁音频（点击播放是用户手势）
  useEffect(() => {
    if (!playing) return;
    try {
      if (!audioRef.current) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) audioRef.current = new AudioCtx();
      }
      audioRef.current?.resume();
    } catch { /* 不支持音频时静默 */ }
    lastBeatFrom.current = timeRef.current;
  }, [playing, timeRef]);

  useEffect(() => {
    let raf = 0;
    const loop = (nowMs) => {
      const templateNow = templateRef.current;
      const configNow = configRef.current;
      const renderer = rendererRef.current;
      let t = timeRef.current;
      if (renderer && templateNow && configNow) {
        const dt = lastFrameTime.current < 0 ? 0.016 : Math.min(0.05, (nowMs - lastFrameTime.current) / 1000);
        lastFrameTime.current = nowMs;

        // 播放推进时间（ref 直驱，不引起 React 重渲染）；到结尾自动停
        if (playingRef.current) {
          t = Math.min(templateNow.duration, t + dt);
          timeRef.current = t;
          frameCount.current += 1;
          if (frameCount.current % 6 === 0) onSyncTime?.(t); // 低频同步进度条
          if (t >= templateNow.duration) onSyncTime?.(t, true);
        } else {
          lastFrameTime.current = -1;
        }

        const scene = evaluateHenshin(templateNow, configNow, t);
        renderer.render(templateNow, configNow, scene, playingRef.current ? dt : 0);

        // 节拍音效：检测本帧跨过的节拍，强拍音高更低更重
        if (playingRef.current && !mutedRef.current && audioRef.current) {
          const from = Math.max(0, lastBeatFrom.current - 0.001);
          for (const beat of crossedBeats(scene.beats, from, t)) {
            playClick(audioRef.current, scene.downbeats.includes(beat));
          }
        }
        lastBeatFrom.current = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [onSyncTime, timeRef]);

  return (
    <canvas
      ref={canvasRef}
      className="henshin-canvas"
      width={STAGE_W}
      height={STAGE_H}
      aria-label={`${template.name} 变身预览`}
    />
  );
}

// 极简合成器节拍音：短促三角波，无需音频资源
function playClick(audio, isDownbeat) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'triangle';
  osc.frequency.value = isDownbeat ? 660 : 988;
  gain.gain.setValueAtTime(isDownbeat ? 0.16 : 0.08, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (isDownbeat ? 0.16 : 0.08));
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + 0.18);
}
