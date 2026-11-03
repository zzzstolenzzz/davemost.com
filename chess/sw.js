// Push notifications only: no caching, no offline logic.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data.json(); } catch { /* use the fallback text */ }
  event.waitUntil(self.registration.showNotification(data.title || "Doodle Chess", {
    body: data.body || "Your move in Doodle Chess!",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: "doodle-chess",
    renotify: true,
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).pathname.startsWith("/chess/"));
    return open ? open.focus() : self.clients.openWindow("/chess/");
  }));
});
