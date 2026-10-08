const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.FITTRACK_E2E_URL || 'http://127.0.0.1:8000';
if (!['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw Error('Disposable local app required');
(async () => {
 const browser = await chromium.launch({headless:true});
 try {
  const context = await browser.newContext({viewport:{width:320,height:844}});
  assert((await context.request.post(base+'/api/auth/register', {headers:{'X-Requested-With':'FitTrack'},data:{email:'test-'+Date.now()+'-'+Math.random().toString(36).slice(2)+'@example.com',username:'connection-'+Date.now(),password:'Connection-test-password-123'}})).ok());
  const page = await context.newPage();
  let failBoot = true;
  await page.route('**/api/auth/me', route => failBoot ? route.fulfill({status:503,contentType:'application/json',body:'{}'}) : route.continue());
  await page.goto(base);
  await page.locator('.ft-auth').getByRole('button',{name:'Retry',exact:true}).waitFor();
  await page.evaluate(()=>window.retainedMarker='same-document');
  failBoot = false;
  await page.locator('.ft-auth').getByRole('button',{name:'Retry',exact:true}).click();
  await page.getByTestId('tool-profile').click();
  await page.getByLabel('First name',{exact:true}).fill('Preserved draft');
  let release, writes = 0;
  await page.route('**/api/profile', async route => {
   if (route.request().method() !== 'PUT') return route.continue();
   writes++;
   await new Promise(resolve => { release = resolve; });
   await route.abort('failed');
  });
  await page.getByRole('button',{name:'Save profile',exact:true}).click();
  await page.getByText('The server is taking longer than usual. Startup may take about a minute. Keep this page open.',{exact:true}).waitFor({timeout:15000});
  assert.equal(writes,1);
  assert(await page.getByRole('button',{name:'Saving…',exact:true}).isDisabled());
  release();
  await page.getByRole('button',{name:'Save profile',exact:true}).waitFor();
  assert.equal(await page.getByLabel('First name',{exact:true}).inputValue(),'Preserved draft');
  await page.locator('.ft-connection').getByRole('button',{name:'Retry',exact:true}).click();
  await page.getByText('Connection restored. Retry the failed action in its form; pending offline changes sync separately.',{exact:true}).waitFor();
  assert.equal(writes,1,'Connectivity retry must not replay writes');
  assert.equal(await page.evaluate(()=>window.retainedMarker),'same-document');
  assert.equal(await page.getByLabel('First name',{exact:true}).inputValue(),'Preserved draft');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1));
  await page.unroute('**/api/profile');
  await page.getByRole('button',{name:'Save profile',exact:true}).click();
  await page.getByText('Profile saved',{exact:true}).waitFor();
  assert.equal((await (await context.request.get(base+'/api/profile')).json()).first_name,'Preserved draft');
  console.log('PASS: slow status, initial-load retry, retained draft, no automatic writes, recovery without reload, 320px layout');
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
