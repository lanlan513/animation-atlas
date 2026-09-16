import { useCallback, useEffect, useRef, useState } from 'react';

export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);

/* 镜头（viewBox 矩形）状态 + 补间飞行动画。
 * cameraRef 始终保存最新值，供缩放等即时计算使用。 */
export function useCamera(initial = null) {
  const [camera, setCamera] = useState(initial);
  const cameraRef = useRef(initial);
  const flightRef = useRef(null);

  const cancel = useCallback(() => {
    if (flightRef.current) cancelAnimationFrame(flightRef.current);
    flightRef.current = null;
  }, []);

  const flyTo = useCallback((target, duration = 760, onDone) => {
    cancel();
    const from = cameraRef.current;
    if (!from || !target || duration <= 0) {
      cameraRef.current = target;
      setCamera(target);
      onDone?.();
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const k = easeInOutCubic(t);
      const next = {
        x: from.x + (target.x - from.x) * k,
        y: from.y + (target.y - from.y) * k,
        w: from.w + (target.w - from.w) * k,
        h: from.h + (target.h - from.h) * k
      };
      cameraRef.current = next;
      setCamera(next);
      if (t < 1) flightRef.current = requestAnimationFrame(step);
      else { flightRef.current = null; onDone?.(); }
    };
    flightRef.current = requestAnimationFrame(step);
  }, [cancel]);

  useEffect(() => cancel, [cancel]);
  return [camera, flyTo, cancel, cameraRef];
}
