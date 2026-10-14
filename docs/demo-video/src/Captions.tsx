import React from 'react';
import {interpolate} from 'remotion';
import {C, easeOut, mono, sans} from './theme';
import {CAPTIONS, T} from './timeline';

const appear = (f: number, delay: number) => {
  const t = f - delay;
  return {
    opacity: interpolate(t, [0, 16], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
    transform: `translateY(${interpolate(t, [0, 22], [22, 0], {easing: easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}px)`,
  };
};

export const Captions: React.FC<{frame: number}> = ({frame}) => (
  <>
    {CAPTIONS.map((cap, i) => {
      const next = CAPTIONS[i + 1];
      const until = next ? next.from : T.end + 8;
      if (frame < cap.from - 2 || frame > until + 2) return null;
      const f = frame - cap.from;
      const leave = interpolate(frame, [until - 12, until], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
      const lift = interpolate(frame, [until - 12, until], [0, -14], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
      const sameEyebrow = i > 0 && CAPTIONS[i - 1].eyebrow === cap.eyebrow;
      const nextSameEyebrow = next && next.eyebrow === cap.eyebrow;
      return (
        <div key={i} style={{position: 'absolute', left: 150, top: 0, width: 690, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center'}}>
          <div style={{
            fontFamily: mono, fontSize: 19, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.beacon,
            marginBottom: 26, ...(sameEyebrow ? {} : appear(f, 0)), opacity: (sameEyebrow ? 1 : appear(f, 0).opacity) * (nextSameEyebrow ? 1 : leave),
          }}>{cap.eyebrow}</div>
          <div style={{opacity: leave, transform: `translateY(${lift}px)`}}>
            <div style={{
              fontFamily: sans, fontWeight: 700, fontSize: 70, lineHeight: 1.04, letterSpacing: '-0.025em', color: C.bright,
              whiteSpace: 'pre-line', ...appear(f, 4),
            }}>{cap.title}</div>
            <div style={{
              fontFamily: sans, fontSize: 27, lineHeight: 1.48, color: C.muted, marginTop: 30, maxWidth: 600, ...appear(f, 11),
            }}>{cap.sub}</div>
          </div>
        </div>
      );
    })}
  </>
);
