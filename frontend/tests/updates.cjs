const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.FITTRACK_E2E_URL || 'http://127.0.0.1:8000';
if (!['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw new Error('Disposable local application required');
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const context = await browser.newContext({serviceWorkers:'block'});
    const page = await context.newPage();
    const response = await context.request.post(base+'/api/auth/register', {
      headers:{'X-Requested-With':'FitTrack'}, data:{username:'updates-'+Date.now(),password:'test-update-password-123'},
    });
    assert(response.ok());
    const user = await response.json();
    const original = await (await context.request.get(base+'/version.json')).json();
    for (const url of ['/', '/version.json', '/service-worker.js']) {
      assert((await context.request.get(base+url)).headers()['cache-control'].includes('no-store'));
    }
    let changed = false;
    await page.route('**/version.json', route=>route.fulfill({json:changed?{version:'future-release'}:original}));
    await page.goto(base);
    await page.getByTestId('tool-profile').click();
    await page.getByLabel('First name',{exact:true}).fill('Unsaved');
    changed = true;
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    const update = page.getByRole('button',{name:'Update now',exact:true});
    await update.waitFor();
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({width, height:844});
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Update banner must fit mobile viewport");
    }
    await update.click();
    await page.getByRole('alert').filter({hasText:'Save or discard'}).waitFor();
    assert.equal(await page.getByLabel('First name',{exact:true}).inputValue(),'Unsaved');
    const saved = page.waitForResponse(r=>r.url().endsWith('/api/profile')&&r.request().method()==='PUT');
    await page.getByRole('button',{name:'Save profile',exact:true}).click();
    assert((await saved).ok());
    await page.evaluate(async id=>{
      await new Promise((resolve,reject)=>{
        const request=indexedDB.open('fittrack-offline-v1',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('items',{keyPath:'key'});
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{const db=request.result,tx=db.transaction('items','readwrite');tx.objectStore('items').put({key:id+':queue:update-test',value:{time:Date.now()}});tx.oncomplete=()=>{db.close();resolve()};};
      });
    },user.id);
    await update.click();
    await page.getByRole('alert').filter({hasText:'offline sync'}).waitFor();
    await page.evaluate(async id=>{
      await new Promise(resolve=>{const request=indexedDB.open('fittrack-offline-v1',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('items','readwrite');tx.objectStore('items').delete(id+':queue:update-test');tx.oncomplete=()=>{db.close();resolve()};};});
    },user.id);
    await page.route(base+'/', route=>route.fulfill({status:503,body:'Unavailable'}));
    await update.click();
    await page.getByRole('alert').filter({hasText:'Update unavailable'}).waitFor();
    await page.unroute(base+'/');
    changed=false;
    await Promise.all([page.waitForEvent('load'), update.click()]);
    await page.getByTestId('tool-profile').click();
    assert.equal(await page.getByLabel('First name',{exact:true}).inputValue(),'Unsaved');
    assert.equal(await page.getByRole('button',{name:'Update now',exact:true}).count(),0);
    console.log('PASS: update discovery, draft guard, offline queue guard, unavailable deployment, safe reload and saved data');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
