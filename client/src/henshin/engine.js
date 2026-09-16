// 变身演出台的纯计算核心：不依赖 DOM / React / Canvas。
// 输入模板定义 + 用户配置 + 时间 t，输出渲染器需要的确定性场景状态：
// 当前镜头、镜头内进度、节拍命中强度、符号与音轨信息。
// 粒子的「出生」也在这里决定（确定性），渲染器只负责绘制，保证拖播放头画面可复现。

const clamp01 = (u) => (u < 0 ? 0 : u > 1 ? 1 : u);
export const easeInOut = (u) => { const v = clamp01(u); return v < 0.5 ? 2 * v * v : 1 - ((-2 * v + 2) ** 2) / 2; };
export const easeOut = (u) => 1 - (1 - clamp01(u)) ** 2;
export const easeIn = (u) => clamp01(u) ** 2;

// 当前镜头（命中边界时刻属于新镜头）
export function activeShot(template, t) {
  const shots = template.shots || [];
  for (let i = 0; i < shots.length; i += 1) {
    if (t >= shots[i].start && (i === shots.length - 1 || t < shots[i].end)) {
      return { shot: shots[i], index: i, u: (t - shots[i].start) / (shots[i].end - shots[i].start) };
    }
  }
  const last = shots[shots.length - 1];
  return last ? { shot: last, index: shots.length - 1, u: 1 } : { shot: null, index: -1, u: 0 };
}

// 合并模板音轨节拍与用户追加节拍，返回排序后的时间轴
export function mergedBeats(template, config) {
  const track = (template.tracks || []).find((item) => item.id === config?.trackId) || template.tracks?.[0];
  const beats = [...(track?.beats || []), ...(config?.customBeats || [])]
    .filter((time, index, all) => all.indexOf(time) === index)
    .sort((a, b) => a - b);
  return { track, beats, downbeats: track?.downbeats || [] };
}

// 节拍脉冲：命中点附近指数衰减；强拍（downbeat）幅度更高
export function beatPulse(beats, downbeats, t, windowMs = 0.16) {
  let pulse = 0;
  let nearest = null;
  for (const beat of beats) {
    const dt = t - beat;
    if (dt < -windowMs || dt > windowMs) continue;
    const strength = downbeats.includes(beat) ? 1 : 0.55;
    const value = strength * Math.exp(-Math.abs(dt) / (windowMs * 0.42));
    if (value > pulse) { pulse = value; nearest = beat; }
  }
  return { pulse, nearest, isDownbeat: nearest !== null && downbeats.includes(nearest) };
}

// 确定性伪随机（粒子出生点 / 散点在任何一次求值中完全一致）
export function hashNoise(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 整帧场景求值。渲染器据此作画；particles 是「截至此刻应该存活」的确定性粒子集。
 * 粒子数量受控（按模板 fx.particles 与节拍生成），避免无限增长。
 */
export function evaluateHenshin(template, config, t) {
  const time = Math.max(0, Math.min(template.duration, t));
  const { shot, index, u } = activeShot(template, time);
  const { track, beats, downbeats } = mergedBeats(template, config);
  const beat = beatPulse(beats, downbeats, time);
  const symbol = (template.symbols || []).find((item) => item.id === config?.glowSymbol) || template.symbols?.[0];

  return {
    time,
    duration: template.duration,
    shot,
    shotIndex: index,
    shotU: clamp01(u),
    track,
    beats,
    downbeats,
    beat,
    symbol,
    // 镜头边界切换信号：渲染器在边界做一次爆发
    shotEnter: shot ? clamp01((time - shot.start) / 0.28) : 0,
    shotExit: shot ? clamp01((shot.end - time) / 0.28) : 0
  };
}

// 节拍触发判断（供音效调度）：返回时间区间 (from, to] 内新跨过的节拍
export function crossedBeats(beats, from, to) {
  return beats.filter((beat) => beat > from && beat <= to);
}
