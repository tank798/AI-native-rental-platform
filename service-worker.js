const CACHE_NAME = "zhunaer-app-shell-v6";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./src/app.css",
  "./src/app.mjs",
  "./src/bear-agent.mjs",
  "./src/task-lifecycle.mjs",
  "./src/demand-parser.mjs",
  "./src/field-state.mjs",
  "./src/mandate-builder.mjs",
  "./src/supply-parser.mjs",
  "./src/marketplace-corpus.mjs",
  "./src/fixtures.mjs",
  "./src/simulation-engine.mjs",
  "./src/api-client.mjs",
  "./src/ui/safe-markup.mjs",
  "./assets/app-icon.svg",
  "./assets/bear-agent.svg",
  "./assets/bear-agent-anchor.png",
  "./assets/user-avatar.png",
  "./assets/media-placeholder.svg",
  "./assets/room-sunlit.jpg",
  "./assets/room-lanehouse.jpg",
  "./assets/room-compact.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith("/api/")) return;
  const allowedPaths = new Set(APP_SHELL.map((item) => new URL(item, self.location.origin).pathname));
  if (!allowedPaths.has(requestUrl.pathname)) return;
  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.destination === "image") return caches.match("./assets/media-placeholder.svg");
        return Response.error();
      })
  );
});
