import React from 'react';
import {Composition} from 'remotion';
import {Promo} from './Promo';
import {AppPreview, PREVIEW_FPS, PREVIEW_FRAMES, PREVIEW_H, PREVIEW_W} from './AppPreview';
import {FPS, H, W} from './theme';
import {T} from './timeline';

export const Root: React.FC = () => (
  <>
    <Composition id="Promo" component={Promo} durationInFrames={T.total} fps={FPS} width={W} height={H} />
    <Composition id="AppPreview" component={AppPreview} durationInFrames={PREVIEW_FRAMES} fps={PREVIEW_FPS} width={PREVIEW_W} height={PREVIEW_H} />
  </>
);
