import React from 'react';
import { clamp, clampPointToPage, polygonCenter, starPoints } from './geometry.js';

/* 程序化分镜画面：按 art.kind 在分镜包围盒内绘制，外层用 clipPath 裁成多边形。 */
export function PanelArt({ art, bounds }) {
  const { x, y, w, h } = bounds;
  const tint = art?.tint || '#232838';
  const overlay = <rect x={x} y={y} width={w} height={h} fill={tint} opacity="0.16" />;
  switch (art?.kind) {
    case 'skyline': {
      const buildings = [0.02, 0.16, 0.3, 0.47, 0.6, 0.74, 0.88];
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="#191d2e" />
          <circle cx={x + w * 0.78} cy={y + h * 0.22} r={h * 0.09} fill="#e8e4d8" opacity="0.85" />
          {buildings.map((fx, i) => {
            const bw = w * 0.13;
            const bh = h * (0.32 + ((i * 37) % 40) / 100);
            return (
              <g key={i}>
                <rect x={x + fx * w} y={y + h - bh} width={bw} height={bh} fill={i % 2 ? '#101322' : '#151a2b'} />
                {[0, 1, 2, 3, 4, 5].map((j) => (
                  <rect key={j} x={x + fx * w + bw * 0.18 + (j % 2) * bw * 0.4} y={y + h - bh + bh * 0.12 + Math.floor(j / 2) * bh * 0.24} width={bw * 0.16} height={bh * 0.1} fill={(i + j) % 3 ? '#f4b94255' : '#f4b94222'} />
                ))}
              </g>
            );
          })}
          <circle cx={x + w * 0.12} cy={y + h * 0.16} r={5} fill="#f2674a">
            <animate attributeName="opacity" values="1;.15;1" dur="1.2s" repeatCount="indefinite" />
          </circle>
          {overlay}
        </g>
      );
    }
    case 'rooftop':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="#1b2030" />
          <polygon points={`${x},${y + h * 0.72} ${x + w},${y + h * 0.66} ${x + w},${y + h} ${x},${y + h}`} fill="#232a3d" />
          <rect x={x} y={y + h * 0.66} width={w} height={h * 0.06} fill="#2c3550" />
          <rect x={x + w * 0.1} y={y + h * 0.34} width={w * 0.17} height={h * 0.33} fill="#101322" />
          <rect x={x + w * 0.08} y={y + h * 0.31} width={w * 0.21} height={h * 0.04} fill="#2c3550" />
          <rect x={x + w * 0.62} y={y + h * 0.52} width={w * 0.14} height={h * 0.15} fill="#161b29" />
          <rect x={x + w * 0.66} y={y + h * 0.46} width={w * 0.06} height={h * 0.06} fill="#2c3550" />
          {overlay}
        </g>
      );
    case 'rooftop-edge':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="#1e1b2e" />
          <polygon points={`${x},${y + h * 0.7} ${x + w},${y + h * 0.74} ${x + w},${y + h} ${x},${y + h}`} fill="#262238" />
          <line x1={x + w * 0.72} y1={y + h * 0.72} x2={x + w * 0.72} y2={y + h * 0.16} stroke="#3a3f5c" strokeWidth="5" />
          <line x1={x + w * 0.6} y1={y + h * 0.3} x2={x + w * 0.84} y2={y + h * 0.3} stroke="#3a3f5c" strokeWidth="4" />
          <circle cx={x + w * 0.72} cy={y + h * 0.14} r={5} fill="#f2674a">
            <animate attributeName="opacity" values="1;.2;1" dur="1.6s" repeatCount="indefinite" />
          </circle>
          <path d={`M${x},${y + h * 0.3} Q${x + w * 0.4},${y + h * 0.44} ${x + w * 0.72},${y + h * 0.3}`} fill="none" stroke="#101322" strokeWidth="3" />
          {overlay}
        </g>
      );
    case 'burst': {
      const cx = x + w / 2;
      const cy = y + h / 2;
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="#2b1d1d" />
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i * Math.PI) / 8;
            return <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(a) * w} y2={cy + Math.sin(a) * w} stroke="#f2674a" strokeOpacity={i % 2 ? 0.5 : 0.22} strokeWidth={i % 2 ? 10 : 4} />;
          })}
          <polygon points={starPoints(cx, cy, Math.min(w, h) * 0.4, Math.min(w, h) * 0.19, 14)} fill="#f4b942" opacity="0.9" />
          {overlay}
        </g>
      );
    }
    case 'static':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="#16211f" />
          {Array.from({ length: 9 }, (_, i) => (
            <line key={i} x1={x} y1={y + (h * (i + 0.5)) / 9} x2={x + w} y2={y + (h * (i + 0.5)) / 9} stroke="#8bd5ca" strokeOpacity={0.12 + (i % 3) * 0.08} strokeWidth={2 + (i % 3)} />
          ))}
          <text x={x + w / 2} y={y + h / 2} className="art-note">NO SIGNAL</text>
          {overlay}
        </g>
      );
    case 'alley':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="#211d18" />
          <polygon points={`${x},${y} ${x + w * 0.3},${y + h * 0.12} ${x + w * 0.3},${y + h} ${x},${y + h}`} fill="#181510" />
          <polygon points={`${x + w},${y} ${x + w * 0.72},${y + h * 0.1} ${x + w * 0.72},${y + h} ${x + w},${y + h}`} fill="#14110d" />
          <rect x={x + w * 0.44} y={y + h * 0.55} width={w * 0.14} height={h * 0.45} fill="#f4b94222" />
          {[0.2, 0.36, 0.52].map((fy) => (
            <line key={fy} x1={x + w * 0.74} y1={y + h * fy} x2={x + w * 0.98} y2={y + h * fy} stroke="#2e2820" strokeWidth="3" />
          ))}
          {overlay}
        </g>
      );
    default: // 未知画面类型：占位网格（降级显示）
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="#1a1c22" />
          {Array.from({ length: 6 }, (_, i) => (
            <line key={i} x1={x + (w * i) / 5} y1={y} x2={x + (w * i) / 5} y2={y + h} stroke="#2a2d36" strokeWidth="2" />
          ))}
          <text x={x + w / 2} y={y + h / 2} className="art-note">PANEL</text>
          {overlay}
        </g>
      );
  }
}

