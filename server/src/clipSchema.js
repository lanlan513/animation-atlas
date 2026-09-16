// 高燃战斗镜头设计器的共享常量与服务端校验。
// 该文件不引入任何 Node / DOM 专有 API，结构上也可以被客户端复用。

export const CLIP_DURATION = 10; // 固定十秒动作片段
export const FPS = 60;

export const LAYER_TYPES = {
  character: 'character',
  shockwave: 'shockwave',
  speedline: 'speedline',
  background: 'background'
};
export const LAYER_TYPE_ORDER = ['background', 'character', 'shockwave', 'speedline'];

export const CAMERA_TYPES = {
  push: 'push',         // 推镜
  pan: 'pan',           // 横摇
  shake: 'shake',       // 震屏
  flash: 'flash',       // 闪白
  freeze: 'freeze'      // 定格
};
export const CAMERA_TYPE_LIST = ['push', 'pan', 'shake', 'flash', 'freeze'];

export const EASINGS = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold'];

// 保存接口的硬性上限（“过大的动作配置”在这里落地）
export const LIMITS = {
  maxBodyBytes: 256 * 1024,
  maxLayers: 24,
  maxKeyframesPerLayer: 120,
  maxCameraActions: 32,
  maxNameLength: 60,
  maxActionParamBytes: 2048
};

// 每种镜头动作允许的参数键、范围与默认值
export const CAMERA_SPECS = {
  push: {
    label: '推镜',
    fields: {
      zoom: { min: 1, max: 3, default: 1.5 },
      x: { min: -1, max: 1, default: 0 },
      y: { min: -1, max: 1, default: 0 }
    }
  },
  pan: {
    label: '横摇',
    fields: {
      x: { min: -1, max: 1, default: 0.5 },
      y: { min: -1, max: 1, default: 0 }
    }
  },
  shake: {
    label: '震屏',
    fields: {
      amplitude: { min: 0, max: 0.2, default: 0.06 }, // 相对画面宽的比例
      frequency: { min: 1, max: 60, default: 18 }
    }
  },
  flash: {
    label: '闪白',
    fields: {
      intensity: { min: 0, max: 1, default: 1 }
    }
  },
  freeze: {
    label: '定格',
    fields: {}
  }
};

export const KEYFRAME_PROPS = {
  x: { min: -1.5, max: 1.5 },
  y: { min: -1.2, max: 1.2 },
  scale: { min: 0.05, max: 6 },
  rotation: { min: -360, max: 360 },
  opacity: { min: 0, max: 1 }
};

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function fail(errors, code, message, path) {
  errors.push({ code, message, path: path || null });
}

// 校验单个关键帧；layerType 决定默认素材锚点是否合理，这里仅做数值范围校验。
function validateKeyframe(kf, index, errors) {
  const path = `keyframes[${index}]`;
  if (!kf || typeof kf !== 'object' || Array.isArray(kf)) { fail(errors, 'BAD_KEYFRAME', '关键帧必须是对象。', path); return; }
  const allowed = new Set(['id', 'time', 'easing', 'x', 'y', 'scale', 'rotation', 'opacity']);
  for (const key of Object.keys(kf)) if (!allowed.has(key)) fail(errors, 'UNKNOWN_FIELD', `关键帧存在未知字段 “${key}”。`, `${path}.${key}`);
  if (!kf.id || typeof kf.id !== 'string' || kf.id.length > 60) fail(errors, 'BAD_ID', '关键帧 id 必须是不超过 60 个字符的字符串。', `${path}.id`);
  if (!isFiniteNumber(kf.time) || kf.time < 0 || kf.time > CLIP_DURATION) fail(errors, 'BAD_TIME', `关键帧时间必须在 0–${CLIP_DURATION} 秒之间。`, `${path}.time`);
  if (kf.easing !== undefined && !EASINGS.includes(kf.easing)) fail(errors, 'BAD_EASING', `缓动必须是 ${EASINGS.join(' / ')} 之一。`, `${path}.easing`);
  for (const [prop, range] of Object.entries(KEYFRAME_PROPS)) {
    if (kf[prop] === undefined) continue;
    if (!isFiniteNumber(kf[prop]) || kf[prop] < range.min || kf[prop] > range.max) {
      fail(errors, 'BAD_RANGE', `关键帧属性 ${prop} 必须是 ${range.min}–${range.max} 之间的数字。`, `${path}.${prop}`);
    }
  }
}

