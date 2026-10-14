import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile} from 'remotion';
import {easeOut, ios, iosMono, PT} from './theme';
import type {SiriBeat, SiriScene} from './timeline';

const p = (n: number) => n * PT;

// The Siri orb: a dark core with colored light swirling inside.
const Orb: React.FC<{f: number; level: number; scale: number}> = ({f, level, scale}) => {
  const size = p(100);
  const blob = (color: string, speed: number, phase: number, r: number, spread: number) => {
    const a = (f * speed + phase) * (Math.PI / 180);
    const wobble = 1 + 0.18 * level * Math.sin(f * 0.21 + phase);
    const x = Math.cos(a) * size * spread * wobble;
    const y = Math.sin(a * 1.3) * size * spread * 0.8 * wobble;
    return (
      <div style={{
        position: 'absolute', left: size / 2 - (size * r) / 2 + x, top: size / 2 - (size * r) / 2 + y,
        width: size * r, height: size * r, borderRadius: '50%',
        background: `radial-gradient(circle, ${color} 0%, ${color.replace('1)', '0.55)')} 38%, transparent 70%)`,
        filter: `blur(${p(4)}px)`, mixBlendMode: 'screen',
      }} />
    );
  };
  const breathe = 1 + 0.045 * level * Math.sin(f * 0.33) + 0.02 * Math.sin(f * 0.07);
  return (
    <div style={{
      position: 'absolute', left: p(220) - size / 2, top: p(876) - size / 2, width: size, height: size,
      transform: `scale(${scale * breathe})`,
    }}>
      <div style={{
        position: 'absolute', inset: -p(10), borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(120,140,255,0.42) 40%, rgba(255,80,170,0.18) 58%, transparent 72%)',
        filter: `blur(${p(8)}px)`, opacity: 0.55 + 0.35 * level,
      }} />
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%', overflow: 'hidden',
        background: 'radial-gradient(circle at 50% 55%, #05060f 0%, #0b1030 42%, #1d1850 70%, #43226e 100%)',
        boxShadow: `inset 0 0 ${p(10)}px rgba(255,255,255,0.18)`,
      }}>
        {blob('rgba(255,40,140,1)', 2.4, 0, 0.82, 0.2)}
        {blob('rgba(20,230,255,1)', -3.0, 120, 0.76, 0.22)}
        {blob('rgba(60,110,255,1)', 1.7, 240, 0.9, 0.12)}
        {blob('rgba(120,255,190,1)', -2.1, 60, 0.46, 0.26)}
        {[0, 1].map((k) => (
          <div key={k} style={{
            position: 'absolute', left: '12%', top: '30%', width: '76%', height: '40%', borderRadius: '50%',
            border: `${p(3.2)}px solid ${k ? 'rgba(120,240,255,0.85)' : 'rgba(255,120,210,0.85)'}`,
            filter: `blur(${p(1.6)}px)`, mixBlendMode: 'screen',
            transform: `rotate(${(k ? -1 : 1) * f * (2.6 + 1.4 * level) + k * 70}deg) scaleY(${0.55 + 0.25 * Math.sin(f * 0.05 + k)})`,
          }} />
        ))}
        <div style={{
          position: 'absolute', left: '18%', top: '12%', width: '46%', height: '30%', borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(255,255,255,0.55), transparent 70%)', filter: `blur(${p(2)}px)`,
        }} />
      </div>
    </div>
  );
};

const glass: React.CSSProperties = {
  background: 'rgba(255,255,255,0.88)',
  backdropFilter: `blur(${p(22)}px) saturate(1.6)`,
  WebkitBackdropFilter: `blur(${p(22)}px) saturate(1.6)`,
  borderRadius: p(26),
  boxShadow: `0 ${p(6)}px ${p(28)}px rgba(0,0,0,0.13), 0 0 0 ${p(0.5)}px rgba(0,0,0,0.05)`,
  fontFamily: ios,
  color: '#000',
};

const Revealed: React.FC<{text: string; f: number; reveal?: [number, number]}> = ({text, f, reveal}) => {
  if (!reveal) return <>{text}</>;
  const words = text.split(' ');
  const shown = interpolate(f, reveal, [0, words.length], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <>
      {words.map((w, i) => (
        <span key={i} style={{opacity: Math.max(0, Math.min(1, shown - i))}}>{w}{i < words.length - 1 ? ' ' : ''}</span>
      ))}
    </>
  );
};

