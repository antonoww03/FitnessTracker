const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const base=process.env.FITTRACK_E2E_URL || 'http://127.0.0.1:8000';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw Error('Disposable local app required');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  for (const width of [390,1280]) for (const offlineEnabled of [false,true]) {
   const context=await browser.newContext({viewport:{width,height:844}});
   const page=await context.newPage();
   const day=new Date().toISOString().slice(0,10);
   const headers={'X-Requested-With':'FitTrack'};
   assert((await context.request.post(base+'/api/auth/register',{headers,data:{username:'delete-'+width+'-'+Date.now(),password:'history-delete-password-123'}})).ok());
   const entries={
    food:{food_name:'Rice',food_description:'Rice',grams:100,calories:130,protein:3,fat:1,carbs:28,sugar:0,fiber:1},
    water:{amount_ml:251},weight:{weight_kg:74},training:{training_type:'Strength',duration_minutes:45,exercises:[]}
   };
   for(const [kind,data] of Object.entries(entries)) assert((await context.request.post(base+'/api/'+kind,{headers,data:{date:day,...data}})).ok());
   const initial=await (await context.request.get(base+'/api/history?start='+day+'&end='+day)).json();
   // Model the observed CDN failure: origin commits, conditional HTTP response becomes 412.
   await page.route('**/api/entries/**',async route=>{
    const response=await route.fetch();
    if(route.request().headers()['if-match'] && response.ok())
     await route.fulfill({status:412,contentType:'application/json',body:JSON.stringify({code:'412',message:'An error occurred'})});
    else await route.fulfill({response});
   });
   await page.goto(base);
   if(offlineEnabled) {
    await page.getByTestId('tool-settings').click();
    await page.getByLabel('Enable offline on this device').check();
    await page.waitForFunction(()=>[...document.querySelectorAll('label')].find(e=>e.textContent.includes('Enable offline on this device'))?.querySelector('input')?.disabled===false);
   }
   await page.getByTestId('tab-history').click();
   const history=page.getByTestId('full-history');
   for(let remaining=4;remaining>0;remaining--) {
    await page.waitForFunction(n=>document.querySelectorAll('[data-testid="full-history"] .ft-history-row').length===n,remaining);
    const responsePromise=page.waitForResponse(r=>r.request().method()==='DELETE' && r.url().includes('/api/entries/'));
    await history.getByRole('button',{name:'Delete',exact:true}).first().click();
    const response=await responsePromise;
    const request=response.request();
    const row=initial.find(row=>request.url().endsWith('/'+row.kind+'/'+row.id));
    assert(row);
    assert.equal(request.headers()['x-fittrack-revision'],row._revision);
    assert.equal(request.headers()['if-match'],undefined);
    assert.equal(response.status(),200);
   }
   await history.getByText('No entries',{exact:true}).waitFor();
   await page.reload();
   await page.getByTestId('tab-history').click();
   await page.getByTestId('full-history').getByText('No entries',{exact:true}).waitFor();
   assert.equal((await (await context.request.get(base+'/api/history?start='+day+'&end='+day)).json()).length,0);
   await context.close();
  }
  console.log('PASS: desktop/mobile History deletes all four kinds, offline enabled/disabled, proxy preconditions and reload');
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  const day=new Date().toISOString().slice(0,10);
  const headers={'X-Requested-With':'FitTrack'};
  assert((await context.request.post(base+'/api/auth/register',{headers,data:{username:'edits-'+Date.now(),password:'offline-edit-password-123'}})).ok());
  assert((await context.request.post(base+'/api/water',{headers,data:{date:day,amount_ml:250}})).ok());
  await page.goto(base);
  await page.getByTestId('tool-settings').click();
  await page.getByLabel('Enable offline on this device').check();
  await page.waitForFunction(()=>[...document.querySelectorAll('label')].find(e=>e.textContent.includes('Enable offline on this device'))?.querySelector('input')?.disabled===false);
  await page.getByTestId('tab-history').click();
  const history=page.getByTestId('full-history');
  await history.getByText('250 ml',{exact:false}).waitFor();
  await context.setOffline(true);
  await history.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByLabel('Amount (ml)',{exact:true}).fill('500');
  await page.getByTestId('edit-entry').getByRole('button',{name:'Save',exact:true}).click();
  await history.getByText('Pending edit',{exact:true}).waitFor();
  assert(await history.getByRole('button',{name:'Edit',exact:true}).isDisabled());
  await context.setOffline(false);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForFunction(async day=>{
   const r=await fetch('/api/history?start='+day+'&end='+day);const rows=await r.json();return rows.length===1 && rows[0].amount_ml===500;
  },day);
  await page.waitForFunction(()=>!document.querySelector('[data-testid="full-history"]')?.textContent.includes('Pending edit'));
  await context.setOffline(true);
  await history.getByRole('button',{name:'Delete',exact:true}).click();
  await history.getByText('Pending deletion',{exact:true}).waitFor();
  await context.setOffline(false);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await history.getByText('No entries',{exact:true}).waitFor();
  const rows=await (await context.request.get(base+'/api/history?start='+day+'&end='+day)).json();
  assert.equal(rows.length,0);
  console.log('PASS: mobile History offline edit/delete, pending state and reconnect sync');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
