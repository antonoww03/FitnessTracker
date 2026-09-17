/* Run only against a local disposable database. Starts from the dashboard and exercises real API calls. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseURL = process.env.FITTRACK_E2E_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) throw new Error('E2E tests require a local disposable instance.');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: 'UTC' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const waitFor = async (check, message) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await check()) return;
      await page.waitForTimeout(50);
    }
    throw new Error(message);
  };
  const saveResponse = (path, method = 'POST') => page.waitForResponse(response => new URL(response.url()).pathname === `/api/${path}` && response.request().method() === method && response.ok());
  try {
    await page.goto(baseURL);
    await page.getByTestId('food-entry').waitFor();
    await page.getByTestId('date-picker-trigger').click();
    assert.equal(await page.getByRole('grid').count(), 1, 'Calendar must open without a runtime error');
    await page.keyboard.press('Escape');
    // A real browser flow uses today's date; remove only the exact records created below on completion.
    const marker = `E2E meal ${Date.now()}`;
    const initial = await (await page.request.get(`${baseURL}/api/summary?date=${new Date().toISOString().slice(0,10)}`)).json();
    const meal = page.getByTestId('food-entry');
    await meal.getByTestId('food-description-input').fill(marker);
    await meal.getByRole('button', { name: 'Enter nutrition manually' }).click();
    for (const [key, value] of Object.entries({ calories: 300, protein: 20, fat: 10, carbs: 30, sugar: 2, fiber: 5 })) {
      await meal.getByRole('spinbutton', { name: key, exact: true }).fill(String(value));
    }
    const foodSaved = saveResponse('food');
    await meal.getByTestId('confirm-food-button').click();
    const food = await (await foodSaved).json();
    await page.getByRole('button', { name: `Delete ${marker}` }).waitFor();
    assert.equal(food.calories, 300);
    await page.getByTestId('training-type-select').click();
    await page.getByRole('option', { name: 'Strength', exact: true }).click();
    await page.getByTestId('training-duration-input').fill('45');
    const trainingSaved = saveResponse('training');
    await page.getByTestId('log-training-button').click();
    const training = await (await trainingSaved).json();
    await page.getByRole('button', { name: 'Delete Strength', exact: true }).first().waitFor();
    await page.getByTestId('food-description-input').fill('unsaved draft');
    const waterSaved = saveResponse('water');
    await page.getByTestId('water-tracker').getByRole('button', { name: '+500 ml', exact: true }).click();
    const water = await (await waterSaved).json();
    await waitFor(async () => (await page.getByTestId('water-streak').innerText()).startsWith('1 ') || !(await page.getByTestId('water-streak').innerText()).startsWith('0 '), 'Water streak did not refresh');
    assert.equal(await page.getByTestId('food-description-input').inputValue(), 'unsaved draft', 'Refreshing water must preserve food drafts');
    await page.getByTestId('weight-input').fill('74.5');
    const weightSaved = saveResponse('weight');
    await page.getByTestId('save-weight-button').click(); await weightSaved;
    await waitFor(async () => (await page.getByTestId('current-weight-display').innerText()).includes('74.5'), 'Weight did not refresh');
    await page.getByTestId('open-goals-button').click();
    await page.getByTestId('goal-input-calories').fill('2800');
    await page.getByTestId('goal-input-sugar').fill('0');
    const goalsSaved = saveResponse('goals', 'PUT');
    await page.getByTestId('save-goals-button').click(); await goalsSaved;
    await page.getByTestId('daily-goals-dialog').waitFor({ state: 'hidden' });
    await page.getByTestId('generate-tips-button').click();
    await page.getByTestId('coach-tips-list').waitFor();
    assert.match(await page.getByTestId('coach-tips-list').innerText(), /2800/);
    const reportSaved = saveResponse('reports/save');
    await page.getByRole('button', { name: 'Save Day' }).click(); await reportSaved;
    await page.getByTestId('tab-reports').click();
    await page.getByRole('button', { name: `Delete report ${food.date}` }).waitFor();
    for (const format of ['CSV', 'PDF']) {
      const downloaded = page.waitForEvent('download');
      await page.getByRole('button', { name: `Export ${format}` }).click();
      assert.ok((await downloaded).suggestedFilename().endsWith(format.toLowerCase()));
    }
    await page.getByLabel('Report period').selectOption('week');
    await page.getByRole('button', { name: `Delete report ${food.date}` }).waitFor();
    await page.getByTestId('tab-dashboard').click();
    await page.getByTestId('next-day-button').click();
    await page.getByTestId('food-entry').waitFor();
    await waitFor(async () => (await page.getByRole('button', { name: `Delete ${marker}` }).count()) === 0, 'Old day data persisted after navigation');
    await page.getByTestId('prev-day-button').click();
    await page.getByRole('button', { name: `Delete ${marker}` }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: `Delete ${marker}` }).waitFor();
    await page.getByRole('button', { name: `Delete ${marker}` }).click();
    await page.getByRole('button', { name: `Delete ${marker}` }).waitFor({ state: 'hidden' });
    // Force an API failure to verify explicit error state and Retry recovery.
    await page.route('**/api/summary?*', route => route.fulfill({ status: 500, body: '{}' }));
    await page.getByTestId('next-day-button').click();
    await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
    await page.unroute('**/api/summary?*');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByTestId('food-entry').waitFor();
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}px`);
    }
    await page.request.delete(`${baseURL}/api/training/${training.id}`);
    await page.request.delete(`${baseURL}/api/water/${water.id}`);
    await page.request.delete(`${baseURL}/api/weight/${food.date}`);
    await page.request.delete(`${baseURL}/api/reports/${food.date}`);
    await page.request.put(`${baseURL}/api/goals`, { data: initial.goals });
    assert.deepEqual(errors, [], 'Browser runtime errors');
    console.log('PASS: calendar, manual food, training, water refresh/streak, draft preservation, weight, goals including zero, daily review, saved reports, CSV/PDF, date navigation, reload persistence, delete, error/retry, 390/768/1280px layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