const clampBoth = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// A beat continues the previous one when it keeps the same request text: the bubble stays put
// and grows to show the reply. Otherwise the old layer fades out before the new one fades in.
const continues = (prev: SiriBeat | undefined, beat: SiriBeat | undefined) =>
  Boolean(prev && beat && prev.to >= beat.from - 1 && prev.gray === beat.gray);
const sameCard = (prev: SiriBeat | undefined, beat: SiriBeat | undefined) =>
  Boolean(prev?.card && beat?.card && prev.to >= beat.from - 1 && JSON.stringify(prev.card) === JSON.stringify(beat.card));

const layerOpacity = (f: number, beat: SiriBeat, joinsPrev: boolean, joinsNext: boolean) => {
  const inOp = joinsPrev ? (f >= beat.from ? 1 : 0) : interpolate(f, [beat.from, beat.from + 8], [0, 1], clampBoth);
  const outOp = joinsNext ? (f < beat.to ? 1 : 0) : interpolate(f, [beat.to - 6, beat.to], [1, 0], clampBoth);
  return inOp * outOp;
};

const Bubble: React.FC<{beat: SiriBeat; f: number; opacity: number; grow: boolean; joined: boolean}> = ({beat, f, opacity, grow, joined}) => {
  const rise = joined ? 0 : interpolate(f, [beat.from, beat.from + 10], [p(8), 0], {easing: easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const open = grow ? interpolate(f, [beat.from, beat.from + 14], [0, 1], {easing: easeOut, ...clampBoth}) : 1;
  const show = grow ? interpolate(f, [beat.from + 4, beat.from + 14], [0, 1], clampBoth) : 1;
  return (
    <div style={{
      ...glass, position: 'absolute', left: p(9), width: p(422), bottom: p(956 - 832) - rise,
      padding: `${p(15)}px ${p(18)}px ${p(16)}px`, opacity,
    }}>
      <div style={{fontSize: p(17.5), lineHeight: 1.3, color: '#8a8a8e'}}>
        <Revealed text={beat.gray} f={f} reveal={beat.reveal} />{beat.black ? <span style={{opacity: show}}> ›</span> : ''}
      </div>
      {beat.black ? (
        <div style={{maxHeight: p(150) * open, overflow: 'hidden', opacity: show}}>
          <div style={{fontSize: p(17.5), lineHeight: 1.32, fontWeight: 600, paddingTop: p(14)}}>{beat.black}</div>
        </div>
      ) : null}
    </div>
  );
};

const Chip: React.FC = () => (
  <div style={{marginTop: p(14)}}>
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: p(5), padding: `${p(3)}px ${p(8)}px ${p(3)}px ${p(4)}px`,
      borderRadius: p(20), background: 'rgba(120,120,128,0.12)', fontSize: p(11.5), color: '#3c3c43',
    }}>
      <Img src={staticFile('appicon.png')} style={{width: p(14), height: p(14), borderRadius: p(3.4)}} />
      RuntimeBrief
    </div>
    <div style={{fontSize: p(11), color: '#6e6e73', marginTop: p(7)}}>Running your Shortcut</div>
  </div>
);

const Cube: React.FC = () => (
  <svg width={p(20)} height={p(20)} viewBox="0 0 24 24" fill="none" stroke="#6e6e73" strokeWidth={1.6} strokeLinejoin="round">
    <path d="M12 2.8 20.2 7.3v9.4L12 21.2 3.8 16.7V7.3z" />
    <path d="M3.8 7.3 12 11.8l8.2-4.5M12 11.8v9.4" />
  </svg>
);

