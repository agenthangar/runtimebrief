import {FPS, s} from './theme';

// A piece of the phone recording placed on the video timeline.
// srcIn is seconds into the recording; rate > 1 speeds it up; freeze holds srcIn.
export type Shot = {start: number; dur: number; srcIn: number; rate: number; freeze?: boolean; fade?: number};

// Taps in the recording, in iOS points, at recording time (seconds).
export const TAPS = [
  {src: 23.95, x: 150, y: 290},
  {src: 37.6, x: 110, y: 641},
  {src: 79.1, x: 120, y: 786},
  {src: 97.9, x: 200, y: 865},
  {src: 174.25, x: 152, y: 571},
  {src: 121.95, x: 90, y: 404},
  {src: 133.85, x: 340, y: 487},
  {src: 144.7, x: 217, y: 431},
  {src: 162.0, x: 220, y: 601},
];

export const T = {
  title: 0,
  problem: s(3.35),
  phoneIn: s(6.4),
  ch1: s(7.35),
  ch2: 0, ch3: 0, ch4: 0, ch5: 0, end: 0, total: 0,
};

const shots: Shot[] = [];
let cursor = T.phoneIn;
const add = (srcIn: number, srcOut: number, rate = 1, fade = 0) => {
  const dur = Math.round(((srcOut - srcIn) * FPS) / rate);
  shots.push({start: cursor - fade, dur: dur + fade, srcIn, rate, fade});
  cursor += dur;
};
const hold = (src: number, seconds: number, fade = 0) => {
  const dur = s(seconds);
  shots.push({start: cursor - fade, dur: dur + fade, srcIn: src, rate: 1, freeze: true, fade});
  cursor += dur;
};

// 01 Every project: the portfolio (static), played as-is.
add(1.5, 1.5 + (s(13.2) - T.phoneIn) / FPS);
// 02 Evidence: idle gaps are cut; each cut joins identical screens.
T.ch2 = cursor;
add(23.25, 26.4);
add(37.25, 39.6);
add(51.0, 53.9, 1.6);
add(64.1, 66.8, 1.6);
add(78.95, 80.2);
add(82.4, 84.8, 1.6);
add(97.65, 99.2);
add(107.7, 110.6, 1.6);
add(110.6, 111.6);
// 03 Ask Siri: over the project screen.
T.ch3 = cursor;
hold(111.8, 12.3);
// 04 Start an agent by voice, then the new Codex task in the app.
T.ch4 = cursor;
hold(111.8, 9.9);
add(162.7, 166.0, 1, s(0.4));
// 05 Steer it: Siri sends a follow-up; the conversation shows it.
T.ch5 = cursor;
hold(170.0, 8.6);
add(173.9, 176.1);
add(199.35, 203.2, 1, s(0.35));
T.end = cursor;
T.total = T.end + s(5.2);

export const SHOTS = shots;

// Recording time shown at a video frame (for the status bar patch and taps).
export const srcAt = (frame: number): number => {
  let found = SHOTS[0];
  for (const shot of SHOTS) if (frame >= shot.start) found = shot;
  if (found.freeze) return found.srcIn;
  return found.srcIn + ((frame - found.start) / FPS) * found.rate;
};

export type Caption = {from: number; eyebrow: string; title: string; sub: string};

export const CAPTIONS: Caption[] = [
  {from: T.ch1, eyebrow: '01 / Every project', title: 'Every agent.\nOne list.', sub: 'Claude Code, Codex and Cursor work across every project on your Mac. Amber needs you. Green is ready to review.'},
  {from: T.ch2, eyebrow: '02 / The evidence', title: 'Every claim,\nbacked by evidence.', sub: 'Agent sessions from every vendor, read from their own records on your Mac.'},
  {from: T.ch2 + s(10.3), eyebrow: '02 / The evidence', title: 'Commits, TestFlight\nand App Store.', sub: 'Straight from git and App Store Connect, not from a chatbot’s memory.'},
  {from: T.ch3, eyebrow: '03 / Just ask', title: 'Ask Siri what\nneeds you.', sub: 'Two-line answers from briefs RuntimeBrief keeps fresh in the background.'},
  {from: T.ch3 + s(5.9), eyebrow: '03 / Just ask', title: 'Or ask about\nany project.', sub: 'In your own words. Each analysis says how fresh it is.'},
  {from: T.ch4, eyebrow: '04 / Start an agent', title: 'Start an agent\nby voice.', sub: 'Siri confirms the task before anything runs on your Mac.'},
  {from: T.ch4 + s(9.9), eyebrow: '04 / Start an agent', title: 'It shows up\nin RuntimeBrief.', sub: 'With its conversation one tap away.'},
  {from: T.ch5, eyebrow: '05 / Steer it', title: 'Talk to the\nrunning agent.', sub: 'Siri reads the message back before sending. The same for Claude Code, Codex and Cursor.'},
];

