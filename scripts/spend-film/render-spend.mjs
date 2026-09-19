import {bundle} from '@remotion/bundler';
import {selectComposition, renderMedia,renderStill} from '@remotion/renderer';
import fs from 'node:fs';
const url=await bundle({entryPoint:new URL('./src/index.ts',import.meta.url).pathname});
const c=await selectComposition({serveUrl:url,id:'SproutSpend'});fs.mkdirSync('out/qa',{recursive:true});
if(process.argv.includes('--stills')){for(const frame of [60,150,225,315,405,510,690,750,855])await renderStill({composition:c,serveUrl:url,output:`out/qa/${frame}.png`,frame});}
else {let last=-1;await renderMedia({composition:c,serveUrl:url,codec:'h264',crf:18,outputLocation:'out/SPROUT-Spend.mp4',concurrency:4,onProgress:({progress})=>{let p=Math.floor(progress*10);if(p!==last){last=p;console.log(`${p*10}%`);}}});}
