// Derive compact re-evaluable inputs from existing public files; no network or new source collection.
import {readFileSync,readdirSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {gzipSync,gunzipSync} from 'node:zlib';import {join} from 'node:path';
import '../docs/theme-model.js';
import '../docs/sector-startup-model.js';
const dir='docs/data';
const snapshots=readdirSync(join(dir,'history')).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f=>JSON.parse(readFileSync(join(dir,'history',f))));
const memberIndexes=Object.fromEntries(readdirSync(join(dir,'sector-member-index')).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f=>[f.slice(0,10),JSON.parse(readFileSync(join(dir,'sector-member-index',f)))]));
const riskRecords=readdirSync(join(dir,'risk-stocks')).filter(f=>f.endsWith('.json')).map(f=>{const record=JSON.parse(readFileSync(join(dir,'risk-stocks',f)));if(record.code!==f.slice(0,-5))throw Error('Risk archive identity mismatch: '+f);return record;});
const themePath=join(dir,'derived','theme-watch.json.gz');
const themeModel=existsSync(themePath)?JSON.parse(gunzipSync(readFileSync(themePath))):null;
const base=globalThis.SectorStartupModel.prepare(snapshots,{memberIndexes,riskRecords,themeModel});
const model=globalThis.SectorStartupModel.evaluate(base);console.log(JSON.stringify({...model.coverage,by_date:model.coverage.by_date.filter(d=>d.eligible>0)}));
const bytes=Buffer.from(JSON.stringify(base)),gz=gzipSync(bytes,{level:9});if(gz.length>3_000_000)throw Error('Startup base exceeds 3 MB compressed budget');
mkdirSync(join(dir,'derived'),{recursive:true});writeFileSync(join(dir,'derived','sector-startups.json.gz'),gz);
console.log(`Startup base: ${base.dates.length} dates, ${bytes.length} raw bytes / ${gz.length} transfer bytes`);
