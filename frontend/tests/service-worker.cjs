const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const handlers={},stored=new Map();let assets=[],offline=false,claimed=false,focused=false,closed=false,shown=null;
const response={ok:true,clone(){return this},text:async()=>'<script src="/static/js/main.hash.js"></script><link href="/static/css/main.hash.css"><script src="/assets/index-hash.js"></script>'};
const cache={addAll:async values=>{assets=values},put:async(k,v)=>stored.set(k,v)};
const self={location:{origin:'https://test.invalid'},registration:{showNotification:async(title,options)=>{shown={title,options}}},clients:{claim:async()=>{claimed=true}},addEventListener:(name,fn)=>{handlers[name]=fn}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/service-worker.js'),'utf8'),{URL,clients:{matchAll:async()=>[{navigate:async()=>{},focus:async()=>{focused=true}}],openWindow:async()=>{}},self,caches:{open:async()=>cache,keys:async()=>[],match:async k=>stored.get(k)},fetch:async()=>{if(offline)throw new Error('offline');return response}});
(async()=>{
let promise;handlers.install({waitUntil:p=>{promise=p}});await promise;
assert(assets.includes('/static/js/main.hash.js'));assert(assets.includes('/static/css/main.hash.css'));assert(stored.has('/'));assert(assets.includes('/assets/index-hash.js'));
handlers.activate({waitUntil:p=>{promise=p}});await promise;assert(claimed);
let intercepted=false;handlers.fetch({request:{url:'https://test.invalid/api/summary',method:'GET'},respondWith:()=>{intercepted=true}});assert(!intercepted);
// A fetch response must not finish before its cache write: the worker can
// otherwise be terminated and the next offline reload lose that asset.
for (const request of [
  {url:'https://test.invalid/assets/late.js',method:'GET'},
  {url:'https://test.invalid/',method:'GET',mode:'navigate'},
]) {
  const originalPut=cache.put;
  let release, finished=false;
  cache.put=()=>new Promise(resolve=>{release=resolve});
  handlers.fetch({request,respondWith:p=>{promise=p}});
  promise.then(()=>{finished=true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof release,'function');
  assert.equal(finished,false,'Response must keep the cache write alive');
  release(); await promise;
  cache.put=originalPut;
}
offline=true;handlers.fetch({request:{url:'https://test.invalid/',method:'GET',mode:'navigate'},respondWith:p=>{promise=p}});assert.equal(await promise,response);
handlers.notificationclick({notification:{data:{url:'/'},close:()=>{closed=true}},waitUntil:p=>{promise=p}});await promise;assert(closed&&focused);
handlers.push({data:{json:()=>({title:'Water',body:'Drink',tag:'water',url:'/'})},waitUntil:p=>{promise=p}});await promise;assert.equal(shown.title,'Water');assert.equal(shown.options.body,'Drink');
console.log('PASS: PWA asset precache, activation, API bypass, offline navigation, push delivery and notification click.');
})().catch(e=>{console.error(e);process.exitCode=1});
