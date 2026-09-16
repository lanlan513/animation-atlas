import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Aperture, Camera, CameraOff, ImagePlus, LoaderCircle, RefreshCw, ScanEye } from 'lucide-react';
import { mediaUrl } from '../api.js';
import { compressImage } from '../lib/image.js';

const CAMERA_CONSTRAINTS = [
  { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
  { video: true, audio: false }
];

export default function CameraStage({ frames, ghostFrame, settings, busy, autoFallback, onCapture, onSwitchImport, onNotice }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState('starting'); // starting | ready | denied | error
  const [errorMessage, setErrorMessage] = useState('');
  const [capturing, setCapturing] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async ({ autoFallback = true } = {}) => {
    setStatus('starting');
    setErrorMessage('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('denied');
      setErrorMessage('当前浏览器不支持摄像头调用。');
      if (autoFallback) onSwitchImport('当前浏览器不支持摄像头，已切换为图片导入。');
      return;
    }
    let lastError = null;
    for (const constraints of CAMERA_CONSTRAINTS) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus('ready');
        return;
      } catch (error) {
        lastError = error;
      }
    }
    stopStream();
    const denied = lastError && ['NotAllowedError', 'SecurityError', 'NotFoundError', 'NotReadableError'].includes(lastError.name);
    setStatus(denied ? 'denied' : 'error');
    const message = denied
      ? '摄像头权限被拒绝（或没有检测到摄像头）。可以点「重新授权」，或直接用图片导入逐帧对齐。'
      : `摄像头无法启动：${lastError?.message || '未知错误'}`;
    setErrorMessage(message);
    if (autoFallback) onSwitchImport(message);
  }, [onSwitchImport, stopStream]);

  useEffect(() => {
    startCamera({ autoFallback });
    return () => stopStream();
    // 只在挂载时尝试一次；autoFallback 在 Studio 里对「手动切回」固定为 false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const takePhoto = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || capturing || busy) return;
    setCapturing(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.drawImage(video, 0, 0);
      const rawBlob = await new Promise((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('抓拍失败'))), 'image/jpeg', 0.92));
      // 客户端先压一遍，避免原始视频帧/原图直传
      const { blob } = await compressImage(rawBlob);
      await onCapture(blob);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setCapturing(false);
    }
  }, [busy, capturing, onCapture, onNotice]);

  // 空格抓拍
  useEffect(() => {
    const onKey = (event) => {
      if (status !== 'ready' || event.code !== 'Space') return;
      const target = event.target;
      if (target && ['INPUT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return;
      event.preventDefault();
      takePhoto();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, takePhoto]);

  const ghostVisible = settings.ghostVisible !== false && ghostFrame;

  return (
    <div className="camera-stage">
      <div className="viewport">
        <video ref={videoRef} className="camera-video" muted playsInline />
        {ghostVisible && (
          <img
            className="ghost-layer"
            src={mediaUrl(ghostFrame.imageUrl)}
            alt="上一帧残影"
            style={{ opacity: settings.ghostOpacity ?? 0.5, display: status === 'ready' ? 'block' : 'none' }}
            draggable={false}
          />
        )}
        {status === 'starting' && (
          <div className="viewport-overlay">
            <LoaderCircle className="spin" size={26} />
            <span>正在请求摄像头权限…</span>
          </div>
        )}
        {status === 'denied' && (
          <div className="viewport-overlay denied">
            <CameraOff size={26} />
            <span>{errorMessage}</span>
            <div className="overlay-actions">
              <button className="button secondary" onClick={startCamera}><RefreshCw size={15} />重新授权</button>
              <button className="button primary" onClick={() => onSwitchImport('')}><ImagePlus size={15} />直接导入图片</button>
            </div>
          </div>
        )}
        {status === 'error' && (
          <div className="viewport-overlay denied">
            <CameraOff size={26} />
            <span>{errorMessage}</span>
            <div className="overlay-actions">
              <button className="button secondary" onClick={startCamera}><RefreshCw size={15} />重试</button>
              <button className="button primary" onClick={() => onSwitchImport('')}><ImagePlus size={15} />改用图片导入</button>
            </div>
          </div>
        )}
        {ghostVisible && <div className="ghost-flag"><ScanEye size={13} />残影对齐 · 第 {ghostFrame.order + 1} 帧</div>}
        <div className="frame-flag">{String(frames.length + 1).padStart(3, '0')} · 下一帧</div>
      </div>
      <div className="stage-controls">
        <button className="shutter" disabled={status !== 'ready' || capturing || busy} onClick={takePhoto} title="拍摄这一帧（空格）">
          {capturing || busy ? <LoaderCircle className="spin" size={22} /> : <Aperture size={22} />}
          <span>{capturing ? '压缩上传中' : '拍摄这一帧'}</span>
        </button>
        <p className="stage-hint">
          <Camera size={13} /> 半透明的上一帧残影叠在实时画面上，移动黏土模型对齐轮廓后按空格或点击拍摄。
        </p>
      </div>
    </div>
  );
}
