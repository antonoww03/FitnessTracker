const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.FITTRACK_E2E_URL || 'http://127.0.0.1:8000';
if (!['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw Error('Disposable local app required');
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    for (const width of [320,390]) {
      const context = await browser.newContext({viewport:{width,height:844}});
      const page = await context.newPage();
      await page.goto(base);
      await page.getByLabel('Username',{exact:true}).fill('missing-account');
      await page.getByLabel('Password',{exact:true}).fill('Abcdef12');
      let pending = page.waitForResponse(r=>r.url().endsWith('/api/auth/login'));
      await page.getByLabel('Password',{exact:true}).press('Enter');
      assert.equal((await pending).status(),401); // Reaches credential check, not policy validation.
      const username = 'bridge-'+width+'-'+Date.now();
      assert((await context.request.post(base+'/api/auth/register', {
        headers:{'X-Requested-With':'FitTrack'},data:{email:'test-'+Date.now()+'-'+Math.random().toString(36).slice(2)+'@example.com',username,password:'Bridge-test-password-123'},
      })).ok());
      await page.reload();
      await page.getByTestId('tool-settings').click();
      page.on('dialog',dialog=>dialog.accept());
      const security = page.locator('section').filter({has:page.getByRole('heading',{name:'Account security',exact:true})});
      await security.getByLabel('Current password',{exact:true}).first().fill('Abcdef12');
      await security.getByLabel('New password',{exact:true}).fill('another-password-123');
      for (const [name,path] of [['Change password','change-password'],['Sign out all devices','logout-all']]) {
        pending=page.waitForResponse(r=>r.url().endsWith('/api/auth/'+path));
        await security.getByRole('button',{name,exact:true}).click();
        assert.equal((await pending).status(),403);
      }
      const recovery=page.locator('section').filter({has:page.getByRole('heading',{name:'Account recovery',exact:true})});
      await recovery.getByLabel('Current password',{exact:true}).fill('Abcdef12');
      pending=page.waitForResponse(r=>r.url().endsWith('/api/auth/recovery-code'));
      await recovery.getByRole('button',{name:'Generate new recovery code',exact:true}).click();
      assert.equal((await pending).status(),403);
      await security.getByText('Delete account',{exact:true}).first().click();
      const deletion=security.locator('details');
      await deletion.getByLabel('Current password',{exact:true}).fill('Abcdef12');
      await deletion.getByLabel('Type your username to confirm',{exact:true}).fill(username);
      await deletion.getByRole('checkbox').check();
      pending=page.waitForResponse(r=>r.url().endsWith('/api/auth/account'));
      await deletion.getByRole('button',{name:'Delete account',exact:true}).click();
      assert.equal((await pending).status(),403);
      await context.close();
    }
    console.log('Auth verification compatibility passed at 320/390px');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1);});
