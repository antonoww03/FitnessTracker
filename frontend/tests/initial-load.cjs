// Read-only measurement. No credentials, screenshots, bodies or full request URLs recorded.
const {chromium} = require('playwright');
const origin = process.env.FITTRACK_E2E_URL || 'http://127.0.0.1:8000';
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const context = await browser.newContext(); // Empty browser cache/storage, real SW behavior.
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', () => errors.push('javascript'));
    await page.addInitScript(() => {
      window.__fittrackPaints = [];
      try { new PerformanceObserver(list => window.__fittrackPaints.push(...list.getEntries().map(e=>e.startTime))).observe({type:'largest-contentful-paint', buffered:true}); } catch {}
    });
    const started = Date.now();
    await page.goto(origin, {waitUntil:'domcontentloaded',timeout:100000});
    await page.getByRole('button',{name:'Sign in',exact:true}).waitFor({timeout:100000});
    const loginReadyMs = Date.now()-started;
    const result = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const resources = performance.getEntriesByType('resource');
      const auth = resources.find(r=>new URL(r.name).pathname==='/api/auth/me');
      return {dnsMs:nav.domainLookupEnd-nav.domainLookupStart,tlsMs:nav.secureConnectionStart?nav.connectEnd-nav.secureConnectionStart:0,ttfbMs:nav.responseStart-nav.requestStart,domReadyMs:nav.domContentLoadedEventEnd,firstContentfulPaintMs:performance.getEntriesByName('first-contentful-paint')[0]?.startTime??null,lcpObservedMs:window.__fittrackPaints.at(-1)??null,authMs:auth?.duration??null,authServerTiming:auth?.serverTiming.map(({name,duration})=>({name,duration}))??[],scriptTransferBytes:resources.filter(r=>r.initiatorType==='script').reduce((sum,r)=>sum+r.transferSize,0)};
    });
    if(errors.length) throw new Error('JavaScript error during initial loading');
    console.log(JSON.stringify({coldBrowser:true,backendColdStart:'not assumed',loginReadyMs,...result},null,2));
    await context.close();
  } finally { await browser.close(); }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
