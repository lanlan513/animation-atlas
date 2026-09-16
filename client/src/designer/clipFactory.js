// 片段文档的创建 / 编辑辅助：全部返回新对象，方便 React state 更新。
import { CAMERA_META, CLIP_DURATION, DEFAULT_CAMERA_PARAMS, LAYER_TYPE_LABEL } from '../constants.js';

let counter = 0;
export const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${(counter += 1).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function emptyClip(name = '未命名的十秒') {
  return { name, duration: CLIP_DURATION, layers: [], cameraActions: [] };
}

// 新图层的默认锚点 / 缩放：背景铺满，角色与特效以合适的初始尺寸入场
function defaultTransform(type) {
  if (type === 'background') return { x: 0, y: 0, scale: 1 };
  if (type === 'character') return { x: 0, y: 0.16, scale: 2.2 };
  if (type === 'shockwave') return { x: 0, y: 0.05, scale: 2 };
  return { x: 0, y: 0, scale: 3.2 }; // 速度线拉满画面
}

export function addLayer(clip, asset, time) {
  const layer = {
    id: uid('lyr'),
    name: asset.name,
    type: asset.type,
    assetId: asset.id,
    keyframes: [{ id: uid('kf'), time: 0, easing: 'linear', x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }]
  };
  const first = { ...layer.keyframes[0], ...defaultTransform(asset.type) };
  layer.keyframes = [first];
  const layers = asset.type === 'background' ? [layer, ...clip.layers] : [...clip.layers, layer];
  return { clip: { ...clip, layers }, layerId: layer.id, keyframeId: first.id };
}

// 在指定时间写入关键帧（同一毫秒去重，直接替换该时刻的值）
export function upsertKeyframe(clip, layerId, time, patch) {
  const rounded = Math.round(time * 1000) / 1000;
  let changed = false;
  const layers = clip.layers.map((layer) => {
    if (layer.id !== layerId) return layer;
    const existing = layer.keyframes.find((kf) => Math.abs(kf.time - rounded) < 0.0005);
    changed = true;
    if (existing) {
      return { ...layer, keyframes: layer.keyframes.map((kf) => kf.id === existing.id ? { ...kf, ...patch } : kf) };
    }
    const prev = [...layer.keyframes].sort((a, b) => b.time - a.time).find((kf) => kf.time <= rounded);
    const next = { id: uid('kf'), time: rounded, easing: 'linear', ...(prev ? { x: prev.x, y: prev.y, scale: prev.scale, rotation: prev.rotation, opacity: prev.opacity } : {}), ...patch };
    return { ...layer, keyframes: [...layer.keyframes, next] };
  });
  return { clip: changed ? { ...clip, layers } : clip, changed, keyframeId: changed ? undefined : undefined };
}

export function updateKeyframe(clip, keyframeId, patch) {
  return {
    ...clip,
    layers: clip.layers.map((layer) => ({
      ...layer,
      keyframes: layer.keyframes.map((kf) => (kf.id === keyframeId ? { ...kf, ...patch } : kf))
    }))
  };
}

export function findKeyframeOwner(clip, keyframeId) {
  for (const layer of clip.layers) {
    const kf = layer.keyframes.find((item) => item.id === keyframeId);
    if (kf) return { layer, keyframe: kf };
  }
  return null;
}

export function deleteKeyframe(clip, keyframeId) {
  return {
    ...clip,
    layers: clip.layers.map((layer) => ({ ...layer, keyframes: layer.keyframes.filter((kf) => kf.id !== keyframeId) }))
  };
}

export function deleteLayer(clip, layerId) {
  return { ...clip, layers: clip.layers.filter((layer) => layer.id !== layerId) };
}

export function renameLayer(clip, layerId, name) {
  return { ...clip, layers: clip.layers.map((layer) => (layer.id === layerId ? { ...layer, name } : layer)) };
}

export function addCameraAction(clip, type, start) {
  const duration = CAMERA_META[type].defaultDuration;
  const end = Math.min(CLIP_DURATION, Math.round((start + duration) * 100) / 100);
  const begin = Math.max(0, Math.round((end - duration) * 100) / 100);
  const action = { id: uid('cam'), type, start: begin, end, params: { ...DEFAULT_CAMERA_PARAMS[type] } };
  return { clip: { ...clip, cameraActions: [...clip.cameraActions, action] }, action };
}

export function updateCameraAction(clip, actionId, patch) {
  return {
    ...clip,
    cameraActions: clip.cameraActions.map((action) => {
      if (action.id !== actionId) return action;
      const next = { ...action, ...patch };
      next.start = Math.max(0, Math.min(next.start, CLIP_DURATION));
      next.end = Math.max(0, Math.min(next.end, CLIP_DURATION));
      if (next.end <= next.start) return action; // 非法时间范围直接拒绝拖动结果
      return next;
    })
  };
}

export function updateCameraParams(clip, actionId, params) {
  return {
    ...clip,
    cameraActions: clip.cameraActions.map((action) => (action.id === actionId ? { ...action, params: { ...action.params, ...params } } : action))
  };
}

export function deleteCameraAction(clip, actionId) {
  return { ...clip, cameraActions: clip.cameraActions.filter((action) => action.id !== actionId) };
}

export { LAYER_TYPE_LABEL };
