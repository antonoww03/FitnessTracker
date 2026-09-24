const fs = require("fs"),
  assert = require("assert"),
  path = require("path"),
  os = require("os");
const { execFileSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "fittrack-test-"));
const bundle = path.join(temporary, "preview.js");
execFileSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "--yes",
    "--package=esbuild@0.25.10",
    "esbuild",
    "preview/index.jsx",
    "--bundle",
    "--loader:.js=jsx",
    "--alias:@=./src",
    '--define:process.env.NODE_ENV="production"',
    '--define:process.env.REACT_APP_BACKEND_URL=""',
    `--outfile=${bundle}`,
  ],
  { cwd: root, stdio: "pipe" },
);
const html =
  '<div id="fittrack-preview-app"></div><script>' +
  fs.readFileSync(bundle, "utf8").replace(/<\/script/gi, "<\\/script") +
  "</script>";
process.on("exit", () =>
  fs.rmSync(temporary, { recursive: true, force: true }),
);
const { JSDOM, VirtualConsole } = require("jsdom");
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => {
  if (!e.message.includes("Could not parse CSS")) errors.push(e.message);
});
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "https://preview.invalid",
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(w) {
    Object.defineProperty(w, "crypto", {
      value: require("node:crypto").webcrypto,
    });
    w.matchMedia = () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    });
    w.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    w.scrollTo = () => {};
    w.HTMLElement.prototype.scrollIntoView = function () {};
  },
});
const w = dom.window,
  d = w.document,
  wait = () => new Promise((r) => setTimeout(r, 90));
const id = (x) => d.querySelector(`[data-testid="${x}"]`),
  btn = (name, root = d) =>
    [...root.querySelectorAll("button")].find(
      (x) => x.textContent.trim() === name,
    );
