/* Daily reminder notifications ("Izzy's birthday is in 1 week").

   Runs once a day on GitHub Actions (.github/workflows/reminders.yml), free --
   no Firebase Blaze plan needed. It reads everyone's dates with a Firebase
   service account (saved as the FIREBASE_SERVICE_ACCOUNT repo secret) and sends
   phone notifications through Firebase Cloud Messaging.

   Each person picks how far ahead they want reminding (Settings -> Reminders:
   3 weeks, 2 weeks, 1 week, 3 days, day before). A holiday is one reminder
   ("Christmas is in 3 weeks"), not one per person. You're never reminded of
   your own dates.

   Try it without sending anything:  DRY_RUN=1 node reminders/send.js */

const admin = require('firebase-admin');
const Dates = require('../dates.js');

const DRY = !!process.env.DRY_RUN;
const APP_URL = (process.env.APP_URL || 'https://glaynebrown.github.io/wishwell/').replace(/\/?$/, '/');

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();

const WORDS = { 21: 'in 3 weeks', 14: 'in 2 weeks', 7: 'in 1 week', 3: 'in 3 days', 1: 'tomorrow' };

async function main() {
  const [usersSnap, groupsSnap, linksSnap] = await Promise.all([
    db.collection('users').get(), db.collection('groups').get(), db.collection('links').get(),
  ]);
  const users = {};
  usersSnap.forEach(d => { users[d.id] = d.data(); });

  // Who each person is connected to (family groups + one-to-one links).
  const circle = {};
  const connect = (a, b) => { if (a !== b && users[a] && users[b]) { (circle[a] = circle[a] || new Set()).add(b); } };
  groupsSnap.forEach(g => {
    const m = g.get('members') || [];
    // only count people whose profile still lists the group (same as the rules)
    const live = m.filter(u => users[u] && (users[u].groups || []).includes(g.id));
    for (const a of live) for (const b of live) connect(a, b);
  });
  linksSnap.forEach(l => { const [a, b] = l.get('users') || []; connect(a, b); connect(b, a); });

  let sent = 0;
  for (const [uid, me] of Object.entries(users)) {
    const remind = me.remind || [];
    if (!remind.length || !circle[uid]) continue;

    const hits = [];
    const holidays = {};
    for (const other of circle[uid]) {
      const p = users[other];
      for (const ev of Dates.events(p, undefined, uid)) {
        if (!remind.includes(ev.days)) continue;
        if (ev.kind === 'holiday') (holidays[ev.key] = holidays[ev.key] || { ev, who: [] }).who.push(p.name);
        else hits.push({ days: ev.days, text: ev.turning ? `${p.name} turns ${ev.turning} ${WORDS[ev.days] || Dates.inWords(ev.days)}` : `${Dates.title(ev, p.name)} is ${WORDS[ev.days] || Dates.inWords(ev.days)}`, url: APP_URL + '#/p/' + other });
      }
    }
    for (const h of Object.values(holidays)) {
      hits.push({ days: h.ev.days, text: `${h.ev.name} is ${WORDS[h.ev.days] || Dates.inWords(h.ev.days)}`, url: APP_URL + '#/people' });
    }
    if (!hits.length) continue;
    hits.sort((a, b) => a.days - b.days);

    const title = hits.length === 1 ? '🎁 ' + hits[0].text : '🎁 Coming up';
    const body = hits.length === 1 ? 'Tap to see their wish list.' : hits.map(h => h.text).join('\n');
    const url = hits.length === 1 ? hits[0].url : APP_URL + '#/people';

    const push = await db.collection('users').doc(uid).collection('private').doc('push').get();
    const tokens = (push.exists && push.get('tokens')) || [];
    if (DRY) { console.log(`[dry run] ${me.name} (${tokens.length} device${tokens.length === 1 ? '' : 's'}): ${title} | ${body.replace(/\n/g, ' / ')}`); continue; }

    const dead = [];
    for (const token of tokens) {
      try {
        await admin.messaging().send({
          token,
          webpush: { headers: { Urgency: 'normal', TTL: String(60 * 60 * 20) }, data: { title, body, url, tag: 'ww-' + new Date().toISOString().slice(0, 10) } },
        });
        sent++;
      } catch (e) {
        const code = (e && e.errorInfo && e.errorInfo.code) || e.code || '';
        if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) dead.push(token);
        else console.warn('send failed', me.name, code || e.message);
      }
    }
    if (dead.length) await push.ref.update({ tokens: admin.firestore.FieldValue.arrayRemove(...dead) });
  }
  console.log(`Done. ${sent} notification${sent === 1 ? '' : 's'} sent.`);
}

main().catch(e => { console.error(e); process.exit(1); });
