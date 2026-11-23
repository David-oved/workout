/* workOut: טיפול ב-Push. נטען לתוך ה-Service Worker הראשי (importScripts). */
self.addEventListener('push', function (event) {
  event.waitUntil(showDue());
});

async function showDue() {
  var items = [];
  try {
    var cache = await caches.open('wo-push');
    var res = await cache.match('/cfg');
    var cfg = res ? await res.json() : null;
    if (cfg && cfg.url && cfg.id) {
      var r = await fetch(cfg.url + '/pending?e=' + encodeURIComponent(cfg.id), { cache: 'no-store' });
      var j = await r.json();
      items = Array.isArray(j.items) ? j.items : [];
    }
  } catch (e) { /* ממשיכים להתראה כללית */ }
  // iOS דורש להציג התראה על כל Push, גם אם לא הצלחנו להביא טקסט
  if (!items.length) items = [{ title: 'workOut', body: 'יש לך תזכורת' }];
  await Promise.all(items.slice(0, 3).map(function (i) {
    return self.registration.showNotification(i.title || 'workOut', {
      body: i.body || '',
      tag: i.id || undefined,
      lang: 'he',
      dir: 'rtl',
      icon: 'icon-192.png',
      data: { url: self.registration.scope },
    });
  }));
}

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) if ('focus' in list[i]) return list[i].focus();
      return self.clients.openWindow(url);
    }),
  );
});