// Siri beats: frames are relative to the scene start.
export type SiriBeat = {
  from: number;
  to: number;
  gray: string; // what the person said
  reveal?: [number, number]; // words appear between these frames (listening)
  black?: string; // Siri's reply
  card?: {kind: 'result'; project: string; branch: string; body: string}
    | {kind: 'confirm'; title: string; action: string; pressAt?: number};
};

export type SiriScene = {start: number; end: number; beats: SiriBeat[]};

const attention: SiriBeat[] = [
  {from: s(0.2), to: s(1.75), gray: 'What needs attention in RuntimeBrief?', reveal: [s(0.3), s(1.55)]},
  {from: s(1.75), to: s(5.4), gray: 'What needs attention in RuntimeBrief?',
    black: '1 project needs attention: Catalog Builder. Catalog Builder: A copy decision needs attention.'},
  {from: s(5.6), to: s(7.3), gray: 'Ask RuntimeBrief what’s the status of Sample Tracker', reveal: [s(5.7), s(7.1)]},
  {from: s(7.3), to: s(12.0), gray: 'Ask RuntimeBrief what’s the status of Sample Tracker',
    card: {kind: 'result', project: 'Sample Tracker', branch: 'feature/export-checks',
      body: 'Sample Tracker, analyzed 2 minutes ago: Recently, the export validation was completed. Currently, all 24 checks pass and it’s ready to review.'}},
];

const start: SiriBeat[] = [
  {from: s(0.2), to: s(1.75), gray: 'Start Codex for Sample Tracker from RuntimeBrief', reveal: [s(0.3), s(1.6)]},
  {from: s(1.75), to: s(3.35), gray: 'Start Codex for Sample Tracker from RuntimeBrief', black: 'What should Codex work on?'},
  {from: s(3.35), to: s(4.85), gray: 'Add a CSV export button to the summary screen', reveal: [s(3.45), s(4.65)]},
  {from: s(4.85), to: s(7.15), gray: 'Add a CSV export button to the summary screen',
    black: 'Start Codex session for Sample Tracker to Add a CSV export button to the summary screen?',
    card: {kind: 'confirm', title: 'Start Codex session for Sample Tracker to Add a CSV export button to the summary screen?', action: 'Continue', pressAt: s(6.75)}},
  {from: s(7.15), to: s(9.6), gray: 'Continue', black: 'Codex for Sample Tracker. It’s starting now.',
    card: {kind: 'result', project: 'Sample Tracker', branch: 'feature/export-checks', body: 'Codex for Sample Tracker. It’s starting now.'}},
];

const tell: SiriBeat[] = [
  {from: s(0.2), to: s(1.65), gray: 'Tell the Sample Tracker agent in RuntimeBrief', reveal: [s(0.3), s(1.5)]},
  {from: s(1.65), to: s(3.15), gray: 'Tell the Sample Tracker agent in RuntimeBrief', black: 'What should I tell the agent?'},
  {from: s(3.15), to: s(4.45), gray: 'Also add a test for the export', reveal: [s(3.25), s(4.25)]},
  {from: s(4.45), to: s(6.65), gray: 'Also add a test for the export',
    black: 'Send to Codex on Sample Tracker: Also add a test for the export?',
    card: {kind: 'confirm', title: 'Send to Codex on Sample Tracker: Also add a test for the export?', action: 'Send', pressAt: s(6.25)}},
  {from: s(6.65), to: s(8.3), gray: 'Send', black: 'Sent to Codex on Sample Tracker.'},
];

export const SIRI: SiriScene[] = [
  {start: T.ch3, end: T.ch3 + s(12.3), beats: attention},
  {start: T.ch4, end: T.ch4 + s(9.9), beats: start},
  {start: T.ch5, end: T.ch5 + s(8.6), beats: tell},
];

// Amber outlines that point at what the caption describes (iOS points).
export const HIGHLIGHTS = [
  {from: T.ch1 + s(1.5), to: T.ch1 + s(5.6), x: 283, y: 416.5, w: 118, h: 29.5, r: 14.75, color: '#f2a93b'},
  {from: T.ch1 + s(2.3), to: T.ch1 + s(5.6), x: 302, y: 258, w: 99, h: 29, r: 14.5, color: '#34c759'},
  {from: T.ch4 + s(10.5), to: T.ch4 + s(13.1), x: 28, y: 430, w: 384, h: 168, r: 22, color: '#f2a93b'},
];
