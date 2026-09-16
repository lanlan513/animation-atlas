// 与服务端 clipSchema 对齐的前端常量（前端独立维护一份，Worker / UI 都从这里取）。
export const CLIP_DURATION = 10;
export const FPS = 60;

export const LAYER_TYPES = {
  character: 'character',
  shockwave: 'shockwave',
  speedline: 'speedline',
  background: 'background'
};
export const LIBRARY_GROUPS = [
  { type: 'character', label: '角色剪影' },
  { type: 'shockwave', label: '冲击波' },
  { type: 'speedline', label: '速度线' },
  { type: 'background', label: '背景' }
];
export const LAYER_TYPE_LABEL = {
  character: '角色剪影',
  shockwave: '冲击波',
  speedline: '速度线',
  background: '背景'
};

export const CAMERA_TYPES = ['push', 'pan', 'shake', 'flash', 'freeze'];
export const CAMERA_META = {
  push: { label: '推镜', glyph: '⊕', color: '#f4b942', defaultDuration: 2 },
  pan: { label: '横摇', glyph: '⇄', color: '#74a9ff', defaultDuration: 2.5 },
  shake: { label: '震屏', glyph: '⌇', color: '#f2674a', defaultDuration: 0.8 },
  flash: { label: '闪白', glyph: '✦', color: '#f2f0ea', defaultDuration: 0.5 },
  freeze: { label: '定格', glyph: '⏸', color: '#8bd5ca', defaultDuration: 1.2 }
};
export const CAMERA_PARAM_META = {
  zoom: { label: '推进倍率', min: 1, max: 3, step: 0.05 },
  x: { label: '横向焦点', min: -1, max: 1, step: 0.05 },
  y: { label: '纵向焦点', min: -1, max: 1, step: 0.05 },
  amplitude: { label: '振幅（画面宽）', min: 0, max: 0.2, step: 0.005 },
  frequency: { label: '频率', min: 1, max: 60, step: 1 },
  intensity: { label: '闪白强度', min: 0, max: 1, step: 0.05 }
};
export const EASINGS = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold'];
export const EASING_LABEL = {
  linear: '线性', easeIn: '缓入', easeOut: '缓出', easeInOut: '缓入缓出', hold: '阶跃'
};

export const DEFAULT_CAMERA_PARAMS = {
  push: { zoom: 1.5, x: 0, y: 0 },
  pan: { x: 0.5, y: 0 },
  shake: { amplitude: 0.06, frequency: 18 },
  flash: { intensity: 1 },
  freeze: {}
};
