// Make ECharts a first-party static asset for China-mainland visitors.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const input = join('node_modules', 'echarts', 'dist', 'echarts.min.js');
const outDir = join('docs', 'vendor');
if (!existsSync(input)) throw new Error('Missing ECharts dependency; run npm install first');
mkdirSync(outDir, { recursive: true });
copyFileSync(input, join(outDir, 'echarts.min.js'));
console.log('Static website assembled in ./docs; ECharts bundled locally.');
