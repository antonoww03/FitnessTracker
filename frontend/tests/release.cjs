const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.join(__dirname,'../build');
const version=JSON.parse(fs.readFileSync(path.join(root,'version.json'))).version;
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sw=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
assert(version && html.includes(`content="${version}"`));
assert(sw.includes(`const VERSION = "${version}"`));
assert(!sw.includes('__FITTRACK_BUILD_ID__'));
const files=fs.readdirSync(path.join(root,'assets')).filter(f=>/\.(js|css)$/.test(f));
for(const file of files) assert(sw.includes('/assets/'+file),file+' must be precached');
assert(files.some(file=>file.endsWith('.js')&&fs.readFileSync(path.join(root,'assets',file),'utf8').includes(version)));
console.log('PASS: HTML, app, worker and release metadata share a version; all JS/CSS chunks precached');

// Execute the generated worker against release-aware caches, including a failed
// install during a deployment and a newer document served to an old worker.
const vm=require('node:vm');
(async()=>{
  const handlers={},store=new Map(),deleted=[];
  const name='fittrack-shell-'+version;
  let document=html,online=true,puts=0,assets=[];
  const response=()=>({ok:true,clone(){return this},text:async()=>document});
  const cache={addAll:async paths=>{assets=paths},put:async(k,r)=>{puts++;store.set(k,r)}};
  const self={location:{origin:'https://test.invalid'},clients:{claim:async()=>{}},addEventListener:(kind,fn)=>handlers[kind]=fn};
  vm.runInNewContext(sw,{URL,self,caches:{open:async()=>cache,keys:async()=>[name,'fittrack-shell-old','other-app'],delete:async k=>deleted.push(k),match:async(k,opts)=>{assert.equal(opts.cacheName,name);return store.get(k)}},fetch:async()=>{if(!online)throw Error('offline');return response()}});
  let pending;
  document='<html>Different deployment</html>';
  handlers.install({waitUntil:p=>pending=p});
  await assert.rejects(pending,/Deployment changed/);
  assert.equal(puts,0,'A failed install must not overwrite any offline shell');
  document=html;
  handlers.install({waitUntil:p=>pending=p});await pending;
  assert(assets.length>=files.length);
  const shell=store.get('/');
  document='<html>New deployment online</html>';
  handlers.fetch({request:{url:'https://test.invalid/',method:'GET',mode:'navigate'},respondWith:p=>pending=p});await pending;
  assert.equal(store.get('/'),shell);
  online=false;
  handlers.fetch({request:{url:'https://test.invalid/',method:'GET',mode:'navigate'},respondWith:p=>pending=p});assert.equal(await pending,shell);
  handlers.activate({waitUntil:p=>pending=p});await pending;
  assert.deepEqual(deleted,['fittrack-shell-old']);
  console.log('PASS: release mismatch fails installation, offline shell survives newer navigation, cleanup stays namespaced');
})().catch(e=>{console.error(e);process.exitCode=1});
