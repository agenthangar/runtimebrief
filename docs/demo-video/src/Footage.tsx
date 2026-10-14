import React from 'react';
import {AbsoluteFill, Freeze, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {easeOut, ios, PROXY_H, PROXY_W, PT} from './theme';
import {Shot, TAPS} from './timeline';

const p = (n: number) => n * PT;
const video = staticFile('phone.mp4');

// Recording time shown at a frame of a shot list.
export const srcAtFor = (shots: Shot[], frame: number, fps: number): number => {
  let found = shots[0];
  for (const shot of shots) if (frame >= shot.start) found = shot;
  if (found.freeze) return found.srcIn;
  return found.srcIn + ((frame - found.start) / fps) * found.rate;
};

// Background behind the status bar at a recording time: white app screens, grey behind sheets.
const statusBg = (src: number) => {
  const ramps: [number, number, number, number][] = [[121.85, 122.35, 252, 200], [161.9, 162.4, 200, 252], [173.95, 174.45, 252, 200]];
  for (const [a, b, from, to] of ramps) if (src > a && src < b) return Math.round(interpolate(src, [a, b], [from, to]));
  const sheet = (src >= 122.35 && src <= 161.9) || src >= 174.45;
  return sheet ? 200 : 252;
};

// Replaces the recording's clock and "no service" dots with a clean 9:41 status bar.
export const StatusBarPatch: React.FC<{src: number}> = ({src}) => {
  const v = statusBg(src);
  const bg = `rgb(${v},${v},${v})`;
  const bars = [4.4, 6.6, 8.9, 11.2];
  const soft = `0 0 ${p(6)}px ${p(5)}px ${bg}`;
  return (
    <>
      <div style={{position: 'absolute', left: p(18), top: p(14), width: p(128), height: p(36), background: bg, boxShadow: soft, borderRadius: p(8)}} />
      <div style={{
        position: 'absolute', left: p(18), top: p(14), width: p(131), height: p(36), display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontFamily: ios, fontWeight: 600, fontSize: p(17.5),
        letterSpacing: p(-0.2), color: '#000',
      }}>9:41</div>
      <div style={{position: 'absolute', left: p(290), top: p(22), width: p(47), height: p(22), background: bg, boxShadow: soft, borderRadius: p(6)}} />
      {bars.map((h, i) => (
        <div key={i} style={{
          position: 'absolute', left: p(309 + i * 4.9), top: p(37.6 - h), width: p(3.1), height: p(h),
          borderRadius: p(0.9), background: '#000',
        }} />
      ))}
    </>
  );
};

const FadeIn: React.FC<{frames: number; children: React.ReactNode}> = ({frames, children}) => {
  // Inside a Sequence the frame is relative to the shot start.
  const f = useCurrentFrame();
  const opacity = frames > 0 ? interpolate(f, [0, frames], [0, 1], {extrapolateRight: 'clamp'}) : 1;
  return <AbsoluteFill style={{opacity}}>{children}</AbsoluteFill>;
};

// The recording laid out as the shot list says, at proxy size (900x1956).
export const FootageShots: React.FC<{shots: Shot[]; fps: number}> = ({shots, fps}) => (
  <>
    {shots.map((shot, i) => (
      <Sequence key={i} from={shot.start} durationInFrames={shot.dur} layout="none">
        <FadeIn frames={shot.fade ?? 0}>
          {shot.freeze ? (
            <Freeze frame={0}>
              <OffthreadVideo src={video} muted trimBefore={Math.round(shot.srcIn * fps)} style={{width: PROXY_W, height: PROXY_H}} />
            </Freeze>
          ) : (
            <OffthreadVideo src={video} muted trimBefore={Math.round(shot.srcIn * fps)} playbackRate={shot.rate}
              style={{width: PROXY_W, height: PROXY_H}} />
          )}
        </FadeIn>
      </Sequence>
    ))}
  </>
);

// Where each recorded tap lands on a timeline built from a shot list.
export const tapFramesFor = (shots: Shot[], fps: number) => TAPS.flatMap((tap) => {
  const shot = shots.find((sh) => !sh.freeze && tap.src >= sh.srcIn && tap.src <= sh.srcIn + ((sh.dur - (sh.fade ?? 0)) / fps) * sh.rate);
  if (!shot) return [];
  return [{at: shot.start + (shot.fade ?? 0) + Math.round(((tap.src - shot.srcIn) * fps) / shot.rate), x: tap.x, y: tap.y}];
});

// Touch hotspots: a soft press and a ring, timed in seconds so they look the same at any fps.
export const TapMarks: React.FC<{frame: number; fps: number; taps: {at: number; x: number; y: number}[]}> = ({frame, fps, taps}) => (
  <>
    {taps.map((tap, i) => {
      const t = ((frame - tap.at) / fps) * 60;
      if (t < -6 || t > 18) return null;
      const press = interpolate(t, [-6, 0, 8], [0, 1, 0.9], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
      const fade = interpolate(t, [6, 18], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
      const ring = interpolate(t, [0, 18], [p(16), p(36)], {easing: easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
      return (
        <React.Fragment key={i}>
          <div style={{
            position: 'absolute', left: p(tap.x) - p(19), top: p(tap.y) - p(19), width: p(38), height: p(38),
            borderRadius: '50%', background: 'rgba(40,40,45,0.22)', opacity: press * fade,
            transform: `scale(${0.7 + 0.3 * press})`, boxShadow: `0 0 0 ${p(1.5)}px rgba(255,255,255,0.7)`,
          }} />
          <div style={{
            position: 'absolute', left: p(tap.x) - ring, top: p(tap.y) - ring, width: ring * 2, height: ring * 2,
            borderRadius: '50%', border: `${p(2)}px solid rgba(40,40,45,0.35)`, opacity: t > 0 ? fade * 0.8 : 0,
          }} />
        </React.Fragment>
      );
    })}
  </>
);
