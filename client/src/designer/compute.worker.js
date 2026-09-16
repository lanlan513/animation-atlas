// 关键帧 / 镜头的大批量计算全部在 Worker 中完成：
//  - BAKE：文档变化后把 601 个采样帧全部预计算（每图层 5 个 Float32 数组 + 镜头数组）
//  - SEEK：O(1) 取帧；播放时由主线程按 rAF 批量拉取，Worker 零插值压力
import { bakeClip, findFrame, evaluateFrame } from './engine.js';

let baked = null;

self.onmessage = (event) => {
  const { kind, reqId } = event.data || {};
  if (kind === 'BAKE') {
    const t0 = performance.now();
    baked = bakeClip(event.data.clip);
    self.postMessage({ kind: 'BAKED', reqId, count: baked.count, ms: Math.round(performance.now() - t0) });
    return;
  }
  if (kind === 'SEEK') {
    if (baked) {
      self.postMessage({ kind: 'FRAME', reqId, frame: findFrame(baked, event.data.time) });
    } else {
      // 烤帧完成前的兜底：精确求值（仍在 Worker 线程，不阻塞 UI）
      self.postMessage({ kind: 'FRAME', reqId, frame: evaluateFrame(event.data.clip, event.data.time) });
    }
  }
};
