// One frame of the ride replay: a 9:16 card with the club logo, the ride's title and date, the
// route riding itself on a steel panel, and a distance counter. The screen shows it at any size;
// the video is made from the same drawing at 450×800, so what members watch is what they share.

import React, { forwardRef } from 'react';
import Svg, { Circle, G, Image as SvgImage, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { partialLine, type ReplayFrame, type ReplayPlan } from '../domain/rideReplay';
import { formatKm } from '../domain/routes';
import { projectLine } from '../domain/routeShape';
import type { Route } from '../domain/types';
import { colors, fonts } from '../theme';

/** The video's size, and the card's drawing units. */
export const VIDEO_W = 450;
export const VIDEO_H = 800;

const PANEL = { x: 20, y: 268, w: 410, h: 392 };
const PAD = 30;
const LOGO_W = 168;
const LOGO_H = Math.round((LOGO_W * 765) / 1093);

export interface ReplayCardProps {
  plan: ReplayPlan;
  frame: ReplayFrame;
  bounds: Route['bounds'];
  routeName: string;
  /** The title, already wrapped to at most two lines. */
  titleLines: string[];
  date: string;
  category: string;
  stats: string[];
  width: number;
  height: number;
  onLogoLoad?: () => void;
}

/** Cuts a line to `n` characters (whole characters, so an emoji isn't split) with an ellipsis. */
const clip = (text: string, n: number) => {
  const chars = Array.from(text);
  return chars.length > n ? `${chars.slice(0, n - 1).join('').trimEnd()}…` : text;
};

const fmt = (pts: [number, number][]) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

export const ReplayCard = forwardRef<Svg, ReplayCardProps>(function ReplayCard(
  { plan, frame, bounds, routeName, titleLines, date, category, stats, width, height, onLogoLoad },
  ref,
) {
  const project = (line: [number, number][]) =>
    projectLine(line, bounds, PANEL.w, PANEL.h, PAD).map(([x, y]) => [x + PANEL.x, y + PANEL.y] as [number, number]);
  const full = project(plan.line);
  const ridden = project(partialLine(plan, frame.fraction));
  const [mx, my] = ridden[ridden.length - 1];
  const [sx, sy] = full[0];
  const [fx, fy] = full[full.length - 1];
  const stops = project(plan.stops.map((s) => [s.lat, s.lng]));
  const titleY = 44 + LOGO_H + 44;
  const stencil = { fontFamily: fonts.stencil };
  const stopNumber = frame.atStop ? plan.stops.indexOf(frame.atStop) + 1 : 0;
  return (
    <Svg ref={ref} width={width} height={height} viewBox={`0 0 ${VIDEO_W} ${VIDEO_H}`}>
      <Rect x={0} y={0} width={VIDEO_W} height={VIDEO_H} fill={colors.ink} />
      <SvgImage
        x={(VIDEO_W - LOGO_W) / 2}
        y={28}
        width={LOGO_W}
        height={LOGO_H}
        href={require('../../assets/logo.png')}
        preserveAspectRatio="xMidYMid meet"
        onLoad={onLogoLoad}
      />
      {titleLines.map((line, i) => (
        <SvgText key={i} x={VIDEO_W / 2} y={titleY + i * 34} textAnchor="middle" fontSize={30} letterSpacing={1} fill={colors.bone} {...stencil}>
          {line}
        </SvgText>
      ))}
      <SvgText
        x={VIDEO_W / 2}
        y={titleY + titleLines.length * 34 + 4}
        textAnchor="middle"
        fontSize={17}
        letterSpacing={1.5}
        fill={colors.boneMute}
        {...stencil}
      >
        {`${date}  ·  ${category.toUpperCase()}`}
      </SvgText>

      <Rect x={PANEL.x} y={PANEL.y} width={PANEL.w} height={PANEL.h} rx={8} fill={colors.steel} />
      <Polyline points={fmt(full)} fill="none" stroke={colors.bone} strokeOpacity={0.2} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
      {ridden.length > 1 ? (
        <G>
          <Polyline points={fmt(ridden)} fill="none" stroke={colors.ink} strokeWidth={9} strokeLinejoin="round" strokeLinecap="round" />
          <Polyline points={fmt(ridden)} fill="none" stroke={colors.redBright} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
        </G>
      ) : null}
      <Rect x={fx - 8} y={fy - 8} width={16} height={16} fill={colors.ink} stroke={colors.bone} strokeWidth={2.5} />
      <Circle cx={sx} cy={sy} r={8} fill={colors.ok} stroke={colors.ink} strokeWidth={2.5} />
      {stops.map(([x, y], i) =>
        i < frame.reached ? (
          <Circle key={i} cx={x} cy={y} r={7} fill={colors.bone} stroke={colors.ink} strokeWidth={2.5} />
        ) : (
          <Circle key={i} cx={x} cy={y} r={5} fill={colors.steel} stroke={colors.boneMute} strokeWidth={2} />
        ),
      )}
      {frame.phase !== 'outro' ? <Circle cx={mx} cy={my} r={11} fill={colors.redBright} stroke={colors.bone} strokeWidth={3} /> : null}

      {frame.phase === 'outro' ? (
        <G>
          <SvgText x={VIDEO_W / 2} y={716} textAnchor="middle" fontSize={46} letterSpacing={1.5} fill={colors.bone} {...stencil}>
            {(stats[0] ?? '').toUpperCase()}
          </SvgText>
          {stats.length > 1 ? (
            <SvgText x={VIDEO_W / 2} y={748} textAnchor="middle" fontSize={18} letterSpacing={1.5} fill={colors.boneDim} {...stencil}>
              {stats.slice(1).join('  ·  ').toUpperCase()}
            </SvgText>
          ) : null}
          <SvgText x={VIDEO_W / 2} y={778} textAnchor="middle" fontSize={14} letterSpacing={1.5} fill={colors.boneMute} {...stencil}>
            rustnutssmc.com.au
          </SvgText>
        </G>
      ) : (
        <G>
          <SvgText x={VIDEO_W / 2} y={728} textAnchor="middle" fontSize={46} letterSpacing={1.5} fill={colors.bone} {...stencil}>
            {formatKm(frame.distanceM).toUpperCase()}
          </SvgText>
          {frame.atStop ? (
            <G>
              <Rect x={40} y={746} width={VIDEO_W - 80} height={34} rx={4} fill={colors.steelHi} />
              <SvgText x={VIDEO_W / 2} y={770} textAnchor="middle" fontSize={17} letterSpacing={1} fill={colors.bone} {...stencil}>
                {clip(`STOP ${stopNumber}  ·  ${frame.atStop.name.toUpperCase()}`, 34)}
              </SvgText>
            </G>
          ) : (
            <SvgText x={VIDEO_W / 2} y={768} textAnchor="middle" fontSize={16} letterSpacing={1.5} fill={colors.boneMute} {...stencil}>
              {clip(routeName.toUpperCase(), 34)}
            </SvgText>
          )}
        </G>
      )}
    </Svg>
  );
});
