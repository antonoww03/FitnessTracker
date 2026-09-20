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
  await click(btn("Save settings"));
  assert.equal(id("app-root").dataset.theme, "light");
  assert(btn("Хранения"));
  assert.equal(id("tab-history").textContent.trim(), "История");
  await click(id("tab-dashboard"));
  assert(id("water-tracker").textContent.includes("3.5 L"));
  assert(
    d
      .getElementById("fittrack-preview-app")
      .textContent.includes("Въглехидрати"),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: saved meal/logging, editing, history filter, delete/undo, four progress charts, unsaved navigation guard, BG language, light theme, water target, programs, completed sets, rest timer, records, recipes and measurements.",
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
