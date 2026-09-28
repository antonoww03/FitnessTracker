const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {gzipSync} = require('node:zlib');
const dir = path.join(__dirname,'../build/assets');
const files = fs.readdirSync(dir).filter(name=>name.endsWith('.js'));
const sizes = files.map(name=>gzipSync(fs.readFileSync(path.join(dir,name))).length);
assert(sizes.length > 0);
assert(Math.max(...sizes) < 240000, 'A JS chunk exceeds the 240KB gzip budget');
assert(sizes.reduce((a,b)=>a+b,0) < 380000, 'Total JS exceeds the 380KB gzip budget');
console.log('PASS: bundle budgets', JSON.stringify({largest:Math.max(...sizes),total:sizes.reduce((a,b)=>a+b,0)}));

// Keep the initial dependency graph below budget as new features are added.
const html = fs.readFileSync(path.join(dir, '../index.html'), 'utf8');
const initial = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+\.js)"/g)].map(match => path.basename(match[1]));
assert(initial.length > 0, 'Missing entry script');
const initialSize = [...new Set(initial)].reduce((sum, name) => sum + gzipSync(fs.readFileSync(path.join(dir, name))).length, 0);
assert(initialSize < 120000, 'Initial JS exceeds the 120KB gzip budget');
assert(files.some(name => name.startsWith('AppContent-')), 'Dashboard must remain a lazy chunk');
console.log('PASS: initial JS budget', initialSize);