const Card: React.FC<{beat: SiriBeat; f: number; opacity: number; joined: boolean; content?: number}> = ({beat, f, opacity, joined, content = 1}) => {
  const card = beat.card!;
  const settle = joined ? 99 : 0;
  const drop = interpolate(f + settle, [beat.from, beat.from + 14], [-p(16), 0], {easing: easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const grow = interpolate(f + settle, [beat.from, beat.from + 14], [0.97, 1], {easing: easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const base: React.CSSProperties = {
    ...glass, position: 'absolute', left: p(9), width: p(422), top: p(62) + drop,
    padding: `${p(17)}px ${p(18)}px ${p(16)}px`, opacity, transform: `scale(${grow})`, transformOrigin: '50% 0%',
  };
  if (card.kind === 'result') {
    return (
      <div style={base}><div style={{opacity: content}}>
        <div style={{display: 'flex', alignItems: 'center', gap: p(8)}}>
          <Cube />
          <div style={{fontSize: p(22), fontWeight: 600, flex: 1}}>{card.project}</div>
          <div style={{fontFamily: iosMono, fontSize: p(14), color: '#8a8a8e'}}>{card.branch}</div>
        </div>
        <div style={{fontSize: p(20), lineHeight: 1.36, marginTop: p(12)}}>{card.body}</div>
        <Chip />
      </div></div>
    );
  }
  const press = card.pressAt ?? -100;
  const pressed = interpolate(f, [press - 2, press + 2, press + 9], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const button = (label: string, primary: boolean): React.ReactNode => (
    <div style={{
      flex: 1, height: p(46), borderRadius: p(23), display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: p(17.5), fontWeight: primary ? 500 : 400,
      background: primary ? `rgb(${10 - 8 * pressed}, ${122 - 40 * pressed}, ${255 - 50 * pressed})` : 'rgba(120,120,128,0.16)',
      color: primary ? '#fff' : '#000', transform: primary ? `scale(${1 - 0.04 * pressed})` : undefined,
    }}>{label}</div>
  );
  return (
    <div style={base}><div style={{opacity: content}}>
      <div style={{fontSize: p(17.5), lineHeight: 1.3, fontWeight: 500}}>{card.title}</div>
      <div style={{display: 'flex', gap: p(9), marginTop: p(16)}}>
        {button('Cancel', false)}
        {button(card.action, true)}
      </div>
      <Chip />
    </div></div>
  );
};

export const SiriOverlay: React.FC<{scene: SiriScene; frame: number}> = ({scene, frame}) => {
  const f = frame - scene.start;
  const first = scene.beats[0];
  const last = scene.beats[scene.beats.length - 1];
  if (f < first.from - 12 || f > last.to + 16) return null;
  const dim = interpolate(f, [first.from - 10, first.from + 4, last.to, last.to + 12], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const orbScale = interpolate(f, [first.from - 8, first.from + 8, last.to, last.to + 12], [0.2, 1, 1, 0], {easing: easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const listening = Math.max(0, ...scene.beats.filter((b) => b.reveal).map((b) =>
    interpolate(f, [b.reveal![0] - 8, b.reveal![0], b.reveal![1], b.reveal![1] + 10], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})));
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{background: 'rgba(0,0,0,0.2)', opacity: dim}} />
      {scene.beats.map((beat, i) => {
        const prev = scene.beats[i - 1];
        const next = scene.beats[i + 1];
        const joinsPrev = continues(prev, beat);
        const op = layerOpacity(f, beat, joinsPrev, continues(beat, next));
        if (op <= 0) return null;
        const grow = joinsPrev && !prev.black && Boolean(beat.black);
        return <Bubble key={`b${i}`} beat={beat} f={f} opacity={op} grow={grow} joined={joinsPrev} />;
      })}
      {scene.beats.map((beat, i) => {
        if (!beat.card) return null;
        const prev = scene.beats[i - 1];
        const next = scene.beats[i + 1];
        const joinsPrev = sameCard(prev, beat);
        // A different card replacing this one: the new card covers it at once, then this one fades.
        const swapIn = Boolean(prev?.card && prev.to >= beat.from - 1 && !joinsPrev);
        const swapOut = Boolean(next?.card && beat.to >= next.from - 1 && !sameCard(beat, next));
        const inOp = joinsPrev || swapIn ? (f >= beat.from ? 1 : 0) : interpolate(f, [beat.from, beat.from + 8], [0, 1], clampBoth);
        const outOp = sameCard(beat, next) ? (f < beat.to ? 1 : 0)
          : swapOut ? interpolate(f, [beat.to + 8, beat.to + 16], [1, 0], clampBoth)
          : interpolate(f, [beat.to - 6, beat.to], [1, 0], clampBoth);
        const op = inOp * outOp;
        if (op <= 0) return null;
        const content = swapIn ? interpolate(f, [beat.from + 1, beat.from + 9], [0, 1], clampBoth) : 1;
        return <Card key={`c${i}`} beat={beat} f={f} opacity={op} joined={joinsPrev || swapIn} content={content} />;
      })}
      <Orb f={frame} level={0.35 + 0.65 * listening} scale={orbScale} />
    </AbsoluteFill>
  );
};
