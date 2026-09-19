import { zh as core } from './core';
import { zh as app } from './app';
import { zh as dashboard } from './dashboard';
import { zh as landing } from './landing';
import { zh as kid } from './kid';
import { zh as knowledge } from './knowledge';
import { zh as components } from './components';
import { zh as perks } from './perks';
import { zh as votes } from './votes';
import { zh as autoinvest } from './autoinvest';
import { zh as guardian } from './guardian';
import { zh as guardianView } from './guardian-view';
import { zh as privacy } from './privacy';
import { zh as intelligence } from './intelligence';
import { zh as harvest } from './harvest';

/** Every Simplified Chinese string, keyed by its English source text. */
export const ZH: Record<string, string> = { ...core, ...app, ...dashboard, ...landing, ...kid, ...knowledge, ...components, ...perks, ...votes, ...autoinvest, ...guardian, ...guardianView, ...privacy, ...intelligence, ...harvest };