/* 跨格角色：定位用外层 g 的 transform 属性，动作动画用内层 g 的 CSS class，
 * 避免 CSS transform 覆盖定位 transform。pointer-events 关闭，点击穿透到热区。 */
export function ActorFigure({ actor, action }) {
  const [primary = '#f4b942', dark = '#20222b'] = actor.palette || [];
  const hero = actor.kind !== 'villain';
  return (
    <g transform={`translate(${actor.x} ${actor.y}) scale(${actor.scale || 1})`} pointerEvents="none">
      <g className={`actor ${hero ? 'hero' : 'villain'}${action ? ` act-${action}` : ''}`}>
        {hero && <path d="M-6,-58 C-34,-40 -38,-6 -30,10 L-8,2 Z" fill={primary} opacity="0.75" />}
        <rect x="-9" y="-12" width="7" height="14" rx="3" fill={dark} />
        <rect x="2" y="-12" width="7" height="14" rx="3" fill={dark} />
        <path d="M-11,-46 Q0,-52 11,-46 L9,-12 Q0,-8 -9,-12 Z" fill={primary} />
        <rect x="-16" y="-44" width="6" height="20" rx="3" fill={primary} transform="rotate(14 -13 -44)" />
        <rect x="10" y="-44" width="6" height="20" rx="3" fill={primary} transform="rotate(-14 13 -44)" />
        <circle cx="0" cy="-56" r="9" fill={hero ? '#e8c9a0' : '#b9a8d9'} />
        <rect x="-9" y="-60" width="18" height="5" rx="2.5" fill={dark} />
        {hero
          ? <polygon points="2,-44 -4,-34 0,-34 -3,-24 5,-36 1,-36 5,-44" fill={dark} />
          : <path d="M-8,-62 L-12,-72 L-5,-64 M8,-62 L12,-72 L5,-64" stroke={dark} strokeWidth="3" fill="none" />}
      </g>
    </g>
  );
}

/* 对白气泡：锚点越界时钳回页面；从锚点处弹出。 */
export function Bubble({ beat, page }) {
  const { text = '', speaker, anchor, tone = 'default' } = beat.payload || {};
  const [ax, ay] = clampPointToPage(anchor, page);
  const content = String(text);
  const fontSize = Math.min(15, (page.width * 0.42) / Math.max(content.length, 1));
  const w = clamp(content.length * fontSize + 30, 96, page.width * 0.5);
  const h = speaker ? 52 : 40;
  const x = clamp(ax - w / 2, 8, page.width - w - 8);
  const y = clamp(ay - h - 24, 8, page.height - h - 8);
  return (
    <g className={`beat-bubble tone-${tone}`}>
      <rect x={x} y={y} width={w} height={h} rx={tone === 'narrator' ? 4 : 13} />
      <polygon points={`${ax - 11},${y + h - 2} ${ax + 13},${y + h - 2} ${ax},${Math.min(ay, y + h + 22)}`} />
      {speaker && <text className="bubble-speaker" x={x + 14} y={y + 17} style={{ fontSize: fontSize * 0.72 }}>{speaker}</text>}
      <text className="bubble-text" x={x + 14} y={y + (speaker ? 37 : 26)} style={{ fontSize }}>{content}</text>
    </g>
  );
}

/* 拟声词：星形爆炸底 + 斜体粗字，旋转弹出。 */
export function Sfx({ beat, page }) {
  const { text = '!', anchor, rotation = 0, size = 56, color = '#f4b942' } = beat.payload || {};
  const [ax, ay] = clampPointToPage(anchor, page);
  return (
    <g transform={`translate(${ax} ${ay}) rotate(${rotation})`} pointerEvents="none">
      <g className="beat-sfx">
        <polygon className="sfx-burst" points={starPoints(0, 0, size * 1.75, size * 1.02, 12)} />
        <text className="sfx-text" y={size * 0.32} fill={color} style={{ fontSize: size }}>{text}</text>
      </g>
    </g>
  );
}

/* 自动导读路径：按阅读顺序连接各分镜质心的虚线，已读节点点亮。 */
export function GuidePath({ panels, visitedOrder }) {
  if (!panels || panels.length < 2) return null;
  const pts = panels.map((p) => polygonCenter(p.polygon));
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
  return (
    <g className="guide-path" pointerEvents="none">
      <path d={d} />
      {pts.map((p, i) => (
        <circle key={panels[i].id} cx={p[0]} cy={p[1]} r="6" className={panels[i].readingOrder <= visitedOrder ? 'done' : ''} />
      ))}
    </g>
  );
}
