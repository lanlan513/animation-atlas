// 战斗素材库的内置素材：角色剪影、冲击波、速度线、背景。
// 图层类素材统一使用 viewBox="-50 -50 100 100"（原点即画面坐标 0,0）；
// 背景类素材使用 viewBox="0 0 960 540"。
export const LIBRARY_ASSETS = [
  // ---------- 角色剪影 ----------
  {
    id: 'char-slash', type: 'character', name: '居合斩·黑刃', tags: '剑客,近战',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100">
      <g fill="none" stroke="#0a0b0e" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 12 L-16 42" stroke-width="11"/>
        <path d="M2 12 L16 38" stroke-width="11"/>
        <path d="M2 12 L5 -12" stroke-width="13"/>
        <path d="M5 -12 L-22 -4" stroke-width="9"/>
        <path d="M5 -12 L30 -28" stroke-width="9"/>
      </g>
      <circle cx="9" cy="-23" r="8.5" fill="#0a0b0e"/>
      <path d="M30 -28 L52 -50" stroke="#e9e6dd" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M26 -24 L33 -31" stroke="#0a0b0e" stroke-width="6" stroke-linecap="round"/>
      <path d="M2 -6 q-14 2 -18 -8" fill="none" stroke="#f2674a" stroke-width="4" stroke-linecap="round"/>
    </svg>`
  },
  {
    id: 'char-punch', type: 'character', name: '碎岩冲拳', tags: '拳师,近战',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100">
      <g fill="none" stroke="#0a0b0e" stroke-linecap="round" stroke-linejoin="round">
        <path d="M-2 10 L-22 42" stroke-width="12"/>
        <path d="M-2 10 L20 40" stroke-width="12"/>
        <path d="M-2 10 L-5 -12" stroke-width="14"/>
        <path d="M-5 -12 L-22 2" stroke-width="9"/>
        <path d="M-5 -14 L38 -22" stroke-width="9"/>
      </g>
      <circle cx="-8" cy="-22" r="8.5" fill="#0a0b0e"/>
      <circle cx="42" cy="-23" r="7" fill="#0a0b0e"/>
      <path d="M-14 -18 q-6 10 2 16" fill="none" stroke="#f4b942" stroke-width="4" stroke-linecap="round"/>
    </svg>`
  },
  {
    id: 'char-jumpkick', type: 'character', name: '破空飞踢', tags: '腿法,腾空',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100">
      <g fill="none" stroke="#0a0b0e" stroke-linecap="round" stroke-linejoin="round">
        <path d="M-6 -4 L-26 8" stroke-width="10"/>
        <path d="M-4 -8 L40 -4" stroke-width="10"/>
        <path d="M-8 -10 L8 -16" stroke-width="13"/>
        <path d="M-8 -12 L-26 -24" stroke-width="8"/>
        <path d="M6 -16 L24 -30" stroke-width="8"/>
      </g>
      <circle cx="17" cy="-22" r="8" fill="#0a0b0e"/>
      <path d="M-24 -22 l-10 -4 M-20 -28 l-11 0" stroke="#74a9ff" stroke-width="3.5" stroke-linecap="round"/>
    </svg>`
  },
  {
    id: 'char-guard', type: 'character', name: '铁山靠·守势', tags: '防御,蓄力',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100">
      <g fill="none" stroke="#0a0b0e" stroke-linecap="round" stroke-linejoin="round">
        <path d="M0 14 L-18 42" stroke-width="12"/>
        <path d="M0 14 L15 42" stroke-width="12"/>
        <path d="M0 14 L0 -10" stroke-width="14"/>
        <path d="M0 -8 L-16 4" stroke-width="10"/>
        <path d="M0 -8 L16 4" stroke-width="10"/>
      </g>
      <circle cx="0" cy="-20" r="8.5" fill="#0a0b0e"/>
      <path d="M-14 2 q14 8 28 0" fill="none" stroke="#8bd5ca" stroke-width="4" stroke-linecap="round"/>
    </svg>`
  },

  // ---------- 冲击波 ----------
  {
    id: 'shock-ring', type: 'shockwave', name: '环形冲击', tags: '圆环,爆发',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100">
      <g fill="none" stroke-linecap="round">
        <circle r="16" stroke="#fff3d6" stroke-width="5"/>
        <circle r="30" stroke="#ffb04d" stroke-width="5" stroke-dasharray="34 12"/>
        <circle r="44" stroke="#f2674a" stroke-width="4" stroke-dasharray="20 16 44 14"/>
      </g>
    </svg>`
  },
  {
    id: 'shock-burst', type: 'shockwave', name: '星爆放射线', tags: '星芒,闪光',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100">
      <g fill="#ffd166">
        ${Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          const w = i % 2 === 0 ? 0.16 : 0.09;
          const x1 = Math.cos(a - w) * 12, y1 = Math.sin(a - w) * 12;
          const x2 = Math.cos(a + w) * 12, y2 = Math.sin(a + w) * 12;
          const x3 = Math.cos(a) * 48, y3 = Math.sin(a) * 48;
          return `<polygon points="${x1},${y1} ${x2},${y2} ${x3},${y3}"/>`;
        }).join('')}
      </g>
      <circle r="11" fill="#fff6dd"/>
    </svg>`
  },
  {
    id: 'shock-concentric', type: 'shockwave', name: '双重扩散波', tags: '声波,扩散',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100">
      <circle r="10" fill="#ffffff" opacity="0.9"/>
      <circle r="24" fill="none" stroke="#9ed7ff" stroke-width="6"/>
      <circle r="38" fill="none" stroke="#74a9ff" stroke-width="4" opacity="0.75"/>
      <circle r="46" fill="none" stroke="#74a9ff" stroke-width="2" opacity="0.4" stroke-dasharray="6 8"/>
    </svg>`
  },

  // ---------- 速度线 ----------
  {
    id: 'speed-horizontal', type: 'speedline', name: '横向疾速线', tags: '横移,冲刺',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100">
      <g stroke-linecap="round" stroke="#f4f1e8">
        <line x1="-58" y1="-34" x2="40" y2="-34" stroke-width="3" opacity="0.9"/>
        <line x1="-52" y1="-20" x2="56" y2="-20" stroke-width="2.4" opacity="0.7"/>
        <line x1="-60" y1="-6" x2="30" y2="-6" stroke-width="4" opacity="0.95"/>
        <line x1="-44" y1="9" x2="58" y2="9" stroke-width="2.6" opacity="0.75"/>
        <line x1="-58" y1="24" x2="36" y2="24" stroke-width="3.4" opacity="0.85"/>
        <line x1="-36" y1="37" x2="52" y2="37" stroke-width="2" opacity="0.55"/>
      </g>
    </svg>`
  },
  {
    id: 'speed-radial', type: 'speedline', name: '中心放射速度线', tags: '突进,纵深',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100">
      <g stroke-linecap="round">
        ${Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2;
          const r1 = 26 + (i % 3) * 4;
          return `<line x1="${Math.cos(a) * r1}" y1="${Math.sin(a) * r1}" x2="${Math.cos(a) * 56}" y2="${Math.sin(a) * 56}" stroke="#ffffff" stroke-width="${i % 2 ? 2 : 3.2}" opacity="${i % 2 ? 0.55 : 0.9}"/>`;
        }).join('')}
      </g>
    </svg>`
  },
  {
    id: 'speed-arc', type: 'speedline', name: '弧线甩镜拖影', tags: '甩镜,弧线',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100">
      <g fill="none" stroke-linecap="round">
        <path d="M-46 -18 Q-6 -46 44 -30" stroke="#cfe6ff" stroke-width="4"/>
        <path d="M-48 0 Q-4 -26 48 -8" stroke="#9ed7ff" stroke-width="3" opacity="0.8"/>
        <path d="M-40 18 Q4 -2 50 12" stroke="#ffffff" stroke-width="2.4" opacity="0.6"/>
      </g>
    </svg>`
  },

  // ---------- 背景 ----------
  {
    id: 'bg-ruins', type: 'background', name: '废墟月夜', tags: '夜晚,城市',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540">
      <defs><linearGradient id="ruinsSky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2a2440"/><stop offset="0.6" stop-color="#43304a"/><stop offset="1" stop-color="#17151c"/>
      </linearGradient></defs>
      <rect width="960" height="540" fill="url(#ruinsSky)"/>
      <circle cx="720" cy="120" r="64" fill="#f4ead1" opacity="0.92"/>
      <circle cx="698" cy="104" r="64" fill="#2a2440" opacity="0.55"/>
      <g fill="#0e0f14">
        <polygon points="0,540 0,300 70,300 70,240 150,240 150,330 230,330 230,200 300,200 300,540"/>
        <polygon points="300,540 300,350 380,350 380,280 470,280 470,220 540,220 540,540"/>
        <polygon points="620,540 620,320 700,320 700,260 780,260 780,300 860,300 860,240 960,240 960,540"/>
      </g>
      <g fill="#f2c14e" opacity="0.5">
        <rect x="40" y="330" width="12" height="18"/><rect x="104" y="270" width="12" height="18"/>
        <rect x="400" y="310" width="12" height="18"/><rect x="500" y="250" width="12" height="18"/>
        <rect x="720" y="290" width="12" height="18"/><rect x="900" y="270" width="12" height="18"/>
      </g>
    </svg>`
  },
  {
    id: 'bg-sky', type: 'background', name: '裂空疾云', tags: '天空,高速',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540">
      <defs><linearGradient id="skyG" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#1b2f57"/><stop offset="0.55" stop-color="#3d6ea8"/><stop offset="1" stop-color="#9fc7ec"/>
      </linearGradient></defs>
      <rect width="960" height="540" fill="url(#skyG)"/>
      <g stroke="#f2f6ff" stroke-linecap="round" opacity="0.5">
        <line x1="-40" y1="90" x2="1000" y2="70" stroke-width="10"/>
        <line x1="-40" y1="180" x2="1000" y2="150" stroke-width="16" opacity="0.6"/>
        <line x1="-40" y1="300" x2="1000" y2="250" stroke-width="22" opacity="0.45"/>
        <line x1="-40" y1="420" x2="1000" y2="380" stroke-width="28" opacity="0.35"/>
      </g>
    </svg>`
  },
  {
    id: 'bg-void', type: 'background', name: '虚无网格场', tags: '抽象,空间',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540">
      <defs><radialGradient id="voidG" cx="0.5" cy="0.42" r="0.75">
        <stop offset="0" stop-color="#23262f"/><stop offset="1" stop-color="#0b0c10"/>
      </radialGradient></defs>
      <rect width="960" height="540" fill="url(#voidG)"/>
      <g stroke="#3a4150" stroke-width="1.5" fill="none">
        ${Array.from({ length: 13 }, (_, i) => {
          const y = 300 + i * i * 2.2;
          if (y > 560) return '';
          return `<line x1="0" y1="${y}" x2="960" y2="${y}"/>`;
        }).join('')}
        ${Array.from({ length: 21 }, (_, i) => {
          const x = i * 48;
          return `<line x1="480" y1="300" x2="${x - 240}" y2="540"/>`;
        }).join('')}
      </g>
      <circle cx="480" cy="226" r="3" fill="#f2674a"/>
    </svg>`
  },
  {
    id: 'bg-dojo', type: 'background', name: '赤红道场', tags: '室内,和风',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540">
      <rect width="960" height="540" fill="#2b1716"/>
      <rect y="0" width="960" height="330" fill="#3c1f1c"/>
      <g stroke="#1a0e0d" stroke-width="14">
        <line x1="160" y1="0" x2="160" y2="540"/>
        <line x1="480" y1="0" x2="480" y2="540"/>
        <line x1="800" y1="0" x2="800" y2="540"/>
        <line x1="0" y1="120" x2="960" y2="120"/>
      </g>
      <polygon points="0,330 960,330 960,540 0,540" fill="#241413"/>
      <g stroke="#4a2a26" stroke-width="3">
        ${Array.from({ length: 8 }, (_, i) => `<line x1="0" y1="${350 + i * 26}" x2="960" y2="${350 + i * 26}"/>`).join('')}
      </g>
      <circle cx="480" cy="210" r="46" fill="#f2674a" opacity="0.18"/>
    </svg>`
  }
];
