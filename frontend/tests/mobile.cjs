/* Disposable local application only. Chromium emulation does not certify physical iOS/Android behavior. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const base = process.env.FITTRACK_E2E_URL || "http://127.0.0.1:8000";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Use a disposable local app");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  page.setDefaultTimeout(15000);
  const today = new Date().toISOString().slice(0, 10),
    password = "mobile-test-password-123";
  fs.mkdirSync(path.join(__dirname, "../test-artifacts"), { recursive: true });
  async function fits() {
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Page overflows the viewport",
    );
  }
  try {
    const registered = await context.request.post(base + "/api/auth/register", {
      headers: { "X-Requested-With": "FitTrack" },
      data: { username: "mobile-" + Date.now(), password },
    });
    assert(registered.ok());
    await page.goto(base);
    await page.getByTestId("macros-dashboard").waitFor();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await fits();
      await page.getByTestId("tool-calendar").click();
      await page.getByTestId("training-calendar").waitFor();
      await fits();
      await page.getByTestId("tab-dashboard").click();
      await page.screenshot({
        path: path.join(__dirname, `../test-artifacts/today-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 390, height: 420 });
    await page.getByTestId("quick-add").click();
    await page
      .getByTestId("food-description-input")
      .fill("draft while keyboard is open");
    await fits();
    await page
      .getByRole("button", { name: "Close entry form", exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("tool-settings").click();
    await page.getByLabel("Enable offline on this device").check();
    await page.getByTestId("tab-dashboard").click();
    await page.getByTestId("macros-dashboard").waitFor();
    // Wait for authenticated API responses to reach the explicit local cache.
    await page.waitForFunction(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open("fittrack-offline-v1");
          r.onsuccess = () => {
            const db = r.result;
            const q = db.transaction("items").objectStore("items").getAll();
            q.onsuccess = () => {
              const has = q.result.some((x) =>
                x.key.includes(":cache:/api/summary"),
              );
              db.close();
              resolve(has);
            };
          };
        }),
    );
    await context.setOffline(true);
    await page.reload();
    await page.getByTestId("macros-dashboard").waitFor();
    await page
      .getByTestId("water-tracker")
      .getByRole("button", { name: "+500 ml", exact: true })
      .click();
    await page
      .getByTestId("sync-status")
      .getByText(/1 pending entries/)
      .waitFor();
    await context.setOffline(false);
    await page.waitForFunction(
      () =>
        !document
          .querySelector('[data-testid="sync-status"]')
          .textContent.includes("pending entries"),
    );
    const water = await context.request.get(`${base}/api/water?date=${today}`);
    assert.equal(
      (await water.json()).length,
      1,
      "Offline retry must create one record",
    );
    assert.equal(
      (await context.request.get(base + "/manifest.json")).status(),
      200,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: responsive widths, short viewport, service worker, offline reload and one-time sync.",
    );
  } catch(error) {
    await page.screenshot({path:path.join(__dirname,'../test-artifacts/failure.png'),fullPage:true});
    console.log('Mobile failure layout',await page.evaluate(()=>{const e=[...document.querySelectorAll('label')].find(x=>x.textContent.includes('Enable offline on this device'))?.querySelector('input');const r=e?.getBoundingClientRect();return {viewport:{width:innerWidth,height:innerHeight,visual:visualViewport?.height,offset:visualViewport?.offsetTop},target:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,hit:r?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,500):null}}));
    throw error;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
