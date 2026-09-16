import { createMagicalGirlRenderer } from './magicalGirl.js';
import { createMechaRenderer } from './mecha.js';
import { createSwordsmanRenderer } from './swordsman.js';

// renderer key（模板定义中的 renderer）-> 工厂。
// 三个工厂产出互不相同的动画逻辑，而不是同一渲染器换配色。
export const RENDERER_FACTORIES = {
  magicalGirl: createMagicalGirlRenderer,
  mecha: createMechaRenderer,
  swordsman: createSwordsmanRenderer
};
