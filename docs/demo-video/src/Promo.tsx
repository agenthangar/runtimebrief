import React from 'react';
import {AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame} from 'remotion';
import {C, ease, easeOut, FPS, H, mono, s, W} from './theme';
import {T} from './timeline';
import {Phone, SCREEN_H} from './Phone';
import {Captions} from './Captions';
import {EndCard, ProblemCard, TitleCard} from './Cards';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// Camera keys: [frame, zoom, iOS-point y brought to the frame's centre line].
const KEYS: [number, number, number][] = [
  [T.phoneIn, 1.0, 478],
  [T.ch1 + s(1.0), 1.0, 478],
  [T.ch1 + s(1.9), 1.3, 340],
  [T.ch2 - s(0.2), 1.32, 335],
  [T.ch2 + s(0.5), 1.18, 470],
  [T.ch3 - s(0.1), 1.18, 470],
  [T.ch3 + s(0.6), 1.62, 700],
  [T.ch3 + s(5.45), 1.62, 700],
  [T.ch3 + s(6.4), 1.62, 285],
  [T.ch3 + s(11.9), 1.62, 285],
  [T.ch4 + s(0.5), 1.62, 700],
  [T.ch4 + s(4.85), 1.62, 700],
  [T.ch4 + s(5.6), 1.55, 290],
  [T.ch4 + s(9.6), 1.55, 290],
  [T.ch4 + s(10.4), 1.3, 515],
  [T.ch5 - s(0.1), 1.3, 515],
  [T.ch5 + s(0.6), 1.62, 700],
  [T.ch5 + s(4.45), 1.62, 700],
  [T.ch5 + s(5.1), 1.55, 290],
  [T.ch5 + s(6.65), 1.55, 290],
  [T.ch5 + s(7.2), 1.62, 700],
  [T.ch5 + s(8.5), 1.62, 700],
  [T.ch5 + s(9.2), 1.28, 330],
  [T.end, 1.28, 330],
];

const camera = (frame: number) => {
  if (frame <= KEYS[0][0]) return {z: KEYS[0][1], fy: KEYS[0][2]};
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [f0, z0, y0] = KEYS[i];
    const [f1, z1, y1] = KEYS[i + 1];
    if (frame <= f1) {
      const t = interpolate(frame, [f0, f1], [0, 1], {...clamp, easing: ease});
      return {z: z0 + (z1 - z0) * t, fy: y0 + (y1 - y0) * t};
    }
  }
  const last = KEYS[KEYS.length - 1];
  return {z: last[1], fy: last[2]};
};

const Backdrop: React.FC<{frame: number}> = ({frame}) => {
  const t = frame / FPS;
  const gx = 70 + 3 * Math.sin(t * 0.25);
  const gy = 48 + 4 * Math.cos(t * 0.2);
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <AbsoluteFill style={{background: `radial-gradient(900px 700px at ${gx}% ${gy}%, rgba(242,169,59,0.13), transparent 70%)`}} />
      <AbsoluteFill style={{background: 'radial-gradient(1100px 800px at 12% 8%, rgba(120,140,190,0.07), transparent 70%)'}} />
      <AbsoluteFill style={{
        opacity: 0.06, mixBlendMode: 'overlay',
        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`,
      }} />
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.45) 100%)'}} />
    </AbsoluteFill>
  );
};

export const Promo: React.FC = () => {
  const frame = useCurrentFrame();
  const {z, fy} = camera(frame);
  const enter = spring({frame: frame - T.phoneIn, fps: FPS, config: {damping: 18, stiffness: 70, mass: 1.1}});
  const exit = interpolate(frame, [T.end, T.end + s(0.85)], [0, 1], {...clamp, easing: Easing2});
  const scale = z * (0.9 + 0.1 * enter) * (1 - 0.12 * exit);
  const cx = 1352 + 900 * exit;
  const cy = H / 2 + (1 - enter) * 980 + (478 - fy) * (SCREEN_H / 956) * scale + 4 * Math.sin(frame / 70);
  const showPhone = frame >= T.phoneIn - 2 && exit < 1;
  const music = 0.76; // the track has its own intro and fade-out
  const progress = interpolate(frame, [0, T.total], [0, 1], clamp);
  const disclose = interpolate(frame, [T.ch1, T.ch1 + 20, T.end - 10, T.end + 10], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill style={{width: W, height: H, overflow: 'hidden'}}>
      <Backdrop frame={frame} />
      <TitleCard frame={frame} />
      <ProblemCard frame={frame} />
      <Captions frame={frame} />
      {showPhone ? (
        <div style={{
          position: 'absolute', left: cx, top: cy, transform: `translate(-50%, -50%) scale(${scale}) rotate(${(1 - enter) * 4}deg)`,
          opacity: Math.min(1, enter * 2) * (1 - exit),
        }}>
          <Phone frame={frame} />
        </div>
      ) : null}
      <EndCard frame={frame} />
      <div style={{
        position: 'absolute', left: 150, bottom: 52, fontFamily: mono, fontSize: 16, color: C.faint, letterSpacing: '0.04em',
        opacity: disclose,
      }}>Fictional demo data. Siri screens are recreated from the app’s replies.</div>
      <div style={{position: 'absolute', left: 0, bottom: 0, height: 3, width: W * progress, background: C.beacon, opacity: 0.7}} />
      <Audio src={staticFile('music.wav')} volume={music} />
    </AbsoluteFill>
  );
};

function Easing2(t: number) {
  return easeOut(t);
}
