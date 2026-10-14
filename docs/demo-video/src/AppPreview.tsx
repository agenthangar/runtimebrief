import React from 'react';
import {AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {C, easeOut, PROXY_W, sans} from './theme';
import type {Shot} from './timeline';
import {FootageShots, srcAtFor, StatusBarPatch, TapMarks, tapFramesFor} from './Footage';

// App Store app preview: only footage captured from the app, full screen, with captions.
// iPhone 6.9"/6.7" previews are 886x1920, 15-30 seconds, at most 30 fps.
export const PREVIEW_FPS = 30;
export const PREVIEW_W = 886;
export const PREVIEW_H = 1920;

const f = (seconds: number) => Math.round(seconds * PREVIEW_FPS);
const shots: Shot[] = [];
const marks: number[] = [];
let cursor = 0;
const add = (srcIn: number, srcOut: number, rate = 1, fade = 0) => {
  const dur = Math.round(((srcOut - srcIn) * PREVIEW_FPS) / rate);
  shots.push({start: cursor - fade, dur: dur + fade, srcIn, rate, fade});
  cursor += dur;
};
const hold = (src: number, seconds: number) => {
  shots.push({start: cursor, dur: f(seconds), srcIn: src, rate: 1, freeze: true});
  cursor += f(seconds);
};
const chapter = () => marks.push(cursor);

chapter(); add(2.0, 4.6);
chapter(); add(23.25, 26.2);
chapter(); add(37.25, 39.3); add(51.0, 53.9, 2); add(64.1, 66.8, 2);
chapter(); add(78.95, 79.9); add(82.4, 84.8, 2); add(97.65, 98.9); add(107.7, 110.6, 2); add(110.6, 111.3);
chapter(); add(121.6, 123.0); add(133.6, 134.7); add(144.4, 145.4); add(152.4, 153.4, 1, 4); add(161.7, 164.4);
chapter(); add(173.9, 175.9); add(199.35, 202.6, 1, f(0.3));
chapter(); hold(202.6, 1.3);

export const PREVIEW_SHOTS = shots;
export const PREVIEW_FRAMES = cursor;
export const PREVIEW_CHAPTERS = marks.map((m) => m / PREVIEW_FPS);

const CAPTIONS = [
  {title: 'Every agent.\nEvery project.', sub: 'Claude Code, Codex and Cursor, side by side.'},
  {title: 'Know what moved.', sub: 'Analysis backed by the evidence.'},
  {title: 'Every agent session.', sub: 'From every vendor, read on your Mac.'},
  {title: 'Commits, TestFlight\nand App Store.', sub: 'Release status next to the work.'},
  {title: 'Start an agent\non your Mac.', sub: 'Claude Code, Codex or Cursor.'},
  {title: 'Follow up from\nyour phone.', sub: 'Keep the conversation going.'},
  {title: 'RuntimeBrief', sub: 'Every agent. One place.'},
];

const tapFrames = tapFramesFor(PREVIEW_SHOTS, PREVIEW_FPS);
const scale = PREVIEW_W / PROXY_W;

const Caption: React.FC<{frame: number}> = ({frame}) => (
  <>
    {CAPTIONS.map((cap, i) => {
      const from = marks[i];
      const until = marks[i + 1] ?? PREVIEW_FRAMES;
      if (frame < from || frame >= until) return null;
      const t = frame - from;
      const last = i === CAPTIONS.length - 1;
      const inOp = i === 0 ? 1 : interpolate(t, [0, 6], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
      const outOp = last ? 1 : interpolate(frame, [until - 5, until], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
      const rise = i === 0 ? 0 : interpolate(t, [0, 10], [24, 0], {easing: easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
      return (
        <div key={i} style={{
          position: 'absolute', left: 64, right: 64, bottom: 118, opacity: inOp * outOp, transform: `translateY(${rise}px)`,
        }}>
          <div style={{
            fontFamily: sans, fontWeight: 700, fontSize: last ? 92 : 70, lineHeight: 1.04, letterSpacing: '-0.03em',
            color: '#fff', whiteSpace: 'pre-line', textShadow: '0 2px 18px rgba(0,0,0,0.35)',
          }}>{cap.title}</div>
          <div style={{fontFamily: sans, fontSize: 34, lineHeight: 1.35, color: last ? C.beacon : '#e9e5dd', marginTop: 18}}>{cap.sub}</div>
        </div>
      );
    })}
  </>
);

export const AppPreview: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: '#fcfcfc', overflow: 'hidden'}}>
      <div style={{
        position: 'absolute', left: 0, top: (PREVIEW_H - 1956 * scale) / 2, width: PROXY_W, height: 1956,
        transform: `scale(${scale})`, transformOrigin: '0 0',
      }}>
        <FootageShots shots={PREVIEW_SHOTS} fps={PREVIEW_FPS} />
        <StatusBarPatch src={srcAtFor(PREVIEW_SHOTS, frame, PREVIEW_FPS)} />
        <TapMarks frame={frame} fps={PREVIEW_FPS} taps={tapFrames} />
      </div>
      <AbsoluteFill style={{
        background: 'linear-gradient(180deg, rgba(14,15,16,0) 52%, rgba(14,15,16,0.88) 66%, rgba(14,15,16,0.985) 74%, rgba(14,15,16,0.985) 100%)',
      }} />
      <Caption frame={frame} />
      <Audio src={staticFile('preview-music.wav')} volume={0.8} />
    </AbsoluteFill>
  );
};
