// 战斗镜头设计器的纯计算核心：不依赖 DOM / React，
// 主线程（Worker 尚未烤好帧时的即时预览）与 Web Worker 共用同一份求值逻辑。
import { CLIP_DURATION, FPS } from '../constants.js';

export const LAYER_DEFAULTS = Object.freeze({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });

// ---------- 缓动 ----------
const clamp01 = (u) => (u < 0 ? 0 : u > 1 ? 1 : u);
const easeIn = (u) => u * u;
const easeOut = (u) => 1 - (1 - u) * (1 - u);
const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2);

export function easeValue(u, easing) {
  const v = clamp01(u);
  switch (easing) {
    case 'easeIn': return easeIn(v);
    case 'easeOut': return easeOut(v);
    case 'easeInOut': return easeInOut(v);
    case 'hold': return 0;
    case 'linear':
    default: return v;
  }
}

const lerp = (a, b, u) => a + (b - a) * u;

// 确定性伪随机：震屏在任何标签页 / 任何一次求值中都必须完全一致
export function hashNoise(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1; // [-1, 1]
}

// ---------- 图层关键帧求值 ----------
function sortedKeyframes(layer) {
  return [...(layer.keyframes || [])].sort((a, b) => a.time - b.time);
}

// 二分定位 t 所在的关键帧段
function findSegment(keyframes, t) {
  let lo = 0;
  let hi = keyframes.length - 1;
  if (hi < 0) return null;
  if (t <= keyframes[0].time) return { index: 0, u: 0 };
  if (t >= keyframes[hi].time) return { index: hi, u: 1 };
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].time <= t) lo = mid; else hi = mid;
  }
  const left = keyframes[lo];
  const right = keyframes[lo + 1];
  const raw = (t - left.time) / (right.time - left.time || 1);
  return { index: lo, u: easeValue(raw, left.easing || 'linear') };
}

export function evaluateLayer(layer, t) {
  const keyframes = sortedKeyframes(layer);
  if (keyframes.length === 0) return { ...LAYER_DEFAULTS };
  const seg = findSegment(keyframes, t);
  const left = keyframes[seg.index];
  const right = keyframes[Math.min(seg.index + 1, keyframes.length - 1)];
  const out = {};
  for (const prop of Object.keys(LAYER_DEFAULTS)) {
    const lv = left[prop] ?? LAYER_DEFAULTS[prop];
    const rv = right[prop] ?? LAYER_DEFAULTS[prop];
    out[prop] = seg.u === 0 || keyframes.length === 1 ? lv : lerp(lv, rv, seg.u);
  }
  return out;
}

// ---------- 镜头动作 ----------
// 推镜：前 35% 时长缓速推进，之后保持倍率直到动作结束（结束即切走）
function pushEnvelope(u) {
  return u < 0.35 ? easeInOut(u / 0.35) : 1;
}

function shakeEnvelope(u) {
  // 25% 淡入 / 50% 满振幅 / 25% 淡出
  if (u < 0.25) return easeOut(u / 0.25);
  if (u > 0.75) return easeOut((1 - u) / 0.25);
  return 1;
}

function flashEnvelope(u) {
  // 起点瞬间达峰，短暂保持后线性消退
  return clamp01((1 - u) / 0.9);
}

// 返回某个时间点的合成镜头状态（异类动作可同时存在，同类动作已由服务端保证不重叠）
export function evaluateCamera(actions, t) {
  const cam = { zoom: 1, panX: 0, panY: 0, shakeX: 0, shakeY: 0, flash: 0, frozen: false, frozenAt: 0 };
  let shakeAmp = 0;
  let shakeFreq = 18;
  for (const action of actions || []) {
    if (t < action.start || t > action.end) continue;
    const u = (t - action.start) / (action.end - action.start || 1);
    const p = action.params || {};
    switch (action.type) {
      case 'push': {
        const e = pushEnvelope(u);
        cam.zoom = Math.max(cam.zoom, 1 + ((p.zoom ?? 1.5) - 1) * e);
        cam.panX += (p.x ?? 0) * e;
        cam.panY += (p.y ?? 0) * e;
        break;
      }
      case 'pan': {
        // 横摇：从一侧极值匀速摇到另一侧，中点回到画面中心
        cam.panX += (p.x ?? 0.5) * (u * 2 - 1);
        cam.panY += (p.y ?? 0) * (u * 2 - 1);
        break;
      }
      case 'shake': {
        const amp = (p.amplitude ?? 0.06) * shakeEnvelope(u);
        if (amp > shakeAmp) { // 多个震屏叠加时取最强者，避免无限叠加
          shakeAmp = amp;
          shakeFreq = p.frequency ?? 18;
        }
        break;
      }
      case 'flash':
        cam.flash = Math.max(cam.flash, (p.intensity ?? 1) * flashEnvelope(u));
        break;
      case 'freeze':
        cam.frozen = true;
        cam.frozenAt = action.start;
        break;
      default:
        break;
    }
  }
  if (shakeAmp > 0 && !cam.frozen) {
    // 定格期间冻结画面，震屏也停住
    const tick = Math.floor(t * shakeFreq * 4);
    cam.shakeX = hashNoise(tick + 11) * shakeAmp;
    cam.shakeY = hashNoise(tick + 47) * shakeAmp;
  }
  return cam;
}