async function click(el) {
  assert(el, "Click target exists");
  el.click();
  await wait();
}
async function input(el, value) {
  assert(el, "Input exists");
  const proto =
    el.tagName === "SELECT"
      ? w.HTMLSelectElement.prototype
      : el.tagName === "TEXTAREA"
        ? w.HTMLTextAreaElement.prototype
        : w.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new w.Event("input", { bubbles: true }));
  el.dispatchEvent(new w.Event("change", { bubbles: true }));
  await wait();
}
(async () => {
  await wait();
  await wait();
  assert(id("macros-dashboard"));
  await click(id("tool-profile"));
  assert(id("profile-page"));
  await input(d.querySelector('[name="first_name"]'), "Alex");
  await input(d.querySelector('[name="weight_kg"]'), "78.5");
  await click(btn("Save profile"));
  await click(id("tab-dashboard"));
  await click(id("tool-profile"));
  assert.equal(d.querySelector('[name="first_name"]').value, "Alex");
  assert.equal(d.querySelector('[name="weight_kg"]').value, "78.5");
  assert.equal(d.querySelectorAll('input[type="file"]').length, 1);
  await click(btn("Take a photo"));
  assert(id("profile-camera"));
  assert(d.querySelector('[role="alert"]').textContent.includes("Camera is unavailable"));
  assert(btn("Capture photo").disabled);
  await click(btn("Close camera"));
  assert(!id("profile-camera"));
  await click(btn("Meals"));
  const check = d.querySelector("input[type=checkbox]");
  await click(check);
  await input(
    [...d.querySelectorAll("input")].find((x) => x.type === "text"),
    "Saved lunch",
  );
  await click(btn("Save"));
  assert(
    d
      .getElementById("fittrack-preview-app")
      .textContent.includes("Saved lunch"),
  );
  await click(btn("Log meal"));
  await click(id("tab-dashboard"));
  assert(id("macros-dashboard").textContent.includes("1,480"));
  await click(d.querySelector('[aria-label^="Edit Chicken"]'));
  const edit = id("edit-entry");
  assert(edit);
  await input(
    [...edit.querySelectorAll("label")]
      .find((x) => x.textContent === "calories")
      .querySelector("input"),
    "500",
  );
  await click(btn("Save", edit));
  assert(!id("edit-entry"));
  await click(id("tab-history"));
  await input(d.querySelector("select"), "water");
  assert(
    d.getElementById("fittrack-preview-app").textContent.includes("1500 ml"),
  );
  await click(btn("Delete"));
  assert(
    !d.getElementById("fittrack-preview-app").textContent.includes("1500 ml"),
  );
  await click(btn("Undo"));
  assert(
    d.getElementById("fittrack-preview-app").textContent.includes("1500 ml"),
  );
  await click(btn("Progress"));
  assert.equal(d.querySelectorAll(".ft-chart").length, 4);
  assert(!d.getElementById("fittrack-preview-app").textContent.includes("NaN"));
  await click(id("tab-dashboard"));
  await click(id("add-entry-button"));
  const barcode = id("barcode-scanner");
  await input(barcode.querySelector('input[aria-label="Barcode"]'), "3800014268048");
  await click(btn("Find", barcode));
  assert(id("food-analysis-result").textContent.includes("Demo protein pudding"));
  await input(id("food-description-input"), "draft");
  w.confirm = () => false;
  await click(id("tab-history"));
  assert(id("food-entry"), "Draft navigation blocked");
  w.confirm = () => true;
  await click(d.querySelector('[aria-label="Close entry form"]'));
  await click(id("tab-training"));
  await click(btn("Start workout"));
  assert(id("active-workout"));
  await click(btn("Done", id("active-workout")));
  assert(id("active-workout").textContent.includes("Skip rest"));
  await click(btn("Finish workout"));
  assert(!id("active-workout"));
  assert(
    d.getElementById("fittrack-preview-app").textContent.includes("400 kg"),
  );
  await click(btn("New program"));
  const programForm = d.querySelector("form");
  await input(programForm.querySelector("input"), "Leg day");
  await input(programForm.querySelector(".ft-exercise-plan input"), "Squat");
  await click(btn("Save", programForm));
  assert(
    d.getElementById("fittrack-preview-app").textContent.includes("Leg day"),
  );
  await click(btn("Start workout"));
  await click(btn("Add exercise during workout"));
  const during = d.querySelector('[data-testid="active-workout"] form');
  await input(during.querySelector("input"), "Cable curl");
  await click(btn("Add to workout", during));
  assert.equal(id("active-workout").querySelectorAll(".ft-set-row").length, 12);
  const setRows = id("active-workout").querySelectorAll(".ft-set-row");
  await click(setRows[0].querySelector("input[type=checkbox]"));
  const groupInput = (row) =>
    [...row.querySelectorAll("label")]
      .find((x) => x.textContent === "Superset group")
      .querySelector("input");
  await input(groupInput(setRows[0]), "A");
  await input(groupInput(setRows[3]), "A");
  await input(
    [...setRows[3].querySelectorAll("label")]
      .find((x) => x.textContent === "Set notes")
      .querySelector("input"),
    "Controlled",
  );
  await click(btn("Done", setRows[0]));
  assert(
    !btn("Skip rest", id("active-workout")),
    "Paired round has no intermediate rest",
  );
  await click(btn("Done", setRows[3]));
  assert(
    btn("Skip rest", id("active-workout")),
    "Rest follows the paired round",
  );
  await click(btn("Finish workout"));
  assert(id("exercise-progress"));
  assert.equal(id("exercise-progress").querySelectorAll(".ft-chart").length, 3);
  await click(btn("Meals"));
  const quick = id("quick-foods");
  await click(btn("Favorite", quick));
  assert(btn("Remove favorite", quick));
  await input(quick.querySelector("select"), "lunch");
  await click(btn("Log portion", quick));
  await click(id("tab-dashboard"));
  assert(id("activity-feed").textContent.includes("lunch"));
  await click(btn("Copy food", id("activity-feed")));
  await click(btn("Copy portion", id("activity-feed")));
  assert(!btn("Copy portion", id("activity-feed")));
  await click(btn("Calendar"));
  assert.equal(
    id("training-calendar").querySelectorAll(".ft-calendar-grid button").length,
    42,
  );
  assert(id("training-calendar").textContent.includes("Weekly comparison"));
  assert(id("sync-status").textContent.includes("Last updated"));
  await click(btn("Recipes"));
  await click(btn("New recipe"));
  const recipeForm = d.querySelector("form");
  const recipeInputs = recipeForm.querySelectorAll("input");
  await input(recipeInputs[0], "Oats");
  await input(recipeInputs[1], "2");
  await input(recipeInputs[2], "Rolled oats");
  await input(recipeInputs[4], "380");
  await click(btn("Save", recipeForm));
  assert(
    d.getElementById("fittrack-preview-app").textContent.includes("190 kcal"),
  );
  await click(btn("Log meal"));
  await click(btn("Body"));
  await input(d.querySelector("input[type=number]"), "82");
  await click(btn("Save"));
  assert(d.querySelector(".ft-chart"));
  assert(d.getElementById("fittrack-preview-app").textContent.includes("82"));
  await click(btn("Settings"));
  const selects = d.querySelectorAll("select");
  await input(selects[0], "bg");
  await input(selects[1], "light");
  await input(d.querySelector("input[type=number]"), "3500");
  await click(
    [...d.querySelectorAll("fieldset label")]
      .find((x) => x.textContent === "Weight")
      .querySelector("input"),
  );
  await click(btn("Save settings"));
  assert.equal(id("app-root").dataset.theme, "light");
  assert(btn("Хранения"));
  assert.equal(id("tab-history").textContent.trim(), "История");
  await click(id("tab-dashboard"));
  assert(id("water-tracker").textContent.includes("3.5 L"));
  assert(!id("weight-summary"), "Hidden section stays hidden");
  assert(
    d
      .getElementById("fittrack-preview-app")
      .textContent.includes("Въглехидрати"),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: saved meal/logging, barcode lookup, editing, history filter, delete/undo, four progress charts, unsaved navigation guard, BG language, light theme, water target, programs, completed sets, rest timer, records, recipes, measurements, warm-ups, supersets, set notes, exercise charts, favorites, portion copying, calendar, sync status and dashboard visibility.",
  );
  dom.window.close();
})().catch((e) => {
  console.error(e);
  console.error(
    d.getElementById("fittrack-preview-app").textContent.slice(-1800),
  );
  dom.window.close();
  process.exitCode = 1;
});
