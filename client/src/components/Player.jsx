import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, LoaderCircle, Pause, Play, SkipBack, X } from 'lucide-react';
import { mediaUrl } from '../api.js';
import { formatDuration } from '../lib/image.js';

export default function Player({ frames, onClose }) {
  const canvasRef = useRef(null);
  const imagesRef = useRef([]);
  const [current, setCurrent] = useState(0);
  // 点「播放」时从当前滑杆位置开始；循环期间不被外部 state 重置。
  const playStartRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');

  const totalMs = useMemo(() => frames.reduce((sum, frame) => sum + frame.durationMs, 0), [frames]);
  const fps = totalMs > 0 ? Math.round(frames.length / (totalMs / 1000) * 10) / 10 : 0;

  // 预加载全部帧；不使用 createObjectURL，img 直接指向服务端（已缓存）。
  useEffect(() => {
    let cancelled = false;
    Promise.all(frames.map((frame) => new Promise((resolve) => {
      const img = new Image();
      // 必须在赋 src 前声明 anonymous：否则跨端口加载的帧会污染 canvas，
      // MediaRecorder 导出 WebM 时会抛 SecurityError。服务端媒体路由已带 CORS 头。
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = mediaUrl(frame.imageUrl);
    }))).then((loaded) => {
      if (cancelled) return;
      imagesRef.current = loaded;
      durationsRef.current = frames.map((frame) => frame.durationMs);
      draw(0);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = useCallback((index) => {
    const canvas = canvasRef.current;
    const img = imagesRef.current[index];
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (img && img.naturalWidth) {
      if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      ctx.drawImage(img, 0, 0);
    } else {
      ctx.fillStyle = '#141519';
      ctx.fillRect(0, 0, Math.max(1, canvas.width), Math.max(1, canvas.height));
    }
  }, []);

  // 播放状态用 ref 驱动，rAF 循环在挂载时建立一次、卸载时销毁，
  // 推进过程中不会因为 React 重渲染而被取消/重启（否则时间轴会反复归零）。
  const playingRef = useRef(false);
  const loopRef = useRef(true);
  const indexRef = useRef(0);
  const startAtRef = useRef(0);
  const durationsRef = useRef([]);
  useEffect(() => { loopRef.current = loop; }, [loop]);

  useEffect(() => {
    let rafId;
    const frame = (time) => {
      if (playingRef.current) {
        const durations = durationsRef.current;
        let elapsed = time - startAtRef.current;
        let next = indexRef.current;
        let acc = 0;
        for (let i = next; i < durations.length; i++) {
          acc += durations[i];
          if (acc > elapsed) { next = i; break; }
          next = i + 1;
        }
        if (next >= durations.length) {
          if (loopRef.current) { next = 0; startAtRef.current = time; elapsed = 0; }
          else {
            playingRef.current = false;
            setPlaying(false);
            next = durations.length - 1;
          }
        }
        if (next !== indexRef.current) {
          indexRef.current = next;
          setCurrent(next);
          draw(next);
        }
      }
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [draw]);

  useEffect(() => {
    if (playing) {
      indexRef.current = Math.min(playStartRef.current, durationsRef.current.length - 1);
      startAtRef.current = performance.now();
    }
    playingRef.current = playing;
  }, [playing]);

  const showFrame = (index) => {
    playingRef.current = false;
    setPlaying(false);
    playStartRef.current = index;
    indexRef.current = index;
    setCurrent(index);
    draw(index);
  };

  const togglePlay = () => {
    if (playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
    } else {
      // 暂停/拖动后再播放，从当前帧继续
      const start = Math.min(current, frames.length - 1);
      playStartRef.current = start;
      indexRef.current = start;
      startAtRef.current = performance.now();
      playingRef.current = true;
      setPlaying(true);
    }
  };

  const exportWebm = async () => {
    if (exporting || frames.length < 2) return;
    setExporting(true);
    setExportStatus('准备画布…');
    try {
      const canvas = canvasRef.current;
      // 用固定帧率的流：requestFrame 在 Chromium 上立即抓帧，
      // 其他浏览器则由 30fps 轨道在每帧停留期间自动采集。
      const stream = canvas.captureStream(30);
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported?.(type));
      if (!mime) throw new Error('当前浏览器不支持 WebM 录制，可直接用预览播放成片。');
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      const chunks = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      const done = new Promise((resolve) => { recorder.onstop = resolve; });
      recorder.start();

      for (let i = 0; i < frames.length; i++) {
        setExportStatus(`正在合成第 ${i + 1}/${frames.length} 帧`);
        draw(i);
        setCurrent(i);
        stream.getVideoTracks()[0].requestFrame?.();
        await wait(frames[i].durationMs);
      }
      recorder.stop();
      await done;
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `framemold-${Date.now()}.webm`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setExportStatus('');
    } catch (error) {
      setExportStatus(`导出失败：${error.message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="modal-backdrop player-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !exporting && onClose()}>
      <div className="player-modal">
        <div className="player-head">
          <div>
            <p className="eyebrow">PLAYBACK / STOP-MOTION</p>
            <h2>定格短片预览</h2>
          </div>
          <button className="icon-button" onClick={onClose} disabled={exporting}><X size={18} /></button>
        </div>
        <div className="player-canvas-wrap">
          <canvas ref={canvasRef} width={480} height={270} />
          {exporting && <div className="export-banner"><LoaderCircle className="spin" size={15} />{exportStatus}</div>}
        </div>
        <div className="player-meta">
          <span>{frames.length} 帧</span>
          <span>≈ {fps} fps</span>
          <span>总长 {formatDuration(totalMs)}</span>
          <label className="loop-toggle">
            <input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} />循环播放
          </label>
        </div>
        <div className="player-scrub">
          <input
            type="range"
            min={0}
            max={Math.max(0, frames.length - 1)}
            value={current}
            onChange={(event) => showFrame(Number(event.target.value))}
          />
        </div>
        <div className="player-controls">
          <button className="icon-button" onClick={() => showFrame(0)} title="回到首帧"><SkipBack size={16} /></button>
          <button className="button primary play-button" onClick={togglePlay} disabled={frames.length < 2}>
            {playing ? <Pause size={17} /> : <Play size={17} />}
            {playing ? '暂停' : '播放'}
          </button>
          <button className="button secondary" onClick={exportWebm} disabled={exporting || frames.length < 2}>
            {exporting ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}导出 WebM
          </button>
        </div>
      </div>
    </div>
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(60, ms)));
}