// ---------- 整帧精确求值 ----------
export function evaluateFrame(clip, t) {
  const time = Math.max(0, Math.min(CLIP_DURATION, t));
  const camera = evaluateCamera(clip.cameraActions || [], time);
  // 定格：所有图层取定格起点的姿态
  const layerTime = camera.frozen ? camera.frozenAt : time;
  const layers = (clip.layers || []).map((layer) => ({
    layerId: layer.id,
    assetId: layer.assetId,
    type: layer.type,
    ...evaluateLayer(layer, layerTime)
  }));
  return { time, camera, layers };
}

// ---------- Worker 烤帧 ----------
// 把整段时间轴预计算成定长数组：拖播放头时 O(1) 取帧，主线程零插值压力。
export function bakeClip(clip) {
  const count = FPS * CLIP_DURATION + 1; // 0..600，含终点
  const layers = (clip.layers || []).map((layer) => {
    const columns = { x: new Float32Array(count), y: new Float32Array(count), scale: new Float32Array(count), rotation: new Float32Array(count), opacity: new Float32Array(count) };
    for (let i = 0; i < count; i += 1) {
      // 先在“未定格”的时间上求镜头，定格帧的时间重映射在外层处理：
      // 这里直接对真实时间求值，定格时由 findFrame 改用 frozenAt 采样。
      const v = evaluateLayer(layer, (i / (count - 1)) * CLIP_DURATION);
      for (const key of Object.keys(columns)) columns[key][i] = v[key];
    }
    return { layerId: layer.id, assetId: layer.assetId, type: layer.type, columns };
  });
  const cam = {
    zoom: new Float32Array(count),
    panX: new Float32Array(count),
    panY: new Float32Array(count),
    shakeX: new Float32Array(count),
    shakeY: new Float32Array(count),
    flash: new Float32Array(count),
    frozen: new Uint8Array(count),
    frozenAt: new Float32Array(count)
  };
  const frozenLayerIndex = new Int32Array(count).fill(-1); // 定格时应采样的帧下标
  for (let i = 0; i < count; i += 1) {
    const t = (i / (count - 1)) * CLIP_DURATION;
    const c = evaluateCamera(clip.cameraActions || [], t);
    cam.zoom[i] = c.zoom; cam.panX[i] = c.panX; cam.panY[i] = c.panY;
    cam.shakeX[i] = c.shakeX; cam.shakeY[i] = c.shakeY; cam.flash[i] = c.flash;
    cam.frozen[i] = c.frozen ? 1 : 0; cam.frozenAt[i] = c.frozenAt;
    frozenLayerIndex[i] = Math.round((c.frozenAt / CLIP_DURATION) * (count - 1));
  }
  return { count, duration: CLIP_DURATION, fps: FPS, layers, cam, frozenLayerIndex };
}

// 烤帧数据中 O(1) 取帧（拖动播放头的热路径）
export function findFrame(baked, t) {
  const time = Math.max(0, Math.min(baked.duration, t));
  const i = Math.min(baked.count - 1, Math.round((time / baked.duration) * (baked.count - 1)));
  const sample = baked.cam.frozen[i] ? baked.frozenLayerIndex[i] : i;
  return {
    time,
    camera: {
      zoom: baked.cam.zoom[i],
      panX: baked.cam.panX[i],
      panY: baked.cam.panY[i],
      shakeX: baked.cam.shakeX[i],
      shakeY: baked.cam.shakeY[i],
      flash: baked.cam.flash[i],
      frozen: baked.cam.frozen[i] === 1,
      frozenAt: baked.cam.frozenAt[i]
    },
    layers: baked.layers.map((layer) => ({
      layerId: layer.layerId,
      assetId: layer.assetId,
      type: layer.type,
      x: layer.columns.x[sample],
      y: layer.columns.y[sample],
      scale: layer.columns.scale[sample],
      rotation: layer.columns.rotation[sample],
      opacity: layer.columns.opacity[sample]
    }))
  };
}

export { CLIP_DURATION, FPS };
