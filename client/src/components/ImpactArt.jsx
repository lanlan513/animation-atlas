import { memo } from 'react';
import { BOUNCE_CURVES, burstPath, channelOffset, halftoneDots, normalizeImpact } from '../../../shared/panel-punch-core.js';

export const ART_WIDTH = 500;
export const ART_HEIGHT = 300;

function fontSizeFor(text) {
  const length = text.length;
  if (length <= 2) return 108;
  if (length <= 4) return 94;
  if (length <= 7) return 76;
  if (length <= 9) return 60;
  return 48;
}

function ImpactArtContents({ spec, filterId, animate = true, advancedFilters = true }) {
  const impact = normalizeImpact(spec);
  const path = burstPath(ART_WIDTH, ART_HEIGHT, impact);
  const dots = halftoneDots(impact);
  const channels = channelOffset(impact);
  const fontSize = fontSizeFor(impact.text);
  const stroke = Math.max(2, impact.strokeWidth * 0.72);
  const curve = BOUNCE_CURVES[impact.bounceCurve] || BOUNCE_CURVES.pow;
  const bouncy = animate && impact.bounceAmplitude > 0;

  const shape = <>
    <path
      d={path}
      fill={impact.burstColor}
      stroke={impact.strokeColor}
      strokeWidth={impact.strokeWidth}
      strokeLinejoin="round"
      filter={advancedFilters && impact.roughAmount ? `url(#${filterId})` : undefined}
    />
    {!advancedFilters && impact.roughAmount > 0 && (
      <path
        d={path}
        fill="none"
        stroke={impact.strokeColor}
        strokeWidth={2}
        opacity="0.28"
        transform={`translate(${impact.roughAmount * 0.45} ${-impact.roughAmount * 0.35})`}
      />
    )}
    <path
      d={path}
      fill={impact.accentColor}
      opacity="0.22"
      transform="translate(250 153) scale(.88 .82) translate(-250 -153)"
      style={{ mixBlendMode: 'multiply' }}
    />
    <g opacity={impact.dotOpacity / 100}>
      {dots.map((dot, index) => (
        <circle key={index} cx={dot.x} cy={dot.y} r={dot.r} fill={impact.dotColor} />
      ))}
    </g>
  </>;

  const words = (
    <>
      {impact.channelDistance > 0 && (
        <g style={{ mixBlendMode: 'multiply' }} opacity="0.78" transform={`translate(${channels.red[0]} ${channels.red[1]})`}>
          <text
            x="250"
            y="166"
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#ff2445"
            stroke="#ff2445"
            strokeWidth={stroke}
            paintOrder="stroke"
            fontSize={fontSize}
            fontWeight="950"
            letterSpacing="2"
            fontFamily="Impact, 'Arial Black', 'Helvetica Neue', sans-serif"
          >{impact.text}</text>
        </g>
      )}
      {impact.channelDistance > 0 && (
        <g style={{ mixBlendMode: 'multiply' }} opacity="0.72" transform={`translate(${channels.cyan[0]} ${channels.cyan[1]})`}>
          <text
            x="250"
            y="166"
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#00d8ff"
            stroke="#00d8ff"
            strokeWidth={stroke}
            paintOrder="stroke"
            fontSize={fontSize}
            fontWeight="950"
            letterSpacing="2"
            fontFamily="Impact, 'Arial Black', 'Helvetica Neue', sans-serif"
          >{impact.text}</text>
        </g>
      )}
      <text
        x="250"
        y="166"
        textAnchor="middle"
        dominantBaseline="middle"
        fill={impact.textColor}
        stroke={impact.strokeColor}
        strokeWidth={stroke}
        paintOrder="stroke"
        strokeLinejoin="round"
        fontSize={fontSize}
        fontWeight="950"
        letterSpacing="2"
        fontFamily="Impact, 'Arial Black', 'Helvetica Neue', sans-serif"
        style={advancedFilters ? { filter: `url(#${filterId}-ink)` } : undefined}
      >{impact.text}</text>
    </>
  );

  if (!bouncy) return <>{shape}{words}</>;

  return (
    <g
      className="impact-bounce"
      style={{
        '--bounce-y': `${impact.bounceAmplitude}px`,
        animationTimingFunction: curve.css,
        animationDuration: `${1.18 - impact.bounceAmplitude * 0.018}s`
      }}
    >
      {shape}
      {words}
    </g>
  );
}

function ImpactArt({ spec, filterId = 'impact-filter', animate = true, advancedFilters = true }) {
  return (
    <g className="impact-art">
      <defs>
        <filter id={filterId} x="-35%" y="-35%" width="170%" height="170%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.032" numOctaves="2" seed={Number(spec.seed) % 100} result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={spec.roughAmount || 0} xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id={`${filterId}-ink`} x="-35%" y="-35%" width="170%" height="170%">
          <feDropShadow dx="2.5" dy="3.5" stdDeviation="0" floodColor="#000" floodOpacity="0.35" />
        </filter>
      </defs>
      <ImpactArtContents spec={spec} filterId={filterId} animate={animate} advancedFilters={advancedFilters} />
    </g>
  );
}

export default memo(ImpactArt);
