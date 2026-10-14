import React from 'react';
import {interpolate} from 'remotion';
import {easeOut, FPS, PROXY_H, PROXY_W, PT} from './theme';
import {HIGHLIGHTS, SHOTS, SIRI} from './timeline';
import {FootageShots, srcAtFor, StatusBarPatch, TapMarks, tapFramesFor} from './Footage';
import {SiriOverlay} from './Siri';

const p = (n: number) => n * PT;
const tapFrames = tapFramesFor(SHOTS, FPS);

const Highlights: React.FC<{frame: number}> = ({frame}) => (
  <>
    {HIGHLIGHTS.map((h, i) => {
      const op = interpolate(frame, [h.from, h.from + 12, h.to - 12, h.to], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
      if (op <= 0) return null;
      const grow = interpolate(frame, [h.from, h.from + 16], [p(8), 0], {easing: easeOut, extrapolateRight: 'clamp'});
      const pulse = 0.5 + 0.5 * Math.sin((frame - h.from) * 0.12);
      return (
        <div key={i} style={{
          position: 'absolute', left: p(h.x) - grow, top: p(h.y) - grow, width: p(h.w) + grow * 2, height: p(h.h) + grow * 2,
          borderRadius: p(h.r) + grow, border: `${p(2.4)}px solid ${h.color}`, opacity: op,
          boxShadow: `0 0 ${p(6 + 6 * pulse)}px ${h.color}88`,
        }} />
      );
    })}
  </>
);

export const SCREEN_H = 940;
export const SCREEN_SCALE = SCREEN_H / PROXY_H;
export const SCREEN_W = PROXY_W * SCREEN_SCALE;
const BEZEL = 12;
const RADIUS = 54;

export const Phone: React.FC<{frame: number}> = ({frame}) => (
  <div style={{position: 'relative', width: SCREEN_W + BEZEL * 2, height: SCREEN_H + BEZEL * 2}}>
    {/* side buttons */}
    {[{x: -3, y: 190, h: 34}, {x: -3, y: 250, h: 62}, {x: -3, y: 324, h: 62}, {x: SCREEN_W + BEZEL * 2 - 1, y: 270, h: 96}].map((b, i) => (
      <div key={i} style={{
        position: 'absolute', left: b.x, top: b.y, width: 4, height: b.h, borderRadius: 2,
        background: 'linear-gradient(90deg,#4a4c51,#2a2b2f)',
      }} />
    ))}
    <div style={{
      position: 'absolute', inset: 0, borderRadius: RADIUS + BEZEL,
      background: 'linear-gradient(150deg,#5a5c61 0%,#2b2d31 18%,#1b1c1f 50%,#2d2f33 82%,#55575c 100%)',
      boxShadow: '0 50px 90px rgba(0,0,0,0.55), 0 18px 36px rgba(0,0,0,0.35), inset 0 0 0 1.5px rgba(255,255,255,0.10)',
    }} />
    <div style={{position: 'absolute', inset: 3, borderRadius: RADIUS + BEZEL - 3, background: '#050506'}} />
    <div style={{
      position: 'absolute', left: BEZEL, top: BEZEL, width: SCREEN_W, height: SCREEN_H, borderRadius: RADIUS,
      overflow: 'hidden', background: '#fcfcfc', transform: 'translateZ(0)',
    }}>
      <div style={{position: 'absolute', left: 0, top: 0, width: PROXY_W, height: PROXY_H, transform: `scale(${SCREEN_SCALE})`, transformOrigin: '0 0'}}>
        <FootageShots shots={SHOTS} fps={FPS} />
        <StatusBarPatch src={srcAtFor(SHOTS, frame, FPS)} />
        <Highlights frame={frame} />
        <TapMarks frame={frame} fps={FPS} taps={tapFrames} />
        {SIRI.map((scene, i) => <SiriOverlay key={i} scene={scene} frame={frame} />)}
      </div>
    </div>
  </div>
);
