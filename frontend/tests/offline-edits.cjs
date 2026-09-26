const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const base=process.env.FITTRACK_E2E_URL || 'http://127.0.0.1:8000';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw Error('Disposable local app required');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
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
