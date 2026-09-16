// 笔触采样器：把原始 pointer 事件流变成稀疏、带压力与停顿信息的采样点。
// 解决两个问题：
//  1. 触屏没有压感 —— 用速度反推压力(慢=重=浓)，停顿时压力与晕墨增强。
//  2. 高刷新率下点过密 —— 距离/转角/停顿三重阈值抽稀，端点必保留。

export const DEFAULTS = {
  minDist: 2.4,        // 世界坐标下的最小采样间距
  minAngle: 0.32,      // 方向突变超过该弧度必保留(保证转折不丢形)
  dwellMs: 90,         // 原地停留超过该时长记一次停顿(晕墨)
  dwellDist: 1.6,      // 位移小于该值视为"原地"
  maxPoints: 2400,     // 单笔采样点硬上限，防止超长笔划撑爆内存/网络
  speedRef: 2.6,       // 参考速度(px/ms)，达到时压力降到最低
  minPressure: 0.14,
  maxPressure: 1.0,
  smoothing: 0.55      // 压力指数平滑系数(越大越跟手)
};

export function simulatePressure(speed, dwell, opts = DEFAULTS) {
  // 速度越快压力越小(枯笔/飞白)，停顿会"按"下去(涨墨)。
  let p = opts.maxPressure - (speedOf(speed, opts.speedRef)) * (opts.maxPressure - opts.minPressure);
  if (dwell > 0) p += Math.min(0.25, dwell / 1200);
  return clamp(p, opts.minPressure, opts.maxPressure);
}

function speedOf(speed, ref) { return clamp(speed / ref, 0, 1); }
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export class StrokeSampler {
  constructor(opts = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this.points = [];       // 已接受的采样点 {x,y,p,t,dwell}
    this.lastRaw = null;    // 上一个原始点(算速度)
    this.lastKept = null;   // 上一个被保留的点(算间距/转角)
    this.prevAngle = null;
    this.dwellAcc = 0;
    this.pressure = 0.7;    // 平滑后的当前压力
    this.overflow = false;
  }

  begin(x, y, t, nativePressure = 0) {
    this.reset();
    this.hasNativePressure = nativePressure > 0 && nativePressure !== 0.5;
    const p = this.hasNativePressure ? nativePressure : this.pressure;
    const pt = { x, y, p, t, dwell: 0 };
    this.points.push(pt);
    this.lastRaw = pt;
    this.lastKept = pt;
    return pt;
  }

  // 返回本次新接受的点(可能为空数组 —— 被抽稀掉了)
  push(x, y, t, nativePressure = 0) {
    if (this.overflow) return [];
    const last = this.lastRaw;
    if (!last) return this.begin(x, y, t, nativePressure) ? [this.points[0]] : [];

    const dt = Math.max(1, t - last.t);
    const dx = x - last.x;
    const dy = y - last.y;
    const dist = Math.hypot(dx, dy);
    const speed = dist / dt;

    // 停顿累积：几乎没动就计时，用于晕墨与增压
    if (dist < this.opts.dwellDist) this.dwellAcc += dt;
    else this.dwellAcc = 0;
    const dwell = this.dwellAcc >= this.opts.dwellMs ? this.dwellAcc : 0;

    const raw = { x, y, t, speed, dwell };
    this.lastRaw = raw;

    // ---- 抽稀判定 ----
    const kept = this.lastKept;
    const distFromKept = Math.hypot(x - kept.x, y - kept.y);
    const angle = distFromKept > 1e-6 ? Math.atan2(y - kept.y, x - kept.x) : this.prevAngle;
    const turned = this.prevAngle != null && angle != null &&
      Math.abs(normAngle(angle - this.prevAngle)) > this.opts.minAngle;
    const isDwell = dwell > 0 && kept.dwell === undefined || (dwell > 0 && dwell - (kept.dwell || 0) > 120);

    if (distFromKept < this.opts.minDist && !turned && !isDwell) return [];

    // ---- 压力 ----
    let p;
    if (nativePressure > 0 && nativePressure !== 0.5) {
      p = nativePressure; // 真压感(手写笔)
    } else {
      const target = simulatePressure(speed, dwell, this.opts);
      this.pressure = this.pressure + (target - this.pressure) * (1 - this.opts.smoothing);
      p = this.pressure;
    }

    const pt = { x, y, p: clamp(p, 0, 1), t, dwell };
    this.points.push(pt);
    this.lastKept = pt;
    this.prevAngle = angle;
    if (this.points.length >= this.opts.maxPoints) this.overflow = true;
    return [pt];
  }

  end(x, y, t) {
    // 终点必保留，避免笔锋被截断
    const kept = this.lastKept;
    if (kept && Math.hypot(x - kept.x, y - kept.y) > 0.5) {
      const pt = { x, y, p: this.pressure * 0.6, t, dwell: 0 };
      this.points.push(pt);
    }
    return this.points;
  }
}

function normAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// 把采样点序列压缩成可传输的紧凑数组 [x,y,p,t,dwell?]
export function packPoints(points) {
  return points.map((p) => {
    const row = [round1(p.x), round1(p.y), round2(p.p), p.t];
    if (p.dwell) row.push(p.dwell);
    return row;
  });
}

export function unpackPoints(packed) {
  return packed.map((row) => ({ x: row[0], y: row[1], p: row[2], t: row[3], dwell: row[4] || 0 }));
}

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

// 从采样点提取停顿晕墨点(半径与强度由停顿时长决定)
export function extractBleeds(points) {
  const bleeds = [];
  for (const p of points) {
    if (p.dwell >= 90) {
      bleeds.push([round1(p.x), round1(p.y), Math.min(46, 10 + p.dwell / 28), Math.min(0.5, 0.12 + p.dwell / 2600)]);
    }
  }
  return bleeds;
}
