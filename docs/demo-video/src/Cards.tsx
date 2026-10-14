import React from 'react';
import {AbsoluteFill, Img, interpolate, spring, staticFile} from 'remotion';
import {C, easeOut, FPS, mono, s, sans} from './theme';
import {T} from './timeline';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const rise = (f: number, delay: number, dist = 26) => ({
  opacity: interpolate(f - delay, [0, 18], [0, 1], clamp),
  transform: `translateY(${interpolate(f - delay, [0, 26], [dist, 0], {...clamp, easing: easeOut})}px)`,
});

const AppIcon: React.FC<{size: number}> = ({size}) => (
  <Img src={staticFile('appicon.png')} style={{
    width: size, height: size, borderRadius: size * 0.2237,
    boxShadow: '0 24px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)',
  }} />
);

export const TitleCard: React.FC<{frame: number}> = ({frame}) => {
  const f = frame - T.title;
  const end = T.problem;
  if (frame > end + 20) return null;
  const pop = spring({frame: f - 6, fps: FPS, config: {damping: 14, stiffness: 120, mass: 0.9}});
  const out = interpolate(frame, [end - 16, end + 4], [1, 0], clamp);
  const drift = interpolate(frame, [0, end], [1.0, 1.035]);
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', opacity: out}}>
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `scale(${drift})`}}>
        <div style={{transform: `scale(${0.6 + 0.4 * pop})`, opacity: Math.min(1, pop * 1.4)}}><AppIcon size={176} /></div>
        <div style={{fontFamily: mono, fontSize: 19, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.beacon, marginTop: 46, ...rise(f, 16)}}>
          AgentHangar / RuntimeBrief
        </div>
        <div style={{fontFamily: sans, fontWeight: 700, fontSize: 128, letterSpacing: '-0.035em', color: C.bright, lineHeight: 1, marginTop: 18, ...rise(f, 22)}}>
          RuntimeBrief
        </div>
        <div style={{fontFamily: sans, fontSize: 40, color: C.ink, marginTop: 30, letterSpacing: '-0.01em', ...rise(f, 34)}}>
          Know what moved. <span style={{color: C.faint}}>See the evidence.</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const VENDORS = [
  {logo: 'claude-dark.svg', h: 44, name: 'Claude Code'},
  {logo: 'openai-dark.svg', h: 46, name: 'Codex'},
  {logo: 'cursor-dark.svg', h: 44, name: 'Cursor'},
];

export const ProblemCard: React.FC<{frame: number}> = ({frame}) => {
  const f = frame - T.problem;
  if (f < -4 || frame > T.ch1 + 10) return null;
  const leave = interpolate(frame, [T.phoneIn - 22, T.phoneIn + 14], [0, 1], {...clamp, easing: easeOut});
  return (
    <AbsoluteFill style={{opacity: 1 - leave}}>
      <div style={{position: 'absolute', left: 150, top: 248, width: 1620, transform: `translateY(${-30 * leave}px)`}}>
        <div style={{fontFamily: mono, fontSize: 19, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.beacon, ...rise(f, 4)}}>The problem</div>
        <div style={{fontFamily: sans, fontWeight: 700, fontSize: 74, lineHeight: 1.06, letterSpacing: '-0.025em', color: C.bright, marginTop: 26, ...rise(f, 9)}}>
          Three agent vendors. Three apps.
        </div>
        <div style={{fontFamily: sans, fontSize: 40, lineHeight: 1.3, color: C.muted, marginTop: 18, ...rise(f, 16)}}>
          And no single answer to “what needs me right now?”
        </div>
        <div style={{display: 'flex', gap: 28, marginTop: 72}}>
          {VENDORS.map((v, i) => (
            <div key={v.name} style={{
              width: 420, height: 230, borderRadius: 22, background: C.raised, border: `1px solid ${C.line}`,
              padding: '38px 40px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
              ...rise(f, 26 + i * 9, 40),
            }}>
              <div style={{height: 50, display: 'flex', alignItems: 'center'}}>
                <Img src={staticFile(v.logo)} style={{height: v.h}} />
              </div>
              <div>
                <div style={{fontFamily: mono, fontSize: 20, color: C.ink}}>{v.name}</div>
                <div style={{fontFamily: sans, fontSize: 24, color: C.faint, marginTop: 8}}>Shows only its own agents</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const EndCard: React.FC<{frame: number}> = ({frame}) => {
  const f = frame - (T.end + s(0.45));
  if (f < -2) return null;
  const pop = spring({frame: f, fps: FPS, config: {damping: 15, stiffness: 110}});
  const fadeOut = interpolate(frame, [T.total - 24, T.total - 2], [1, 0], clamp);
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', opacity: fadeOut}}>
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center'}}>
        <div style={{transform: `scale(${0.7 + 0.3 * pop})`, opacity: Math.min(1, pop * 1.5)}}><AppIcon size={132} /></div>
        <div style={{fontFamily: sans, fontWeight: 700, fontSize: 96, lineHeight: 1.03, letterSpacing: '-0.03em', color: C.bright, marginTop: 52, ...rise(f, 8)}}>
          Every agent. Every vendor.<br /><span style={{color: C.beacon}}>One place.</span>
        </div>
        <div style={{fontFamily: sans, fontSize: 32, color: C.muted, marginTop: 34, ...rise(f, 18)}}>
          RuntimeBrief for iPhone, with a self-hosted daemon on your Mac.
        </div>
        <div style={{display: 'flex', gap: 22, marginTop: 54, ...rise(f, 28)}}>
          {['On the App Store', 'github.com/agenthangar/runtimebrief'].map((t) => (
            <div key={t} style={{
              fontFamily: mono, fontSize: 21, color: C.ink, padding: '14px 24px', borderRadius: 999,
              border: `1px solid ${C.line}`, background: C.raised,
            }}>{t}</div>
          ))}
        </div>
      </div>
      <div style={{position: 'absolute', bottom: 64, display: 'flex', alignItems: 'center', gap: 14, ...rise(f, 36, 12)}}>
        <Img src={staticFile('agenthangar.svg')} style={{width: 30, height: 30}} />
        <div style={{fontFamily: mono, fontSize: 19, color: C.faint, letterSpacing: '0.06em'}}>agenthangar.ai</div>
      </div>
    </AbsoluteFill>
  );
};