function validateCameraAction(action, index, errors) {
  const path = `cameraActions[${index}]`;
  if (!action || typeof action !== 'object' || Array.isArray(action)) { fail(errors, 'BAD_ACTION', '镜头动作必须是对象。', path); return; }
  const allowed = new Set(['id', 'type', 'start', 'end', 'params']);
  for (const key of Object.keys(action)) if (!allowed.has(key)) fail(errors, 'UNKNOWN_FIELD', `镜头动作存在未知字段 “${key}”。`, `${path}.${key}`);
  if (!action.id || typeof action.id !== 'string' || action.id.length > 60) fail(errors, 'BAD_ID', '镜头动作 id 必须是不超过 60 个字符的字符串。', `${path}.id`);
  const spec = CAMERA_SPECS[action.type];
  if (!spec) { fail(errors, 'BAD_TYPE', `未知镜头类型 “${action.type}”。`, `${path}.type`); return; }
  if (!isFiniteNumber(action.start) || action.start < 0 || action.start > CLIP_DURATION) {
    fail(errors, 'BAD_TIME', `镜头开始时间必须在 0–${CLIP_DURATION} 秒之间。`, `${path}.start`);
  }
  if (!isFiniteNumber(action.end) || action.end <= 0 || action.end > CLIP_DURATION) {
    fail(errors, 'BAD_TIME', `镜头结束时间必须在 0–${CLIP_DURATION} 秒之间。`, `${path}.end`);
  }
  if (isFiniteNumber(action.start) && isFiniteNumber(action.end) && action.end <= action.start) {
    fail(errors, 'BAD_RANGE', '镜头结束时间必须晚于开始时间（非法时间范围）。', path);
  }
  const params = action.params;
  if (params === undefined || params === null || typeof params !== 'object' || Array.isArray(params)) {
    fail(errors, 'BAD_PARAMS', '镜头参数必须是对象。', `${path}.params`);
    return;
  }
  for (const key of Object.keys(params)) {
    if (!(key in spec.fields)) { fail(errors, 'UNKNOWN_FIELD', `${spec.label}不支持参数 “${key}”。`, `${path}.params.${key}`); continue; }
    const range = spec.fields[key];
    if (!isFiniteNumber(params[key]) || params[key] < range.min || params[key] > range.max) {
      fail(errors, 'BAD_RANGE', `${spec.label}参数 ${key} 必须是 ${range.min}–${range.max} 之间的数字。`, `${path}.params.${key}`);
    }
  }
  const serialized = JSON.stringify(params);
  if (serialized.length > LIMITS.maxActionParamBytes) {
    fail(errors, 'CONFIG_TOO_LARGE', `单个镜头动作配置过大（${serialized.length} 字节，上限 ${LIMITS.maxActionParamBytes}）。`, path);
  }
}

/**
 * 完整校验片段文档。
 * @param {object} clip 客户端提交的片段
 * @param {Map<string, string>} assetTypeById 素材 id -> 素材类型
 * @returns {{ valid: boolean, errors: Array }}
 */
