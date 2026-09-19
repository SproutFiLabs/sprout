import React from 'react';
import {Composition,registerRoot} from 'remotion';
import {FamilyFilm} from './Film';
registerRoot(()=>React.createElement(Composition,{id:'SproutFamily',component:FamilyFilm,durationInFrames:1200,fps:30,width:1920,height:1080}));
