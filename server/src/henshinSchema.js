// 变身演出生成台：服务端模板字段白名单校验（同构纯函数，不依赖 Node / DOM）。
// 校验边界：
//  - 模板 slug 必须是三个内置模板之一；
//  - 配置对象只允许白名单字段（characterName / primaryColor / glowSymbol /
//    trackId / customBeats），未知字段一律拒绝；
//  - 枚举字段（光效符号 / 音轨）只接受该模板定义内的 id；
//  - 追加节拍为升序、不重复、不越界的时间数组。
import { HENSHIN_TEMPLATE_BY_SLUG } from './henshinSeed.js';

export const HENSHIN_LIMITS = {
  maxNameLength: 12,
  maxCustomBeats: 16,
  maxConfigBytes: 8 * 1024,
  maxResourceLabelLength: 40,
  maxStorageKeyLength: 240,
  maxNoteLength: 280,
  maxRenderingNameLength: 60
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function fail(errors, code, message, path) {
  errors.push({ code, message, path: path || null });
}

/**
 * 校验用户演出配置。
 * @param {string} templateSlug
 * @param {any} config
 * @returns {{ valid: boolean, errors: Array<{code:string,message:string,path:(string|null)}>, normalized?: object }}
 */
export function validateHenshinConfig(templateSlug, config) {
  const errors = [];
  const template = HENSHIN_TEMPLATE_BY_SLUG.get(templateSlug);
  if (!template) {
    return { valid: false, errors: [{ code: 'BAD_TEMPLATE', message: `未知变身模板 “${templateSlug}”。`, path: 'templateSlug' }] };
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { valid: false, errors: [{ code: 'BAD_CONFIG', message: '演出配置必须是对象。', path: null }] };
  }
  if (JSON.stringify(config).length > HENSHIN_LIMITS.maxConfigBytes) {
    fail(errors, 'CONFIG_TOO_LARGE', `演出配置过大（上限 ${HENSHIN_LIMITS.maxConfigBytes} 字节）。`, null);
  }

  const allowed = new Set(['characterName', 'primaryColor', 'glowSymbol', 'trackId', 'customBeats']);
  for (const key of Object.keys(config)) {
    if (!allowed.has(key)) fail(errors, 'UNKNOWN_FIELD', `配置存在白名单之外的字段 “${key}”。`, key);
  }

  // 角色名
  const name = config.characterName;
  if (typeof name !== 'string' || !name.trim()) fail(errors, 'BAD_NAME', '角色名不能为空。', 'characterName');
  else if (name.trim().length > HENSHIN_LIMITS.maxNameLength) fail(errors, 'BAD_NAME', `角色名不能超过 ${HENSHIN_LIMITS.maxNameLength} 个字符。`, 'characterName');

  // 主色：仅接受 #rrggbb，杜绝任意样式注入
  if (typeof config.primaryColor !== 'string' || !HEX_COLOR.test(config.primaryColor || '')) {
    fail(errors, 'BAD_COLOR', '主色必须是 #rrggbb 形式的十六进制颜色。', 'primaryColor');
  }

  // 光效符号：必须取自该模板的符号表
  const symbolIds = new Set(template.symbols.map((symbol) => symbol.id));
  if (!symbolIds.has(config.glowSymbol)) {
    fail(errors, 'BAD_SYMBOL', '光效符号必须从当前模板的符号表中选择。', 'glowSymbol');
  }

  // 音轨：必须取自该模板的音轨表
  const trackIds = new Set(template.tracks.map((track) => track.id));
  if (!trackIds.has(config.trackId)) {
    fail(errors, 'BAD_TRACK', '音轨必须从当前模板的音轨表中选择。', 'trackId');
  }

  // 追加节拍：有限数字、落在片段范围、严格升序且互不重复
  const beats = config.customBeats;
  if (beats !== undefined) {
    if (!Array.isArray(beats)) {
      fail(errors, 'BAD_BEATS', '追加节拍必须是数组。', 'customBeats');
    } else {
      if (beats.length > HENSHIN_LIMITS.maxCustomBeats) {
        fail(errors, 'TOO_MANY_BEATS', `追加节拍不能超过 ${HENSHIN_LIMITS.maxCustomBeats} 个。`, 'customBeats');
      }
      let last = -1;
      beats.forEach((beat, index) => {
        if (!isFiniteNumber(beat) || beat < 0 || beat > template.duration) {
          fail(errors, 'BAD_BEAT', `第 ${index + 1} 个节拍必须是 0–${template.duration} 秒之间的数字。`, `customBeats[${index}]`);
          return;
        }
        if (beat <= last) {
          fail(errors, 'BAD_BEAT_ORDER', '追加节拍必须严格升序且不能重复。', `customBeats[${index}]`);
        }
        last = beat;
      });
    }
  }

  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    errors: [],
    normalized: {
      characterName: name.trim(),
      primaryColor: config.primaryColor.toLowerCase(),
      glowSymbol: config.glowSymbol,
      trackId: config.trackId,
      customBeats: Array.isArray(beats) ? beats.map((beat) => Math.round(beat * 1000) / 1000) : []
    }
  };
}

// 用模板默认值兜底缺失字段（加载配置时保证字段齐全）
export function configWithDefaults(templateSlug, config) {
  const template = HENSHIN_TEMPLATE_BY_SLUG.get(templateSlug);
  if (!template) return null;
  return { ...template.defaults, ...(config || {}) };
}

// ---------- 资源引用的白名单校验 ----------
export const HENSHIN_RESOURCE_KINDS = ['audio', 'symbol', 'overlay'];
export const HENSHIN_RESOURCE_STATUSES = ['pending', 'ready', 'failed'];

export function validateHenshinResource(input) {
  const errors = [];
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const allowed = new Set(['kind', 'label', 'storageKey', 'note']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(errors, 'UNKNOWN_FIELD', `资源引用存在白名单之外的字段 “${key}”。`, key);
  }
  if (!HENSHIN_RESOURCE_KINDS.includes(value.kind)) {
    fail(errors, 'BAD_KIND', `资源类型必须是 ${HENSHIN_RESOURCE_KINDS.join(' / ')} 之一。`, 'kind');
  }
  if (typeof value.label !== 'string' || !value.label.trim() || value.label.length > HENSHIN_LIMITS.maxResourceLabelLength) {
    fail(errors, 'BAD_LABEL', `资源名称必须是 1–${HENSHIN_LIMITS.maxResourceLabelLength} 个字符。`, 'label');
  }
  if (typeof value.storageKey !== 'string' || !value.storageKey.trim() || value.storageKey.length > HENSHIN_LIMITS.maxStorageKeyLength) {
    fail(errors, 'BAD_STORAGE_KEY', `存储键必须是 1–${HENSHIN_LIMITS.maxStorageKeyLength} 个字符。`, 'storageKey');
  } else if (!/^[A-Za-z0-9._:/\-]+$/.test(value.storageKey)) {
    fail(errors, 'BAD_STORAGE_KEY', '存储键只允许字母、数字与 . _ - : / 。', 'storageKey');
  } else if (value.storageKey.split('/').includes('..')) {
    fail(errors, 'BAD_STORAGE_KEY', '存储键不允许包含路径穿越（..）。', 'storageKey');
  }
  if (value.note !== undefined && (typeof value.note !== 'string' || value.note.length > HENSHIN_LIMITS.maxNoteLength)) {
    fail(errors, 'BAD_NOTE', `备注不能超过 ${HENSHIN_LIMITS.maxNoteLength} 个字符。`, 'note');
  }
  return { valid: errors.length === 0, errors };
}
