// Run after the repository-root build; fail rather than deploy a 404 page.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join('a-share-observer','docs');
const required = [
  'index.html',
  'v3.css',
  'v3.js',
  'event-sector.js',
  join('vendor','echarts.min.js'),
  join('data','dashboard.json'),
  join('data','dates.json')
];
const missing=required.filter(path=>{
  const f=join(root,path);
  return !existsSync(f) || statSync(f).size === 0;
});
if(missing.length){
 console.error('Missing/empty EdgeOne deploy assets:', missing.join(', '));
 process.exit(1);
}
console.log('EdgeOne deployment output verified:',root);