export function validateClip(clip, assetTypeById) {
  const errors = [];
  if (!clip || typeof clip !== 'object' || Array.isArray(clip)) return { valid: false, errors: [{ code: 'BAD_CLIP', message: '片段必须是对象。', path: null }] };

  const allowedRoot = new Set(['name', 'duration', 'layers', 'cameraActions']);
  for (const key of Object.keys(clip)) if (!allowedRoot.has(key)) fail(errors, 'UNKNOWN_FIELD', `片段存在未知字段 “${key}”。`, key);

  if (typeof clip.name !== 'string' || !clip.name.trim()) fail(errors, 'BAD_NAME', '片段名称不能为空。', 'name');
  else if (clip.name.length > LIMITS.maxNameLength) fail(errors, 'BAD_NAME', `片段名称不能超过 ${LIMITS.maxNameLength} 个字符。`, 'name');

  if (clip.duration !== CLIP_DURATION) fail(errors, 'BAD_DURATION', `片段时长必须固定为 ${CLIP_DURATION} 秒。`, 'duration');

  const layers = clip.layers;
  if (!Array.isArray(layers)) { fail(errors, 'BAD_LAYERS', '图层必须是数组。', 'layers'); return { valid: false, errors }; }
  if (layers.length > LIMITS.maxLayers) fail(errors, 'TOO_MANY_LAYERS', `图层数量不能超过 ${LIMITS.maxLayers}。`, 'layers');

  const seenIds = new Set();
  const takeId = (id, path) => {
    if (!id) return;
    if (seenIds.has(id)) fail(errors, 'DUP_ID', `id “${id}” 在片段中重复。`, path);
    seenIds.add(id);
  };

  layers.forEach((layer, layerIndex) => {
    const path = `layers[${layerIndex}]`;
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) { fail(errors, 'BAD_LAYER', '图层必须是对象。', path); return; }
    const allowed = new Set(['id', 'name', 'type', 'assetId', 'keyframes']);
    for (const key of Object.keys(layer)) if (!allowed.has(key)) fail(errors, 'UNKNOWN_FIELD', `图层存在未知字段 “${key}”。`, `${path}.${key}`);
    if (!layer.id || typeof layer.id !== 'string' || layer.id.length > 60) fail(errors, 'BAD_ID', '图层 id 必须是不超过 60 个字符的字符串。', `${path}.id`);
    else takeId(layer.id, `${path}.id`);
    if (typeof layer.name !== 'string' || !layer.name.trim() || layer.name.length > LIMITS.maxNameLength) {
      fail(errors, 'BAD_NAME', `图层名称必须是 1–${LIMITS.maxNameLength} 个字符。`, `${path}.name`);
    }
    if (!LAYER_TYPE_ORDER.includes(layer.type)) fail(errors, 'BAD_TYPE', `未知图层类型 “${layer.type}”。`, `${path}.type`);
    if (typeof layer.assetId !== 'string' || !layer.assetId) fail(errors, 'MISSING_ASSET', '图层缺少素材引用。', `${path}.assetId`);
    else if (!assetTypeById.has(layer.assetId)) fail(errors, 'MISSING_ASSET', `素材 “${layer.assetId}” 在素材库中不存在（缺失素材）。`, `${path}.assetId`);
    else if (assetTypeById.get(layer.assetId) !== layer.type) fail(errors, 'ASSET_TYPE_MISMATCH', `素材 “${layer.assetId}” 的类型与图层类型 “${layer.type}” 不一致（缺失素材）。`, `${path}.assetId`);
    if (!Array.isArray(layer.keyframes)) { fail(errors, 'BAD_KEYFRAMES', '关键帧必须是数组。', `${path}.keyframes`); return; }
    if (layer.keyframes.length > LIMITS.maxKeyframesPerLayer) {
      fail(errors, 'TOO_MANY_KEYFRAMES', `单层关键帧不能超过 ${LIMITS.maxKeyframesPerLayer}。`, `${path}.keyframes`);
    }
    const times = [];
    layer.keyframes.forEach((kf, kfIndex) => {
      validateKeyframe(kf, kfIndex, errors);
      if (kf && isFiniteNumber(kf.time)) times.push({ time: kf.time, id: kf.id, path: `${path}.keyframes[${kfIndex}]` });
      if (kf?.id) takeId(kf.id, `${path}.keyframes[${kfIndex}].id`);
    });
    times.sort((a, b) => a.time - b.time);
    for (let i = 1; i < times.length; i += 1) {
      if (times[i].time === times[i - 1].time) fail(errors, 'BAD_TIME', `同一图层在 ${times[i].time.toFixed(3)}s 存在重复关键帧（非法时间范围）。`, times[i].path);
    }
  });

  const actions = clip.cameraActions;
  if (!Array.isArray(actions)) { fail(errors, 'BAD_ACTIONS', '镜头动作必须是数组。', 'cameraActions'); return { valid: false, errors }; }
  if (actions.length > LIMITS.maxCameraActions) fail(errors, 'TOO_MANY_ACTIONS', `镜头动作不能超过 ${LIMITS.maxCameraActions} 个。`, 'cameraActions');
  actions.forEach((action, index) => {
    validateCameraAction(action, index, errors);
    if (action?.id) takeId(action.id, `cameraActions[${index}].id`);
  });
  // 同类镜头动作不允许时间重叠（不同类可叠加，例如震屏中闪白）
  for (let i = 0; i < actions.length; i += 1) {
    for (let j = i + 1; j < actions.length; j += 1) {
      const a = actions[i];
      const b = actions[j];
      if (!a || !b || a.type !== b.type) continue;
      if ([a.start, a.end, b.start, b.end].some((v) => !isFiniteNumber(v))) continue;
      if (a.start < b.end && b.start < a.end) {
        fail(errors, 'OVERLAP_ACTION', `${CAMERA_SPECS[a.type].label}动作的时间范围重叠（非法时间范围）。`, `cameraActions[${j}]`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// 补全默认值，保证入库 / 求值时字段齐全
export function withDefaults(clip) {
  return {
    name: clip.name,
    duration: CLIP_DURATION,
    layers: (clip.layers || []).map((layer) => ({
      id: layer.id,
      name: layer.name,
      type: layer.type,
      assetId: layer.assetId,
      keyframes: (layer.keyframes || []).map((kf) => ({
        id: kf.id,
        time: kf.time,
        easing: kf.easing || 'linear',
        x: kf.x ?? 0,
        y: kf.y ?? 0,
        scale: kf.scale ?? 1,
        rotation: kf.rotation ?? 0,
        opacity: kf.opacity ?? 1
      }))
    })),
    cameraActions: (clip.cameraActions || []).map((action) => {
      const defaults = Object.fromEntries(Object.entries(CAMERA_SPECS[action.type]?.fields || {}).map(([key, spec]) => [key, spec.default]));
      return { id: action.id, type: action.type, start: action.start, end: action.end, params: { ...defaults, ...action.params } };
    })
  };
}
