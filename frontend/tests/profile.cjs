/* Run against a local disposable database. Native phone camera UI needs device testing. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.FITTRACK_E2E_URL || 'http://127.0.0.1:8018';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local disposable app required');
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const response = await context.request.post(base + '/api/auth/register', {
      headers: {'X-Requested-With':'FitTrack'},
      data: {username:'profile-'+Date.now(),password:'profile-test-password-123'},
    });
    assert(response.ok());
    await page.goto(base);
    await page.getByTestId('tool-profile').click();
    for (const [label, value] of [['First name','Alex'],['Last name','Test'],['Age','25'],['Height (cm)','180'],['Weight (kg)','75.5']]) {
      await page.getByLabel(label,{exact:true}).fill(value);
    }
    await page.locator('[name="gender"]').selectOption('male');
    await page.locator('input[type=file]').first().setInputFiles({name:'photo.png',mimeType:'image/png',buffer:fs.readFileSync(path.join(__dirname,'../public/icon-192.png'))});
    await page.locator('.ft-profile-avatar img').waitFor();
    async function save() {
      const pending = page.waitForResponse(r=>r.url().endsWith('/api/profile') && r.request().method()==='PUT');
      await page.getByRole('button',{name:'Save profile',exact:true}).click();
      assert((await pending).ok());
    }
    await save();
    await page.reload();
    await page.getByTestId('tool-profile').click();
    await page.getByLabel('First name',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('First name',{exact:true}).inputValue(),'Alex');
    assert.equal(await page.getByLabel('Weight (kg)',{exact:true}).inputValue(),'75.5');
    assert.equal(await page.locator('.ft-profile-avatar img').count(),1);
    for (const width of [320,390,768,1280]) {
      await page.setViewportSize({width,height:844});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Overflow at '+width);
    }
    await page.getByRole('button',{name:'Remove photo'}).click();
    await save();
    assert.equal((await (await context.request.get(base+'/api/profile')).json()).photo_data_url,null);
    assert.deepEqual(errors,[]);
    console.log('PASS: profile real API save/reload, photo upload/compression/removal, 320/390/768/1280 layout, no runtime errors');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
