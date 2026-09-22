/* Static app shell only. Personal API data is never stored by the service worker. */
const CACHE = "fittrack-shell-v6";
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const shell = await fetch("/", { cache: "reload" });
      if (!shell.ok) throw new Error("App shell unavailable");
      const html = await shell.clone().text();
      const assets = [
        ...html.matchAll(/(?:src|href)=["'](\/static\/[^"']+)["']/g),
      ].map((m) => m[1]);
      await cache.addAll([
        "/manifest.json",
        "/icon-192.png",
        "/icon-512.png",
        ...assets,
      ]);
      await cache.put("/", shell);
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("fittrack-shell-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api")
  )
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((r) => {
          if (r.ok) {
            const clone = r.clone();
            caches.open(CACHE).then((c) => c.put("/", clone));
          }
          return r;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }
  if (
    !url.pathname.startsWith("/static/") &&
    !["/manifest.json", "/icon-192.png", "/icon-512.png"].includes(url.pathname)
  )
    return;
  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ||
        fetch(event.request).then((r) => {
          if (r.ok) {
            const clone = r.clone();
            caches.open(CACHE).then((c) => c.put(event.request, clone));
          }
          return r;
        }),
    ),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        const existing = windows.find((client) => "focus" in client);
        if (existing) {
          await existing.navigate(url);
          return existing.focus();
        }
        return clients.openWindow(url);
      }),
  );
});
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    data = { body: event.data?.text() || "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "FitTrack", {
      body: data.body || "",
      tag: data.tag || "fittrack-reminder",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/" },
    }),
  );
});
