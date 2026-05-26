// SVG chart primitives — Phase 1 ESM port of ../../charts.jsx.
//
// Dual surface (mirrors api.ts):
//   1. Named ESM exports for subsequent .jsx → .tsx ports inside vite-app/src/.
//   2. window.{LineChart, BarChart, WindRose, Sparkline, GaugeMeter, ChartColors}
//      side effects so the legacy Babel Standalone bundle keeps working if it
//      ever loads this build instead.
//
// Behavior is intentionally byte-equivalent to charts.jsx so we can swap
// callers one at a time without subtle drift.

import type { CSSProperties, FC } from 'react';

export const ChartColors = {
  blue: '#2874a6',
  lightBlue: '#5dade2',
  green: '#1a8a4a',
  amber: '#c27a0e',
  red: '#c0392b',
  gray: '#8898aa',
  gridLine: '#e8ecf1',
  text: '#4a5568',
} as const;

export type ChartColorName = keyof typeof ChartColors;

export interface SeriesPoint {
  label: string;
  value: number;
}

export interface DirectionPoint {
  dir: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
  value: number;
}

export interface LineChartProps {
  data: SeriesPoint[];
  width?: number;
  height?: number;
  color?: string;
  yLabel?: string;
  threshold?: number;
  thresholdLabel?: string;
}

export const LineChart: FC<LineChartProps> = ({
  data,
  width = 400,
  height = 160,
  color = ChartColors.blue,
  yLabel = '',
  threshold,
  thresholdLabel,
}) => {
  if (!data || data.length === 0) return null;
  const pad = { top: 20, right: 16, bottom: 28, left: 44 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const vals = data.map((d) => d.value);
  const yMin = Math.min(...vals) * 0.9;
  const yMax = Math.max(...vals, threshold || 0) * 1.1;
  const xScale = (i: number) => pad.left + (i / (data.length - 1)) * w;
  const yScale = (v: number) => pad.top + h - ((v - yMin) / (yMax - yMin)) * h;

  const points = data.map((d, i) => `${xScale(i)},${yScale(d.value)}`).join(' ');
  const area = `${xScale(0)},${yScale(yMin)} ${points} ${xScale(data.length - 1)},${yScale(yMin)}`;

  const yTicks = 4;
  const yLines = Array.from({ length: yTicks + 1 }, (_, i) => yMin + (yMax - yMin) * (i / yTicks));

  const svgStyle: CSSProperties = { width: '100%', height: 'auto' };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={svgStyle}>
      {yLines.map((v, i) => (
        <g key={i}>
          <line x1={pad.left} y1={yScale(v)} x2={width - pad.right} y2={yScale(v)}
            stroke={ChartColors.gridLine} strokeWidth="1" />
          <text x={pad.left - 6} y={yScale(v) + 4} textAnchor="end"
            fill={ChartColors.text} fontSize="10">{v.toFixed(1)}</text>
        </g>
      ))}
      {threshold && (
        <g>
          <line x1={pad.left} y1={yScale(threshold)} x2={width - pad.right} y2={yScale(threshold)}
            stroke={ChartColors.red} strokeWidth="1.5" strokeDasharray="6,3" />
          {thresholdLabel && (
            <text x={width - pad.right} y={yScale(threshold) - 5} textAnchor="end"
              fill={ChartColors.red} fontSize="10" fontWeight="600">{thresholdLabel}</text>
          )}
        </g>
      )}
      <polygon points={area} fill={color} opacity="0.08" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      {data.map((d, i) => (
        <circle key={i} cx={xScale(i)} cy={yScale(d.value)} r="3" fill={color} stroke="#fff" strokeWidth="1.5" />
      ))}
      {data.filter((_, i) => i % Math.ceil(data.length / 8) === 0 || i === data.length - 1).map((d, i2) => {
        const idx = data.indexOf(d);
        return (
          <text key={i2} x={xScale(idx)} y={height - 6} textAnchor="middle"
            fill={ChartColors.text} fontSize="10">{d.label}</text>
        );
      })}
      {yLabel && (
        <text x={8} y={pad.top - 6} fill={ChartColors.text} fontSize="10" fontWeight="600">{yLabel}</text>
      )}
    </svg>
  );
};

export interface BarChartProps {
  data: SeriesPoint[];
  width?: number;
  height?: number;
  color?: string;
  yLabel?: string;
}

export const BarChart: FC<BarChartProps> = ({
  data,
  width = 400,
  height = 160,
  color = ChartColors.blue,
  yLabel = '',
}) => {
  if (!data || data.length === 0) return null;
  const pad = { top: 20, right: 16, bottom: 28, left: 44 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const vals = data.map((d) => d.value);
  const yMax = Math.max(...vals) * 1.15 || 1;
  const barW = Math.min(24, (w / data.length) * 0.6);
  const gap = w / data.length;

  const yTicks = 4;
  const yLines = Array.from({ length: yTicks + 1 }, (_, i) => (yMax * i) / yTicks);

  const svgStyle: CSSProperties = { width: '100%', height: 'auto' };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={svgStyle}>
      {yLines.map((v, i) => {
        const y = pad.top + h - (v / yMax) * h;
        return (
          <g key={i}>
            <line x1={pad.left} y1={y} x2={width - pad.right} y2={y}
              stroke={ChartColors.gridLine} strokeWidth="1" />
            <text x={pad.left - 6} y={y + 4} textAnchor="end"
              fill={ChartColors.text} fontSize="10">{v.toFixed(v < 10 ? 1 : 0)}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const bh = (d.value / yMax) * h;
        const x = pad.left + gap * i + (gap - barW) / 2;
        const y = pad.top + h - bh;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={bh} fill={color} rx="2" opacity="0.85" />
            <text x={x + barW / 2} y={height - 6} textAnchor="middle"
              fill={ChartColors.text} fontSize="9">{d.label}</text>
          </g>
        );
      })}
      {yLabel && (
        <text x={8} y={pad.top - 6} fill={ChartColors.text} fontSize="10" fontWeight="600">{yLabel}</text>
      )}
    </svg>
  );
};

