/* Birthdays, anniversaries and holidays -> "what's coming up and how soon".
   Used by the app and by the daily reminder script (reminders/send.js), so it
   works in the browser and in Node.

   A person's profile keeps dates as month-day only ("03-14"), no year:
     birthday, anniversary   'MM-DD' or ''
     holidays                ['christmas', 'mothers', ...]
     partner                 uid of the one person who sees anniversary + Valentine's
     custom                  [{ name: 'Graduation', md: '05-20' }] */

const Dates = (() => {
  const HOLIDAYS = [
    { key: 'christmas', name: 'Christmas', emoji: '🎄' },
    { key: 'valentines', name: 'Valentine’s Day', emoji: '💌' },
    { key: 'mothers', name: 'Mother’s Day', emoji: '💐' },
    { key: 'fathers', name: 'Father’s Day', emoji: '🌿' },
  ];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const SHORT = ['Jan', 'Feb', 'March', 'April', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function today() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  // Anonymous Gregorian algorithm
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  function nthSunday(y, m, n) {
    const first = new Date(y, m, 1);
    return new Date(y, m, 1 + ((7 - first.getDay()) % 7) + 7 * (n - 1));
  }
  function fromMD(md, y) {
    const [m, d] = md.split('-').map(Number);
    if (m === 2 && d === 29 && new Date(y, 1, 29).getMonth() !== 1) return new Date(y, 1, 28);
    return new Date(y, m - 1, d);
  }
  function holidayOn(key, y) {
    switch (key) {
      case 'christmas': return new Date(y, 11, 25);
      case 'valentines': return new Date(y, 1, 14);
      case 'easter': return easter(y);
      case 'mothers': return nthSunday(y, 4, 2);
      case 'fathers': return nthSunday(y, 5, 3);
    }
    return null;
  }
  // The next time (today or later) a yearly date comes around.
  function next(make, from) {
    const t = from || today();
    let d = make(t.getFullYear());
    if (d < t) d = make(t.getFullYear() + 1);
    return d;
  }
  const daysBetween = (a, b) => Math.round((b - a) / 86400000);

  // Partner-only occasions: shown to (and reminded for) only the person's partner.
  const PARTNER_ONLY = ['anniversary', 'valentines'];

  // Everything a person celebrates, soonest first, as seen by `viewer` (a uid):
  // [{ key, kind, name, emoji, date, days }]
  function events(p, from, viewer) {
    const t = from || today();
    const out = [];
    const add = (key, kind, name, emoji, make) => {
      const date = next(make, t);
      out.push({ key, kind, name, emoji, date, days: daysBetween(t, date) });
    };
    if (!p) return out;
    if (valid(p.birthday)) add('birthday', 'birthday', 'Birthday', '🎂', y => fromMD(p.birthday, y));
    if (valid(p.anniversary)) add('anniversary', 'anniversary', 'Anniversary', '💍', y => fromMD(p.anniversary, y));
    for (const h of HOLIDAYS) if ((p.holidays || []).includes(h.key)) add(h.key, 'holiday', h.name, h.emoji, y => holidayOn(h.key, y));
    (p.custom || []).forEach((c, i) => { if (c && c.name && valid(c.md)) add('custom' + i, 'custom', c.name, '✨', y => fromMD(c.md, y)); });
    const mine = viewer !== undefined && viewer === p.partner;
    return out.filter(e => !PARTNER_ONLY.includes(e.key) || mine).sort((a, b) => a.days - b.days);
  }
  const valid = md => typeof md === 'string' && /^\d{2}-\d{2}$/.test(md);

  function fmt(d, withDay) {
    return (withDay ? DAYS[d.getDay()] + ', ' : '') + SHORT[d.getMonth()] + ' ' + d.getDate();
  }
  function fmtMD(md) {
    if (!valid(md)) return '';
    const [m, d] = md.split('-').map(Number);
    return SHORT[m - 1] + ' ' + d;
  }
  function inWords(days) {
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days < 14) return 'in ' + days + ' days';
    if (days % 7 === 0 && days <= 56) return 'in ' + days / 7 + ' weeks';
    if (days < 60) return 'in ' + Math.round(days / 7) + ' weeks';
    return 'in ' + Math.round(days / 30.4) + ' months';
  }
  // "Izzy's birthday" / "Christmas" / "Mom & Dad's anniversary"
  function title(ev, name) {
    if (ev.kind === 'birthday' || ev.kind === 'anniversary') return possessive(name) + ' ' + ev.name.toLowerCase();
    if (ev.kind === 'custom') return possessive(name) + ' ' + ev.name;
    return ev.name;
  }
  const possessive = n => (/s$/i.test(n) ? n + '’' : n + '’s');

  return { HOLIDAYS, PARTNER_ONLY, MONTHS, SHORT, today, events, fmt, fmtMD, inWords, title, possessive, valid, daysBetween };
})();

if (typeof module !== 'undefined') module.exports = Dates;
