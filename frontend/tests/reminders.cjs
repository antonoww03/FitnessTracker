const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ft-reminders-"));
const entry = path.join(temporary, "entry.js");
fs.writeFileSync(
  entry,
  `import axios from "${path.join(root, "node_modules/axios/index.js")}"; import * as reminders from "${path.join(root, "src/lib/reminders.js")}";
   window.pushRequests=[];
   axios.defaults.adapter=async config=>{ window.pushRequests.push(config); return {data: config.method==='get'?{enabled:true,public_key:'AQID'}:{ok:true},status:200,statusText:'OK',headers:{},config}; };
   window.testing=reminders;`,
);
execFileSync(
  "npx",
  [
    "--yes",
    "--package=esbuild@0.25.10",
    "esbuild",
    entry,
    "--bundle",
    '--define:process.env.REACT_APP_BACKEND_URL=""',
    `--outfile=${temporary}/bundle.js`,
  ],
  { cwd: root, stdio: "pipe" },
);
const shown = [];
const dom = new JSDOM("<div></div>", {
  url: "https://test.invalid",
  runScripts: "outside-only",
});
const w = dom.window;
Object.defineProperty(w, "Notification", {
  value: {
    permission: "granted",
    requestPermission: async () => "granted",
  },
});
Object.defineProperty(w.navigator, "serviceWorker", {
  value: {
    ready: Promise.resolve({
      showNotification: async (title, options) => shown.push({ title, options }),
      pushManager: {
        getSubscription: async () => null,
        subscribe: async (options) => ({
          endpoint: "https://push.example/test",
          toJSON: () => ({
            endpoint: "https://push.example/test",
            expirationTime: null,
            keys: { p256dh: "x".repeat(24), auth: "y".repeat(12) },
          }),
          unsubscribe: async () => true,
          options,
        }),
      },
    }),
  },
});
Object.defineProperty(w, "PushManager", { value: class PushManager {} });
w.eval(fs.readFileSync(path.join(temporary, "bundle.js"), "utf8"));
const api = w.testing;
(async () => {
  const settings = {
    water: { enabled: true, everyMinutes: 120, start: "08:00", end: "22:00" },
    workout: { enabled: true, time: "08:00" },
    weighIn: { enabled: true, time: "08:00" },
  };
  assert(api.saveReminders("alice", settings));
  assert.deepEqual(JSON.parse(JSON.stringify(api.loadReminders("alice"))), settings);
  const atEight = new w.Date(2026, 8, 21, 8, 0, 0);
  await api.checkReminders("alice", atEight);
  assert.equal(shown.length, 3);
  assert(shown.every((item) => item.options.icon === "/icon-192.png"));
  await api.checkReminders("alice", atEight);
  assert.equal(shown.length, 3, "Same reminder slot is sent only once");
  await api.checkReminders("alice", new w.Date(2026, 8, 21, 10, 0, 0));
  assert.equal(shown.length, 4, "Next water interval is sent");
  assert.equal(await api.requestNotificationPermission(), "granted");
  assert.equal(await api.syncBackgroundPush(settings), "enabled");
  assert.equal(w.pushRequests.length, 2);
  assert(JSON.parse(w.pushRequests[1].data).timezone);
  console.log(
    "PASS: reminder settings, permission, schedules and duplicate prevention.",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    dom.window.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  });