export interface WindRoseProps {
  data: DirectionPoint[];
  size?: number;
}

export const WindRose: FC<WindRoseProps> = ({ data, size = 180 }) => {
  const dirs: DirectionPoint['dir'][] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 24;
  const angles = dirs.map((_, i) => ((i * 45 - 90) * Math.PI) / 180);
  const maxVal = Math.max(...(data || []).map((d) => d.value), 1);

  const svgStyle: CSSProperties = { width: size, height: size };

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={svgStyle}>
      {[0.25, 0.5, 0.75, 1].map((f, i) => (
        <circle key={i} cx={cx} cy={cy} r={r * f} fill="none" stroke={ChartColors.gridLine} strokeWidth="1" />
      ))}
      {dirs.map((d, i) => {
        const a = angles[i];
        const x2 = cx + Math.cos(a) * r;
        const y2 = cy + Math.sin(a) * r;
        const lx = cx + Math.cos(a) * (r + 14);
        const ly = cy + Math.sin(a) * (r + 14);
        return (
          <g key={d}>
            <line x1={cx} y1={cy} x2={x2} y2={y2} stroke={ChartColors.gridLine} strokeWidth="0.5" />
            <text x={lx} y={ly + 4} textAnchor="middle" fill={ChartColors.text} fontSize="10" fontWeight="500">{d}</text>
          </g>
        );
      })}
      {(data || []).map((d, i) => {
        const a = angles[dirs.indexOf(d.dir)] ?? angles[0];
        const dist = (d.value / maxVal) * r;
        return (
          <circle key={i} cx={cx + Math.cos(a) * dist} cy={cy + Math.sin(a) * dist}
            r="5" fill={ChartColors.blue} opacity="0.7" stroke="#fff" strokeWidth="1" />
        );
      })}
    </svg>
  );
};

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}

export const Sparkline: FC<SparklineProps> = ({
  values,
  width = 80,
  height = 24,
  color = ChartColors.blue,
}) => {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values) || 1;
  const pts = values
    .map((v, i) =>
      `${(i / (values.length - 1)) * width},${
        height - ((v - min) / (max - min || 1)) * (height - 4) - 2
      }`,
    )
    .join(' ');
  const svgStyle: CSSProperties = { width, height, display: 'block' };
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={svgStyle}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
};

export interface GaugeMeterProps {
  value: number;
  max: number;
  threshold?: number;
  label?: string;
  unit?: string;
  size?: number;
}

export const GaugeMeter: FC<GaugeMeterProps> = ({
  value,
  max,
  threshold,
  label,
  unit,
  size = 120,
}) => {
  const r = (size - 20) / 2;
  const cx = size / 2;
  const cy = size / 2 + 8;
  const startAngle = -210;
  const endAngle = 30;
  const range = endAngle - startAngle;
  const valAngle = startAngle + (Math.min(value, max) / max) * range;
  const threshAngle = threshold ? startAngle + (threshold / max) * range : null;
  const color =
    value > (threshold || max)
      ? ChartColors.red
      : value > (threshold || max) * 0.8
        ? ChartColors.amber
        : ChartColors.blue;

  const arc = (angle: number) => {
    const rad = (angle * Math.PI) / 180;
    return { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r };
  };
  const start = arc(startAngle);
  const end = arc(valAngle);
  const largeArc = valAngle - startAngle > 180 ? 1 : 0;

  const svgStyle: CSSProperties = { width: size, height: size };

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={svgStyle}>
      <path
        d={`M ${arc(startAngle).x} ${arc(startAngle).y} A ${r} ${r} 0 1 1 ${arc(endAngle).x} ${arc(endAngle).y}`}
        fill="none" stroke={ChartColors.gridLine} strokeWidth="8" strokeLinecap="round"
      />
      <path
        d={`M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`}
        fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
      />
      {threshAngle !== null && (() => {
        const tp = arc(threshAngle);
        return <circle cx={tp.x} cy={tp.y} r="4" fill={ChartColors.red} stroke="#fff" strokeWidth="2" />;
      })()}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="18" fontWeight="700" fill={color}>{value}</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fontSize="10" fill={ChartColors.text}>{unit}</text>
      {label && <text x={cx} y={size - 4} textAnchor="middle" fontSize="10" fill={ChartColors.gray}>{label}</text>}
    </svg>
  );
};

declare global {
  interface Window {
    LineChart?: typeof LineChart;
    BarChart?: typeof BarChart;
    WindRose?: typeof WindRose;
    Sparkline?: typeof Sparkline;
    GaugeMeter?: typeof GaugeMeter;
    ChartColors?: typeof ChartColors;
  }
}

if (typeof window !== 'undefined') {
  Object.assign(window, { LineChart, BarChart, WindRose, Sparkline, GaugeMeter, ChartColors });
}
