import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
for(const dir of ['src/product','public/brand','public/art','public/fonts','public/audio','out/qa'])fs.mkdirSync(path.join(here,dir),{recursive:true});
for(const [source,dest] of [
 ['web/src/spend/SpendView.tsx','src/product/SpendView.tsx'],['web/src/spend/spend.css','src/product/spend.css'],
 ['web/public/brand/sprout-logo.png','public/brand/sprout-logo.png'],['web/public/art/harvest-bouquet.png','public/art/harvest-bouquet.png'],
 ['web/public/fonts/satoshi/Satoshi-Variable.woff2','public/fonts/Satoshi-Variable.woff2'],
])fs.copyFileSync(path.join(root,source),path.join(here,dest));
