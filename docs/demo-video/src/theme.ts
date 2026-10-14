import {loadFont as loadGrotesk} from '@remotion/google-fonts/SpaceGrotesk';
import {loadFont as loadPlex} from '@remotion/google-fonts/IBMPlexMono';
import {Easing} from 'remotion';

export const FPS = 60;
export const W = 1920;
export const H = 1152;

// agenthangar.ai palette
export const C = {
  bg: '#141516',
  raised: '#1c1d1f',
  line: '#2a2c2e',
  ink: '#ebe7df',
  bright: '#f6f3ec',
  muted: '#b8b3a8',
  faint: '#7d786f',
  beacon: '#f2a93b',
};

export const sans = loadGrotesk('normal', {weights: ['400', '500', '700'], subsets: ['latin']}).fontFamily;
export const mono = loadPlex('normal', {weights: ['400', '500'], subsets: ['latin']}).fontFamily;
// The iPhone UI uses the system font (SF Pro on macOS, where this renders).
export const ios = "-apple-system, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif";
export const iosMono = "'SF Mono', ui-monospace, Menlo, monospace";

export const ease = Easing.bezier(0.33, 0, 0.2, 1);
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);

export const s = (seconds: number) => Math.round(seconds * FPS);

// Source footage: 1320x2868 recording scaled to a 900x1956 proxy (440x956 pt).
export const PROXY_W = 900;
export const PROXY_H = 1956;
export const PT = PROXY_W / 440; // proxy px per iOS point
