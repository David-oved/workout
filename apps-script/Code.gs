/**
 * workOut ↔ Google Calendar bridge
 * רץ בחשבון Google שלך (Execute as: Me). האפליקציה קוראת ממנו אירועים וכותבת אליו אימונים.
 * המפתח למטה (KEY) נוצר באפליקציה ומוטמע אוטומטית כשמעתיקים את הקוד משם.
 *
 * - action=ping    בדיקת חיבור
 * - action=events  אירועים מכל היומנים שלך בטווח תאריכים (קריאה בלבד)
 * - action=sync    יוצר/מעדכן/מוחק אימונים ביומן ייעודי בשם "workOut" (לא נוגע באירועים אחרים)
 */
const KEY = '__KEY__';
const CAL_NAME = 'workOut';
const TAG = 'wid';

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function fmt(d, allDay) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), allDay ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm");
}

function parse(date, time) {
  const a = date.split('-').map(Number);
  const b = time.split(':').map(Number);
  return new Date(a[0], a[1] - 1, a[2], b[0], b[1]);
}

function workoutCal() {
  const list = CalendarApp.getCalendarsByName(CAL_NAME);
  return list.length ? list[0] : CalendarApp.createCalendar(CAL_NAME);
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.key !== KEY) return out({ ok: false, error: 'unauthorized' });
  try {
    if (p.action === 'ping') {
      return out({
        ok: true,
        tz: Session.getScriptTimeZone(),
        calendars: CalendarApp.getAllCalendars().map(function (c) { return c.getName(); }),
      });
    }
    if (p.action === 'events') return out({ ok: true, events: readEvents(p.from, p.to) });
    return out({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (_) { return out({ ok: false, error: 'bad json' }); }
  if (b.key !== KEY) return out({ ok: false, error: 'unauthorized' });
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    if (b.action === 'sync') return out(syncWorkouts(b));
    return out({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (_) { /* ignore */ }
  }
}

function readEvents(from, to) {
  const start = parse(from, '00:00');
  const end = parse(to, '23:59');
  const res = [];
  CalendarApp.getAllCalendars().forEach(function (cal) {
    if (cal.getName() === CAL_NAME) return;
    cal.getEvents(start, end).forEach(function (ev) {
      if (ev.getMyStatus && ev.getMyStatus() === CalendarApp.GuestStatus.NO) return;
      const allDay = ev.isAllDayEvent();
      const endT = allDay ? new Date(ev.getEndTime().getTime() - 1) : ev.getEndTime();
      res.push({
        id: ev.getId(),
        title: ev.getTitle(),
        start: fmt(ev.getStartTime(), allDay),
        end: fmt(endT, allDay),
        allDay: allDay,
        cal: cal.getName(),
      });
    });
  });
  return res;
}

function syncWorkouts(b) {
  const cal = workoutCal();
  const from = parse(b.from, '00:00');
  const to = parse(b.to, '23:59');
  const existing = {};
  cal.getEvents(from, to).forEach(function (ev) {
    const id = ev.getTag(TAG);
    if (id) existing[id] = ev;
  });
  const wanted = {};
  let created = 0, updated = 0, removed = 0;
  const want = b.alertMin > 0 ? [b.alertMin] : [];

  (b.workouts || []).forEach(function (w) {
    if (w.status === 'skipped') return;
    wanted[w.id] = true;
    const s = parse(w.date, w.time);
    const e = new Date(s.getTime() + (w.durationMin || 90) * 60000);
    let ev = existing[w.id];
    if (!ev) {
      ev = cal.createEvent(w.title, s, e);
      ev.setTag(TAG, w.id);
      created++;
    } else {
      if (ev.getTitle() !== w.title) ev.setTitle(w.title);
      if (ev.getStartTime().getTime() !== s.getTime() || ev.getEndTime().getTime() !== e.getTime()) {
        ev.setTime(s, e);
        updated++;
      }
    }
    const cur = ev.getPopupReminders();
    if (cur.length !== want.length || (want.length && cur[0] !== want[0])) {
      ev.removeAllReminders();
      if (want.length) ev.addPopupReminder(want[0]);
    }
  });

  Object.keys(existing).forEach(function (id) {
    if (!wanted[id]) {
      existing[id].deleteEvent();
      removed++;
    }
  });
  return { ok: true, created: created, updated: updated, removed: removed };
}
