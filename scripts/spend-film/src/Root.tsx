import React from 'react';
import {Composition} from 'remotion';
import {SpendFilm} from './SpendFilm';
export const RemotionRoot=()=> <Composition id="SproutSpend" component={SpendFilm} durationInFrames={900} fps={30} width={1920} height={1080}/>;
