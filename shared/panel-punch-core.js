// Panel Punch shared model: deterministic impact-word parameters, poster layer
// relationships, strict normalization and tiny geometry helpers. The browser
// and server use exactly the same rules, so a refreshed document renders from
// saved parameters rather than a rasterized screenshot.

export const PANEL_LIMITS = {
  posterWidth: [640, 2400],
  posterHeight: [420, 1800],
  layerCount: 36,
  text: 12,
  name: 42,
  spikes: [8, 48],
  jagged: [0, 100],
  stroke: [0, 28],
  dots: { radius: [1, 12], gap: [6, 42], opacity: [0, 100] },
  channel: [0, 28],
  rough: [0, 18],
  scale: [0.2, 3],
  position: [-5000, 5000],
  rotation: [-180, 180],
  exportScale: [1, 4]
};

export const BOUNCE_CURVES = {
  pow: { label: 'POW 急速', css: 'cubic-bezier(.12,1.65,.28,1)' },
  spring: { label: '弹簧震荡', css: 'cubic-bezier(.2,1.35,.32,1)' },
  thud: { label: '重击落点', css: 'cubic-bezier(.18,.8,.25,1)' },
  float: { label: '悬浮预备', css: 'cubic-bezier(.45,0,.25,1)' }
};

export const DEFAULT_IMPACT = {
  text: 'BAM',
  burstColor: '#ffd936',
  accentColor: '#e83f32',
  textColor: '#fff8e7',
  strokeColor: '#151515',
  dotColor: '#171717',
  shape: 'burst',
  spikes: 22,
  jagged: 58,
  strokeWidth: 9,
  dotRadius: 4,
  dotGap: 17,
  dotOpacity: 72,
  channelDistance: 6,
  channelAngle: 8,
  roughAmount: 4,
  bounceCurve: 'pow',
  bounceAmplitude: 8,
  seed: 19390501
};

const SHAPES = new Set(['burst', 'blob', 'badge']);

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(value, min, max, fallback = min) {
  const n = finiteNumber(value, fallback);
  return Math.min(max, Math.max(min, n));
}

function intClamp(value, min, max, fallback = min) {
  return Math.round(clamp(value, min, max, fallback));
}

function bool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 'true') return true;
  if (value === 0 || value === 'false') return false;
  return fallback;
}

function color(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? value : fallback;
}

function enumValue(value, allowed, fallback) {
  return Object.prototype.hasOwnProperty.call(allowed, value) ? value : fallback;
}

