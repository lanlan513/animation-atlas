// 变身演出生成台：三个内置模板。
// 关键约束：三个模板不仅是颜色 / 文案不同 —— 镜头顺序（shots）、
// 页面布局（layout）、渲染动画逻辑（每个 shot 的 anim + fx 参数）都完全不同。
// 该文件不引入 Node / DOM 专有 API，结构上可被客户端复用。

export const HENSHIN_DURATION = {
  magical: 9,
  mecha: 10,
  swordsman: 8.5
};

// 配置字段白名单：每种字段的校验规则。服务端据此逐字段校验，
// 枚举字段（光效符号 / 音轨）的合法值从模板定义本身取。
export const CONFIG_FIELD_SPECS = {
  characterName: { type: 'string', min: 1, max: 12, label: '角色名' },
  primaryColor: { type: 'color', label: '主色' },
  glowSymbol: { type: 'symbol', label: '光效符号' },
  trackId: { type: 'track', label: '音轨' },
  customBeats: { type: 'times', max: 16, label: '追加节拍' }
};

export const HENSHIN_TEMPLATES = [
  // ================= 魔法少女：星彩变身 =================
  // 镜头逻辑：特写点火 → 丝带涡旋包裹 → 棱镜闪光换装 → 宝冠降临 → 星座姿态
  // 视觉逻辑：圆形、柔边、径向光晕、涡旋轨道粒子
  {
    slug: 'magical-girl',
    name: '星彩变身',
    subtitle: 'プリズム・メイクアップ',
    description: '五拍柔光变身。瞳孔点火、丝带涡旋、棱镜换装与星座定格，全部走径向构图与环形粒子。',
    layout: 'constellation',
    renderer: 'magicalGirl',
    accent: '#ff7eb6',
    swatches: ['#ff7eb6', '#b48cff', '#7ec8ff', '#ffd166', '#7ef0c8'],
    duration: HENSHIN_DURATION.magical,
    symbols: [
      { id: 'star', glyph: '✦', name: '星辉' },
      { id: 'heart', glyph: '♡', name: '心晶' },
      { id: 'moon', glyph: '☾', name: '月弧' },
      { id: 'sparkle', glyph: '✧', name: '闪光' }
    ],
    tracks: [
      { id: 'starlight-rush', name: '星光冲刺', bpm: 142,
        beats: [0.4, 0.8, 1.2, 1.8, 2.3, 2.8, 3.3, 3.8, 4.2, 4.6, 5.0, 5.6, 6.4, 7.2, 7.7, 8.2, 8.7],
        downbeats: [0.4, 1.8, 4.2, 7.2] },
      { id: 'lunar-waltz', name: '月光圆舞', bpm: 108,
        beats: [0.6, 1.2, 1.8, 2.4, 3.0, 3.6, 4.2, 4.8, 5.4, 6.0, 6.6, 7.2, 7.8, 8.4],
        downbeats: [0.6, 2.4, 4.2, 6.0, 7.8] },
      { id: 'prism-heart', name: '棱镜之心', bpm: 126,
        beats: [0.5, 1.0, 1.8, 2.2, 3.0, 3.4, 4.2, 4.6, 5.0, 5.8, 6.2, 7.2, 7.6, 8.0, 8.5],
        downbeats: [1.0, 3.0, 4.2, 7.2] }
    ],
    shots: [
      { id: 'mg-s1', name: '瞳・点火', start: 0, end: 1.8, anim: 'closeup-ignite', note: '面部特写，瞳孔随第一拍点亮',
        fx: { mask: 'radial-vignette', particles: 24, motion: 'zoom-in', zoomTo: 1.8 } },
      { id: 'mg-s2', name: '丝带涡旋', start: 1.8, end: 4.2, anim: 'ribbon-vortex', note: '双螺旋丝带环绕包裹，符号沿轨道公转',
        fx: { mask: 'growing-circle', particles: 72, motion: 'orbit', orbitRings: 3, spin: 1.4 } },
      { id: 'mg-s3', name: '棱镜换装', start: 4.2, end: 5.6, anim: 'prism-reveal', note: '白闪遮罩圆扩，星形粒子向外炸开',
        fx: { mask: 'flash-circle', particles: 90, motion: 'radial-burst', flash: 1 } },
      { id: 'mg-s4', name: '宝冠降临', start: 5.6, end: 7.2, anim: 'tiara-descent', note: '光效符号自顶部摇摆落下，落点产生涟漪',
        fx: { mask: 'none', particles: 36, motion: 'sway-fall' } },
      { id: 'mg-s5', name: '星姿定格', start: 7.2, end: HENSHIN_DURATION.magical, anim: 'pose-constellation', note: '星座连线姿态，节拍处星尘脉冲',
        fx: { mask: 'radial-vignette', particles: 64, motion: 'twinkle', constellation: true } }
    ],
    defaults: { characterName: '星彩', primaryColor: '#ff7eb6', glowSymbol: 'star', trackId: 'starlight-rush', customBeats: [] }
  },

  // ================= 机甲启动：零号机接続 =================
  // 镜头逻辑：扫描冷启动 → 反应堆点火 → 装甲板左右咬合 → HUD 自检 → 面罩砸下 → 推进出击
  // 视觉逻辑：硬边矩形、扫描线、六边形网格、HUD 切片遮罩
  {
    slug: 'mecha-startup',
    name: '零号机接続',
    subtitle: 'UNIT-00 / IGNITION SEQUENCE',
    description: '六段硬核启动序列。扫描线、六边形反应堆、装甲切片咬合与 HUD 自检，全部走直角网格与切片遮罩。',
    layout: 'cockpit',
    renderer: 'mecha',
    accent: '#4db6ff',
    swatches: ['#4db6ff', '#ff5a4e', '#ffc24b', '#5be8a0', '#c9d4e3'],
    duration: HENSHIN_DURATION.mecha,
    symbols: [
      { id: 'hex', glyph: '⬡', name: '六边核心' },
      { id: 'bolt', glyph: '⚡', name: '电光' },
      { id: 'target', glyph: '◎', name: '准星' },
      { id: 'grid', glyph: '▦', name: '方阵' }
    ],
    tracks: [
      { id: 'reactor-ignite', name: '反应堆点火', bpm: 128,
        beats: [1.6, 2.0, 2.4, 2.8, 3.6, 4.4, 5.2, 5.6, 6.0, 6.4, 6.8, 7.0, 7.4, 7.8, 8.2, 8.5, 8.8, 9.1, 9.4, 9.7],
        downbeats: [1.6, 5.2, 7.0, 8.2] },
      { id: 'overdrive-drive', name: '超频驱动', bpm: 156,
        beats: [0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2, 3.6, 4.0, 4.4, 4.8, 5.2, 5.6, 6.0, 6.4, 6.8, 7.2, 7.6, 8.0, 8.4, 8.8, 9.2, 9.6],
        downbeats: [0.8, 3.2, 5.6, 8.0] },
      { id: 'railgun-march', name: '电磁行进军', bpm: 120,
        beats: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5],
        downbeats: [1.0, 3.0, 5.0, 7.0, 9.0] }
    ],
    shots: [
      { id: 'mc-s1', name: '冷启动', start: 0, end: 1.6, anim: 'boot-scanline', note: '黑屏逐行扫描，启动日志随扫描条出现',
        fx: { mask: 'horizontal-wipe', particles: 0, motion: 'scan-sweep', scanlines: true } },
      { id: 'mc-s2', name: '核心点火', start: 1.6, end: 3.2, anim: 'core-reactor', note: '六边形反应堆脉冲，网格单元按节拍点亮',
        fx: { mask: 'hex-clip', particles: 48, motion: 'hex-pulse', gridCells: 7 } },
      { id: 'mc-s3', name: '装甲咬合', start: 3.2, end: 5.4, anim: 'plate-lock', note: '左右装甲板错峰滑入，到位瞬间震屏',
        fx: { mask: 'vertical-slices', particles: 20, motion: 'slide-lock', slices: 6, shake: 0.012 } },
      { id: 'mc-s4', name: '系统自检', start: 5.4, end: 7.0, anim: 'hud-sweep', note: '数据柱 / 环形准星 / 横扫读数',
        fx: { mask: 'none', particles: 26, motion: 'data-sweep', scanlines: true } },
      { id: 'mc-s5', name: '面罩砸下', start: 7.0, end: 8.2, anim: 'visor-slam', note: '面罩加速砸落，内部扫描光条接管视野',
        fx: { mask: 'visor-drop', particles: 12, motion: 'slam', shake: 0.02 } },
      { id: 'mc-s6', name: '出击推进', start: 8.2, end: HENSHIN_DURATION.mecha, anim: 'thruster-burst', note: '方块尾迹粒子向下加速，机体离架',
        fx: { mask: 'none', particles: 80, motion: 'thrust-accel', shake: 0.008 } }
    ],
    defaults: { characterName: '零号机', primaryColor: '#4db6ff', glowSymbol: 'hex', trackId: 'reactor-ignite', customBeats: [] }
  },

  // ================= 剑士觉醒：居合一闪 =================
  // 镜头逻辑：远景聚气 → 居合拔刀 → 十字一闪 → 收刀余韵
  // 视觉逻辑：留白、墨色、纵向构图、单笔路径遮罩、少而重的节拍
  {
    slug: 'swordsman-awaken',
    name: '居合一闪',
    subtitle: '居合・目覚めの一閃',
    description: '四段留白觉醒。聚气、拔刀、十字一闪到收刀余韵，走纵向墨色构图与单笔光刃遮罩，节拍少而重。',
    layout: 'scroll',
    renderer: 'swordsman',
    accent: '#d8c9a0',
    swatches: ['#e8e4d8', '#c9503f', '#6f8f7a', '#5a7ea8', '#b089c9'],
    duration: HENSHIN_DURATION.swordsman,
    symbols: [
      { id: 'enso', glyph: '◯', name: '圆相' },
      { id: 'blade', glyph: '一', name: '一文字' },
      { id: 'kanji', glyph: '刃', name: '刃文字' },
      { id: 'seal', glyph: '刹', name: '刹印' }
    ],
    tracks: [
      { id: 'iaijutsu-silence', name: '居合之静', bpm: 64,
        beats: [2.5, 4.6, 5.0, 6.4, 7.6, 8.2],
        downbeats: [2.5, 4.6, 6.4] },
      { id: 'battou-storm', name: '抜刀风暴', bpm: 138,
        beats: [2.5, 2.9, 3.3, 3.7, 4.1, 4.6, 4.9, 5.2, 5.5, 5.8, 6.1, 6.4, 7.0, 7.6, 8.2],
        downbeats: [2.5, 4.6, 6.4] },
      { id: 'meiyo-resonance', name: '鸣神共鸣', bpm: 72,
        beats: [0.8, 1.6, 2.5, 3.4, 4.6, 5.5, 6.4, 7.3, 8.2],
        downbeats: [2.5, 4.6, 8.2] }
    ],
    shots: [
      { id: 'kd-s1', name: '风止・聚气', start: 0, end: 2.5, anim: 'wind-gather', note: '远景长镜，落叶墨点螺旋汇聚，圆相一笔笔画开',
        fx: { mask: 'ink-circle', particles: 42, motion: 'spiral-in', stroke: 'enso' } },
      { id: 'kd-s2', name: '居合拔刀', start: 2.5, end: 4.6, anim: 'draw-iaijutsu', note: '侧身纳刀姿态，单条横向光刃沿笔路径遮罩扫出',
        fx: { mask: 'single-blade-path', particles: 18, motion: 'horizontal-draw' } },
      { id: 'kd-s3', name: '十字一闪', start: 4.6, end: 6.4, anim: 'twin-slash', note: '两道光刃先后交叉，墨点冲击与重拍震屏',
        fx: { mask: 'crossed-blades', particles: 56, motion: 'cross-sequential', shake: 0.015 } },
      { id: 'kd-s4', name: '收刀余韵', start: 6.4, end: HENSHIN_DURATION.swordsman, anim: 'sheath-resonance', note: '竖线收束，最后一拍一道光脉冲后归于留白',
        fx: { mask: 'none', particles: 24, motion: 'settle-pulse', finalPulse: 8.2 } }
    ],
    defaults: { characterName: '叢雲', primaryColor: '#e8e4d8', glowSymbol: 'blade', trackId: 'iaijutsu-silence', customBeats: [] }
  }
];

export const HENSHIN_TEMPLATE_BY_SLUG = new Map(HENSHIN_TEMPLATES.map((template) => [template.slug, template]));

export const RENDERER_BY_SLUG = new Map(HENSHIN_TEMPLATES.map((template) => [template.slug, template.renderer]));

// 三种截然不同的页面布局（客户端按此 key 选择完全不同的栅格与组件编排）
export const HENSHIN_LAYOUTS = ['constellation', 'cockpit', 'scroll'];
