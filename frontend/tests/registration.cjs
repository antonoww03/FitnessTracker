const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.FITTRACK_E2E_URL || 'http://127.0.0.1:18002';
if (!['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw Error('Disposable local app required');
(async () => {
 const browser=await chromium.launch({headless:true});
 try {
  const context=await browser.newContext({viewport:{width:320,height:844}});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  assert.deepEqual(await page.locator('form input').evaluateAll(inputs=>inputs.map(i=>i.name)),['email','username','password','confirm_password']);
  const username='register-'+Date.now();
  await page.getByLabel('Email',{exact:true}).fill('New.'+Date.now()+'@EXAMPLE.COM');
  await page.getByLabel('Username',{exact:true}).fill(username);
  const password=page.getByLabel('Password',{exact:true}),confirm=page.getByLabel('Confirm password',{exact:true});
  await password.fill('lowercase123');
  await confirm.fill('different');
  assert.equal(await password.evaluate(e=>e.validity.valid),false);
  assert.equal(await confirm.evaluate(e=>e.validity.valid),false);
  await password.fill('Abcdef12');await confirm.fill('Abcdef12');
  assert.equal(await page.locator('form').evaluate(e=>e.checkValidity()),true);
  await page.getByRole('button',{name:'Show password',exact:true}).click();
  assert.equal(await password.getAttribute('type'),'text');assert.equal(await confirm.getAttribute('type'),'text');
  await page.getByRole('button',{name:'Hide confirm password',exact:true}).click();
  assert.equal(await password.inputValue(),'Abcdef12');assert.equal(await password.getAttribute('type'),'password');
  await password.focus();
  await password.evaluate(e=>e.dispatchEvent(new KeyboardEvent('keydown',{key:'A',modifierCapsLock:true,bubbles:true})));
  await page.getByText('Caps Lock is on.',{exact:true}).waitFor();
  await confirm.focus();assert.equal(await page.getByText('Caps Lock is on.',{exact:true}).count(),0);
  let writes=0, release;
  await page.route('**/api/auth/register',async route=>{
   writes++;
   const body=route.request().postDataJSON();
   assert.equal(body.confirm_password,undefined);assert.equal(body.email,body.email.toLowerCase());
   if(writes===1) {await new Promise(resolve=>{release=resolve});await route.fulfill({status:503,contentType:'application/json',body:'{}'});}
   else await route.continue();
  });
  await confirm.press('Enter');
  await page.waitForFunction(()=>document.querySelector('form')?.getAttribute('aria-busy')==='true');
  await page.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
  assert.equal(writes,1);release();
  await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
  assert.equal(await password.inputValue(),'Abcdef12');assert.equal(await confirm.inputValue(),'Abcdef12');
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.getByRole('button',{name:'I saved my code',exact:true}).click();
  await page.getByTestId('tool-settings').waitFor();
  assert.equal(writes,2);
  assert((await context.request.post(base+'/api/auth/logout',{headers:{'X-Requested-With':'FitTrack'}})).ok());
  await page.reload();
  await page.getByLabel('Username',{exact:true}).fill(username);await page.getByLabel('Password',{exact:true}).fill('Abcdef12');
  const login=page.waitForResponse(r=>r.url().endsWith('/api/auth/login'));
  await page.getByLabel('Password',{exact:true}).press('Enter');assert.equal((await login).status(),200);
  await context.close();
  for(const width of [320,390]) {
   const c=await browser.newContext({viewport:{width,height:844}});const p=await c.newPage();await p.goto(base);
   await p.getByRole('button',{name:'Create account',exact:true}).click();
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   for(const label of ['Show password','Show confirm password']) {const box=await p.getByRole('button',{name:label,exact:true}).boundingBox();assert(box.width>=44&&box.height>=44);}
   await c.close();
  }
  assert.deepEqual(errors,[]);console.log('Registration validation, visibility, Caps Lock, Enter, duplicate-submit, retry, login and mobile layout passed');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
