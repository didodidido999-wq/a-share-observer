// Lossless model of existing published archives only; no provider requests.
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {join} from 'node:path';
import '../docs/theme-model.js';
const dir=join('docs','data');
const snapshots=readdirSync(join(dir,'history')).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f=>JSON.parse(readFileSync(join(dir,'history',f))));
const memberIndexes=Object.fromEntries(readdirSync(join(dir,'sector-member-index')).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f=>[f.slice(0,10),JSON.parse(readFileSync(join(dir,'sector-member-index',f)))]));
const model=globalThis.MarketScopeThemeModel.build(snapshots,{memberIndexes});
const bytes=Buffer.from(JSON.stringify(model)),gz=gzipSync(bytes,{level:9});
if(gz.length>3_000_000)throw Error('Theme index exceeds 3 MB compressed budget');
mkdirSync(join(dir,'derived'),{recursive:true});writeFileSync(join(dir,'derived','theme-watch.json.gz'),gz);
console.log(`Theme index: ${model.dates.length} dates, ${bytes.length} raw bytes / ${gz.length} transfer bytes`);
