/* workOut: טיפול ב-Push. נטען לתוך ה-Service Worker הראשי (importScripts). */
self.addEventListener('push', function (event) {
  event.waitUntil(showDue());
});

function p2(n) { return (n < 10 ? '0' : '') + n; }
function num(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

/** קורא את מצב האפליקציה מ-IndexedDB (אותו מקום שבו האפליקציה שומרת), כדי שהמספרים בהתראה יהיו של הרגע הזה */
function readState() {
  return new Promise(function (resolve, reject) {
    var rq = indexedDB.open('keyval-store');
    rq.onerror = function () { reject(rq.error); };
    rq.onsuccess = function () {
      try {
        var db = rq.result;
        var g = db.transaction('keyval', 'readonly').objectStore('keyval').get('workout:state');
        g.onsuccess = function () { db.close(); resolve(g.result); };
        g.onerror = function () { reject(g.error); };
      } catch (e) { reject(e); }
    };
  });
}

/** "מצב היום": כמה אכלת וכמה נשאר, לפי אותה לוגיקה כמו במסך היום */
function computeStatus(s, now) {
  var reset = (s.settings && s.settings.resetHour) || 0;
  var d = new Date((now || Date.now()) - reset * 3600000);
  var today = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  var dw = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getDay();
  var place = (s.settings.places && s.settings.places[dw]) || 'home';
  var training = (s.workouts || []).some(function (w) { return w.date === today && w.status !== 'skipped'; });
  var t = s.settings.targets[place + '-' + (training ? 'train' : 'rest')];
  var e = { k: 0, p: 0, c: 0, f: 0 };
  (s.entries || []).forEach(function (x) { if (x.date === today) { e.k += x.k; e.p += x.p; e.c += x.c; e.f += x.f; } });
  var left = t.k - e.k;
  var pLeft = t.p - e.p;
  var title = left >= 0 ? 'נשארו ' + num(left) + ' קל׳ להיום' : 'עברת את היעד ב-' + num(-left) + ' קל׳';
  var body = 'אכלת ' + num(e.k) + ' מתוך ' + num(t.k) + ' · חלבון ' + num(e.p) + '/' + num(t.p) + ' ג׳' + (pLeft > 15 ? ' (חסרים ' + num(pLeft) + ')' : '');
  if (e.k === 0) { title = 'עוד לא רשמת כלום היום'; body = 'יעד היום: ' + num(t.k) + ' קל׳ ו-' + num(t.p) + ' ג׳ חלבון'; }
  return { title: title, body: body };
}

/** "סיכום היום": המספרים של היום ומצב האימון. הסיכום המלא מה-AI נפתח בלחיצה */
function computeSummary(s, now) {
  var reset = (s.settings && s.settings.resetHour) || 0;
  var d = new Date((now || Date.now()) - reset * 3600000);
  var today = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  var c = computeStatus(s, now);
  var planned = (s.workouts || []).filter(function (w) { return w.date === today && w.status !== 'skipped'; });
  var tr = planned.length ? (planned.every(function (w) { return w.status === 'done'; }) ? 'אימון: בוצע' : 'אימון: לא סומן') : 'יום מנוחה';
  return { title: 'סיכום היום · ' + c.title, body: c.body.split(' · חלבון')[0] + ' · ' + tr + '. לחץ לסיכום מה-AI' };
}

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
  var state = null;
  if (items.some(function (i) { return i.kind === 'status' || i.kind === 'summary'; })) {
    try { state = await readState(); } catch (e) { state = null; }
  }
  items = items.map(function (i) {
    if (i.kind !== 'status' && i.kind !== 'summary') return i;
    var sm = i.kind === 'summary';
    if (state && state.settings) { try { var c = sm ? computeSummary(state) : computeStatus(state); return { id: i.id, title: c.title, body: c.body, kind: i.kind }; } catch (e) { /* נופלים לברירת מחדל */ } }
    return { id: i.id, title: sm ? 'סיכום היום' : 'מצב היום', body: sm ? 'לחץ לסיכום מה-AI' : 'פתח את האפליקציה לראות כמה נשאר', kind: i.kind };
  });
  // iOS דורש להציג התראה על כל Push, גם אם לא הצלחנו להביא טקסט
  if (!items.length) items = [{ title: 'workOut', body: 'יש לך תזכורת' }];
  await Promise.all(items.slice(0, 3).map(function (i) {
    return self.registration.showNotification(i.title || 'workOut', {
      body: i.body || '',
      tag: i.id || undefined,
      lang: 'he',
      dir: 'rtl',
      icon: 'icon-192.png',
      data: { url: self.registration.scope + (i.kind === 'summary' ? '?summary=1' : ''), summary: i.kind === 'summary' },
    });
  }));
}

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var url = data.url || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) if ('focus' in list[i]) { if (data.summary) list[i].postMessage({ summary: true }); return list[i].focus(); }
      return self.clients.openWindow(url);
    }),
  );
});