// Tags, control characters, zero-width marks and giant copy/paste payloads are
// removed before the string ever reaches SVG or the JSON store.
export function sanitizeComicText(raw, max = PANEL_LIMITS.text) {
  return String(raw ?? '')
    .normalize('NFKC')
    .replace(/\p{C}+/gu, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\p{L}\p{N} !?.\-&'’★]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, max);
}

export function sanitizeName(raw, max = PANEL_LIMITS.name) {
  return String(raw ?? '')
    .normalize('NFKC')
    .replace(/\p{C}+/gu, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function randomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const array = new Uint32Array(1);
    globalThis.crypto.getRandomValues(array);
    return array[0];
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

export function makeUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function mulberry32(seed) {
  let a = (intClamp(seed, 0, 0xffffffff, 1) || 1) >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalizeImpact(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const text = sanitizeComicText(value.text, PANEL_LIMITS.text) || DEFAULT_IMPACT.text;
  return {
    ...DEFAULT_IMPACT,
    ...Object.fromEntries(Object.entries(value).filter(([, v]) => Number.isFinite(Number(v)) || typeof v === 'string' || typeof v === 'boolean')),
    text,
    burstColor: color(value.burstColor, DEFAULT_IMPACT.burstColor),
    accentColor: color(value.accentColor, DEFAULT_IMPACT.accentColor),
    textColor: color(value.textColor, DEFAULT_IMPACT.textColor),
    strokeColor: color(value.strokeColor, DEFAULT_IMPACT.strokeColor),
    dotColor: color(value.dotColor, DEFAULT_IMPACT.dotColor),
    shape: SHAPES.has(value.shape) ? value.shape : DEFAULT_IMPACT.shape,
    spikes: intClamp(value.spikes, ...PANEL_LIMITS.spikes, DEFAULT_IMPACT.spikes),
    jagged: intClamp(value.jagged, ...PANEL_LIMITS.jagged, DEFAULT_IMPACT.jagged),
    strokeWidth: intClamp(value.strokeWidth, ...PANEL_LIMITS.stroke, DEFAULT_IMPACT.strokeWidth),
    dotRadius: intClamp(value.dotRadius, ...PANEL_LIMITS.dots.radius, DEFAULT_IMPACT.dotRadius),
    dotGap: intClamp(value.dotGap, ...PANEL_LIMITS.dots.gap, DEFAULT_IMPACT.dotGap),
    dotOpacity: intClamp(value.dotOpacity, ...PANEL_LIMITS.dots.opacity, DEFAULT_IMPACT.dotOpacity),
    channelDistance: intClamp(value.channelDistance, ...PANEL_LIMITS.channel, DEFAULT_IMPACT.channelDistance),
    channelAngle: intClamp(value.channelAngle, -180, 180, DEFAULT_IMPACT.channelAngle),
    roughAmount: intClamp(value.roughAmount, ...PANEL_LIMITS.rough, DEFAULT_IMPACT.roughAmount),
    bounceCurve: enumValue(value.bounceCurve, BOUNCE_CURVES, DEFAULT_IMPACT.bounceCurve),
    bounceAmplitude: intClamp(value.bounceAmplitude, 0, 24, DEFAULT_IMPACT.bounceAmplitude),
    seed: intClamp(value.seed, 0, 0xffffffff, DEFAULT_IMPACT.seed)
  };
}

export function createImpact(overrides = {}) {
  return normalizeImpact({ ...DEFAULT_IMPACT, seed: randomSeed(), ...overrides });
}

export function createImpactLayer(overrides = {}, index = 0) {
  const impact = createImpact(overrides.impact || overrides);
  return {
    id: sanitizeName(overrides.id)?.startsWith('lyr_') ? overrides.id : `lyr_${makeUuid()}`,
    kind: 'impact',
    name: sanitizeName(overrides.name) || impact.text,
    x: intClamp(overrides.x, ...PANEL_LIMITS.position, 0),
    y: intClamp(overrides.y, ...PANEL_LIMITS.position, 0),
    scale: clamp(overrides.scale, ...PANEL_LIMITS.scale, 1),
    rotation: intClamp(overrides.rotation, ...PANEL_LIMITS.rotation, 0),
    visible: bool(overrides.visible, true),
    locked: bool(overrides.locked, false),
    impact,
    createdAt: overrides.createdAt || new Date().toISOString()
  };
}

export function createBackgroundLayer(overrides = {}) {
  return {
    id: sanitizeName(overrides.id)?.startsWith('lyr_') ? overrides.id : `lyr_${makeUuid()}`,
    kind: 'background',
    name: sanitizeName(overrides.name) || '动作海报底色',
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    visible: bool(overrides.visible, true),
    locked: bool(overrides.locked, true),
    background: {
      type: ['radial', 'speed', 'halftone'].includes(overrides.background?.type) ? overrides.background.type : 'radial',
      color: color(overrides.background?.color, '#f2ead8'),
      accent: color(overrides.background?.accent, '#234c9f')
    },
    createdAt: overrides.createdAt || new Date().toISOString()
  };
}

function sanitizeLayer(layer, index) {
  if (!layer || typeof layer !== 'object') return null;
  const common = {
    id: /^lyr_[\w-]{4,64}$/.test(layer.id) ? layer.id : `lyr_${makeUuid()}`,
    name: sanitizeName(layer.name) || (layer.kind === 'background' ? '背景层' : `冲击字 ${index + 1}`),
    x: intClamp(layer.x, ...PANEL_LIMITS.position, 0),
    y: intClamp(layer.y, ...PANEL_LIMITS.position, 0),
    scale: clamp(layer.scale, ...PANEL_LIMITS.scale, 1),
    rotation: intClamp(layer.rotation, ...PANEL_LIMITS.rotation, 0),
    visible: bool(layer.visible, true),
    locked: bool(layer.locked, layer.kind === 'background'),
    createdAt: layer.createdAt || new Date().toISOString()
  };
  if (layer.kind === 'background') return createBackgroundLayer({ ...layer, ...common });
  if (layer.kind === 'impact') return { ...common, kind: 'impact', impact: normalizeImpact(layer.impact) };
  return null;
}

export function createPoster(overrides = {}) {
  const width = intClamp(overrides.width, ...PANEL_LIMITS.posterWidth, 960);
  const height = intClamp(overrides.height, ...PANEL_LIMITS.posterHeight, 640);
  const background = createBackgroundLayer({ x: 0, y: 0 });
  const first = createImpactLayer({ x: width / 2, y: height / 2, impact: { text: 'BAM' } }, 1);
  first.name = 'BAM 主角';
  return {
    schema: 'panel-punch/1',
    name: sanitizeName(overrides.name, 60) || 'Untitled Action Poster',
    width,
    height,
    activeLayerId: first.id,
    layers: [background, first],
    exportConfig: sanitizeExportConfig(overrides.exportConfig),
    seed: intClamp(overrides.seed, 0, 0xffffffff, randomSeed()),
    updatedAt: new Date().toISOString()
  };
}

export function sanitizeExportConfig(input = {}) {
  return {
    format: input.format === 'svg' ? 'svg' : 'png',
    scale: intClamp(input.scale, ...PANEL_LIMITS.exportScale, 2),
    includeBackground: bool(input.includeBackground, true),
    lastExport: input.lastExport && typeof input.lastExport === 'object' ? {
      format: input.lastExport.format === 'svg' ? 'svg' : 'png',
      at: String(input.lastExport.at || '').slice(0, 40) || null
    } : null
  };
}

export function sanitizePoster(input = {}) {
  if (input?.schema === 'panel-punch/1') {
    const width = intClamp(input.width, ...PANEL_LIMITS.posterWidth, 960);
    const height = intClamp(input.height, ...PANEL_LIMITS.posterHeight, 640);
    const rawLayers = Array.isArray(input.layers) ? input.layers : [];
    const sanitizedLayers = rawLayers.map(sanitizeLayer).filter(Boolean);
    const hasBackground = sanitizedLayers.some((layer) => layer.kind === 'background');
    const hasImpact = sanitizedLayers.some((layer) => layer.kind === 'impact');
    // Reserve guaranteed background/impact slots before truncating.
    const reserved = (hasBackground ? 0 : 1) + (hasImpact ? 0 : 1);
    let layers = sanitizedLayers.slice(0, PANEL_LIMITS.layerCount - reserved);
    if (!hasBackground) layers.unshift(createBackgroundLayer());
    if (!hasImpact) layers.push(createImpactLayer({ x: width / 2, y: height / 2 }));
    const ids = new Set();
    for (const layer of layers) {
      while (ids.has(layer.id)) layer.id = `${layer.id.slice(0, 52)}_${Math.floor(Math.random() * 1e6)}`;
      ids.add(layer.id);
    }
    const activeExists = ids.has(input.activeLayerId);
    return {
      schema: 'panel-punch/1',
      name: sanitizeName(input.name, 60) || 'Untitled Action Poster',
      width,
      height,
      activeLayerId: activeExists ? input.activeLayerId : layers.find((layer) => layer.kind === 'impact')?.id || layers[0].id,
      layers,
      exportConfig: sanitizeExportConfig(input.exportConfig),
      seed: intClamp(input.seed, 0, 0xffffffff, randomSeed()),
      updatedAt: new Date().toISOString()
    };
  }
  return createPoster(input || {});
}

// ---------- deterministic geometry ----------

export function burstPath(viewW = 500, viewH = 300, spec = {}) {
  const cfg = normalizeImpact(spec);
  const rand = mulberry32(cfg.seed);
  const cx = viewW / 2;
  const cy = viewH / 2;
  const count = cfg.spikes;
  const jag = cfg.jagged / 100;

  if (cfg.shape === 'badge' || cfg.shape === 'blob') {
    const points = [];
    const base = cfg.shape === 'badge' ? 0.41 : 0.39;
    for (let i = 0; i < count; i += 1) {
      const angle = -Math.PI / 2 + (i / count) * Math.PI * 2;
      const wave = cfg.shape === 'badge'
        ? 1 + (i % 2 === 0 ? 0.035 * jag : -0.055 * jag)
        : 0.82 + rand() * 0.28 + jag * 0.08 * Math.sin(i * 2.1);
      const rx = viewW * base * wave;
      const ry = viewH * (base + 0.02) * wave;
      points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
    }
    return smoothClosedPath(points);
  }

  const points = [];
  const total = count * 2;
  for (let i = 0; i < total; i += 1) {
    const angle = -Math.PI / 2 + (i / total) * Math.PI * 2 + (rand() - 0.5) * jag * 0.08;
    const outer = i % 2 === 0;
    const radius = outer
      ? 1 - (rand() * 0.13 + 0.02) * jag
      : 0.68 - rand() * 0.18 * jag;
    points.push([
      cx + Math.cos(angle) * viewW * 0.47 * radius,
      cy + Math.sin(angle) * viewH * 0.44 * radius
    ]);
  }
  return `M ${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')} Z`;
}

function smoothClosedPath(points) {
  let [px, py] = points[0];
  let d = `M ${px.toFixed(1)} ${py.toFixed(1)}`;
  for (let i = 0; i < points.length; i += 1) {
    const [x, y] = points[(i + 1) % points.length];
    const [mx, my] = [(px + x) / 2, (py + y) / 2];
    d += ` Q ${px.toFixed(1)} ${py.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
    px = x;
    py = y;
  }
  return `${d} Z`;
}

export function halftoneDots(spec = {}) {
  const cfg = normalizeImpact(spec);
  const rand = mulberry32(cfg.seed + 77);
  const cx = 250;
  const cy = 150;
  const gap = cfg.dotGap;
  const dots = [];
  for (let y = cy - 128; y <= cy + 128; y += gap) {
    for (let x = cx - 220; x <= cx + 220; x += gap) {
      const nx = (x + (rand() - 0.5) * gap * 0.35 - cx) / 218;
      const ny = (y + (rand() - 0.5) * gap * 0.35 - cy) / 124;
      const distance = nx * nx + ny * ny;
      if (distance < 0.92 && distance > 0.31 && rand() > 0.18) {
        dots.push({ x, y, r: cfg.dotRadius * (0.65 + rand() * 0.55) });
      }
    }
  }
  return dots;
}

export function channelOffset(spec = {}) {
  const cfg = normalizeImpact(spec);
  const angle = (cfg.channelAngle - 90) * Math.PI / 180;
  return {
    red: [Math.cos(angle) * cfg.channelDistance, Math.sin(angle) * cfg.channelDistance],
    cyan: [-Math.cos(angle) * cfg.channelDistance, -Math.sin(angle) * cfg.channelDistance]
  };
}
