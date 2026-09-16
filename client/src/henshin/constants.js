// 变身演出生成台的前端常量（与服务端 henshinSeed / henshinSchema 对齐）。
export const HENSHIN_TEMPLATE_ORDER = ['magical-girl', 'mecha-startup', 'swordsman-awaken'];

export const HENSHIN_LAYOUT_META = {
  constellation: { label: '星环布局', hint: '左环右中 · 径向构图' },
  cockpit: { label: '驾驶舱布局', hint: '顶 HUD 三栏 · 直角网格' },
  scroll: { label: '卷轴布局', hint: '右栏竖排 · 留白长镜' }
};

export const HENSHIN_FIELD_LABEL = {
  characterName: '角色名',
  primaryColor: '主色',
  glowSymbol: '光效符号',
  trackId: '音轨节拍',
  customBeats: '追加节拍'
};

export const HENSHIN_RESOURCE_META = {
  audio: { label: '音轨素材', glyph: '♪' },
  symbol: { label: '符号贴图', glyph: '✶' },
  overlay: { label: '遮罩图层', glyph: '▣' }
};

// 画布逻辑分辨率（各模板统一在此坐标系作画，CSS 负责等比缩放）
export const STAGE_W = 960;
export const STAGE_H = 540;
