import { useEffect, useRef, useState } from 'react';
import { evaluateFrame } from './engine.js';

// 封装关键帧计算 Worker。
//  - document 变化 -> debounce 后重新 BAKE（大批量计算不阻塞 UI）
//  - time/document 变化 -> 主线程先用同一份 engine 立即精确求值并渲染，
//    随后 Worker 用烤好的帧（O(1) 查表）回包确认，保证拖动播放头时零等待、画面正确。
export function useComputeWorker(document, time) {
  const workerRef = useRef(null);
  const reqSeq = useRef(0);
  const docRef = useRef(document);
  const timeRef = useRef(time);
  const bakeTimer = useRef(0);
  const [workerReady, setWorkerReady] = useState(false);
  const [frame, setFrame] = useState(() => evaluateFrame(document, time));

  docRef.current = document;
  timeRef.current = time;

  useEffect(() => {
    const worker = new Worker(new URL('./compute.worker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.kind === 'BAKED') {
        setWorkerReady(true);
        worker.postMessage({ kind: 'SEEK', reqId: ++reqSeq.current, time: timeRef.current, clip: docRef.current });
      } else if (msg.kind === 'FRAME' && msg.reqId === reqSeq.current) {
        setFrame(msg.frame);
      }
    };
    return () => { worker.terminate(); workerRef.current = null; clearTimeout(bakeTimer.current); };
  }, []);

  // 文档 / 时间变化的热路径：主线程立刻给出正确画面。
  // 文档变化时让所有在途的旧烤帧回包失效（reqSeq++），并临时标记未就绪。
  useEffect(() => {
    setFrame(evaluateFrame(document, time));
    if (workerReady) {
      workerRef.current?.postMessage({ kind: 'SEEK', reqId: ++reqSeq.current, time, clip: document });
    }
  }, [document, time, workerReady]);

  // 文档变化 -> 防抖重烤（关键帧很多时不必每次按键都烤 601 帧）
  useEffect(() => {
    setWorkerReady(false);
    reqSeq.current += 1;
    clearTimeout(bakeTimer.current);
    bakeTimer.current = setTimeout(() => {
      workerRef.current?.postMessage({ kind: 'BAKE', clip: docRef.current });
    }, 120);
  }, [document]);

  return { frame, workerReady };
}
