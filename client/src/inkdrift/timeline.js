// 时间轴：把操作日志整理成可播放的生长序列。
// 笔画按录制时的真实起止时间生长；元素按用户设定的 appearAt 独立出现。

export function buildTimeline(effectiveOps) {
  const items = [];
  let maxEnd = 0;
  let strokeCursor = 0; // 没有录制时间的旧数据按顺序排
  for (const op of effectiveOps) {
    if (op.kind === 'stroke') {
      const t0 = op.t0 != null ? op.t0 : strokeCursor;
      const dur = Math.max(0.15, op.dur || 0.6);
      items.push({ op, t0, t1: t0 + dur });
      strokeCursor = t0 + dur;
      maxEnd = Math.max(maxEnd, t0 + dur);
    } else if (op.kind === 'element') {
      const t0 = Math.max(0, op.appearAt || 0);
      const dur = Math.max(0.2, op.duration || 2.5);
      items.push({ op, t0, t1: t0 + dur });
      maxEnd = Math.max(maxEnd, t0 + dur);
    }
  }
  items.sort((a, b) => a.t0 - b.t0);
  return { items, duration: maxEnd };
}

export function progressAt(item, t) {
  if (t <= item.t0) return 0;
  if (t >= item.t1) return 1;
  return (t - item.t0) / (item.t1 - item.t0);
}
