/* Sample mode: the same calls as store.js, kept in this browser only, with a
   pretend family. Used when firebase-config.js hasn't been filled in, so the
   app can be tried (and previewed) without a database.

   It applies the same "who can see what" as firestore.rules, and Settings has
   a "View as" switch so you can check, for example, that Bella can't see what
   Izzy claimed on her list. */

const Demo = (() => {
  const KEY = 'ww-demo2';
  let db = null;
  let as = 'me';
  let cb = null;
  const clone = o => JSON.parse(JSON.stringify(o));
  const newId = () => Math.random().toString(36).slice(2, 10);
  const pairId = (a, b) => (a < b ? a + '_' + b : b + '_' + a);

  // Soft placeholder "photos" for the sample wishes.
  function pic(emoji, bg) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="${bg}"/><text x="60" y="62" font-size="56" text-anchor="middle" dominant-baseline="middle">${emoji}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function seed() {
    const now = Date.now();
    const md = days => { const d = new Date(now + days * 86400000); return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const it = (name, o) => ({ id: newId(), name, createdAt: now - Math.random() * 3e9, qty: 1, ...o });
    return {
      users: {
        me: { name: 'Bella', birthday: md(40), anniversary: '', holidays: ['christmas', 'valentines', 'mothers'], custom: [], remind: [21, 7], palette: 'sage', code: 'BELLA7', groups: ['fam1'] },
        mom: { name: 'Mom', birthday: md(25), holidays: ['christmas', 'mothers', 'easter'], custom: [], remind: [21, 7], code: 'MOM234', groups: ['fam1'] },
        dad: { name: 'Dad', birthday: md(95), anniversary: md(160), holidays: ['christmas', 'fathers'], custom: [], remind: [21, 7], code: 'DAD234', groups: ['fam1'] },
        izzy: { name: 'Izzy', birthday: md(9), holidays: ['christmas', 'valentines'], custom: [], remind: [21, 7], code: 'IZZY23', groups: ['fam1'] },
        jo: { name: 'Jo', birthday: md(58), holidays: ['christmas'], custom: [], remind: [7], code: 'JOJO45', groups: [] },
      },
      groups: { fam1: { name: 'Brown Family', code: 'BROWNFAM', members: ['me', 'mom', 'dad', 'izzy'] } },
      links: { [pairId('me', 'jo')]: { users: ['jo', 'me'].sort() } },
      codes: {
        BELLA7: { type: 'person', uid: 'me' }, MOM234: { type: 'person', uid: 'mom' }, DAD234: { type: 'person', uid: 'dad' },
        IZZY23: { type: 'person', uid: 'izzy' }, JOJO45: { type: 'person', uid: 'jo' }, BROWNFAM: { type: 'group', gid: 'fam1' },
      },
      items: {
        me: [
          it('Linen throw blanket', { price: 68, store: 'Anthropologie', notes: 'Sage or oatmeal color', star: true, photo: pic('🧺', '#E9E4D6'), link: 'https://www.anthropologie.com/' }),
          it('Fourth Wing special edition', { price: 34.99, store: 'Barnes & Noble', notes: 'Sprayed edges, hardcover', photo: pic('📚', '#E8DCCB') }),
          it('Stanley Quencher 40oz', { price: 45, store: 'Target', notes: 'Color: Rose Quartz', photo: pic('🥤', '#EADAD5'), star: true }),
          it('Fuzzy slipper socks', { price: 12, store: 'Target', notes: 'Size M', qty: 3, photo: pic('🧦', '#E2E7EC') }),
          it('Candle — "Fireside"', { price: 38, store: 'Bath & Body Works' }),
        ],
        mom: [
          it('Gardening gloves', { price: 22, store: 'Lowe’s', notes: 'Size S, anything floral', photo: pic('🧤', '#E3E8DA') }),
          it('Cashmere scarf', { price: 89, store: 'Nordstrom', notes: 'Camel or gray', star: true, photo: pic('🧣', '#ECE3D8') }),
          it('Hummingbird feeder', { price: 29, store: 'Amazon', photo: pic('🐦', '#DFE8EC') }),
        ],
        dad: [
          it('Smoked salt sampler', { price: 32, store: 'Etsy', photo: pic('🧂', '#ECE6DC') }),
          it('Fishing hat', { price: 25, store: 'REI', notes: 'L/XL', photo: pic('🎣', '#E2E8E1') }),
        ],
        izzy: [
          it('Lip Glowy Balm', { price: 18, store: 'Ulta', notes: 'Berry or Watermelon', star: true, photo: pic('💄', '#F1E0DE') }),
          it('Everywhere Belt Bag', { price: 38, store: 'Lululemon', notes: 'Black', photo: pic('👜', '#E6E1DA') }),
          it('Yoga mat strap', { price: 15, store: 'Amazon' }),
        ],
        jo: [
          it('Pottery class gift card', { price: 60, store: 'Clay Studio', star: true, photo: pic('🏺', '#EEDFD2') }),
          it('Houseplant (any!)', { price: 25, notes: 'Low light please', photo: pic('🪴', '#E0E9DC') }),
        ],
      },
      claims: {}, ideas: {}, received: { me: [] },
    };
  }

  function load() {
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db) {
      db = seed();
      // Izzy is getting Bella the Stanley; Bella is getting Mom the scarf;
      // Mom left a family-only idea on Dad's list.
      const stanley = db.items.me[2];
      db.claims.me = [{ id: stanley.id + '_izzy', ref: stanley.id, kind: 'item', by: 'izzy', byName: 'Izzy', name: stanley.name, price: stanley.price, at: Date.now() }];
      const socks = db.items.me[3];
      db.claims.me.push({ id: socks.id + '_mom', ref: socks.id, kind: 'item', by: 'mom', byName: 'Mom', name: socks.name, price: socks.price, at: Date.now() });
      const scarf = db.items.mom[1];
      db.claims.mom = [{ id: scarf.id + '_me', ref: scarf.id, kind: 'item', by: 'me', byName: 'Bella', name: scarf.name, price: scarf.price, at: Date.now() }];
      db.ideas.dad = [{ id: newId(), name: 'Weber grill', notes: 'He mentioned his old one is rusting out', price: 249, scope: 'fam1', by: 'mom', byName: 'Mom', at: Date.now() }];
      db.ideas.me = [{ id: newId(), name: 'Pottery wheel lessons', notes: 'Bella keeps watching pottery videos 👀', scope: 'fam1', by: 'izzy', byName: 'Izzy', at: Date.now() }];
      save();
    }
    try { as = localStorage.getItem(KEY + '-as') || 'me'; } catch (e) { as = 'me'; }
    if (!db.users[as]) as = 'me';
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('sample save failed', e); } }

  // Same visibility as firestore.rules.
  const groupsOf = u => (db.users[u] && db.users[u].groups) || [];
  const linked = (a, b) => !!db.links[pairId(a, b)];
  const canSee = owner => owner !== as && (linked(as, owner) || groupsOf(as).some(g => groupsOf(owner).includes(g)));
  const shared = (owner, scope) => groupsOf(as).includes(scope) && groupsOf(owner).includes(scope);

  function state() {
    const me = as;
    const groups = Object.entries(db.groups).filter(([, g]) => g.members.includes(me)).map(([id, g]) => ({ id, ...clone(g) }));
    const links = Object.entries(db.links).filter(([, l]) => l.users.includes(me)).map(([id, l]) => ({ id, ...clone(l) }));
    const S = { me, profile: clone(db.users[me]), loaded: true, groups, links, people: {}, items: { [me]: clone(db.items[me] || []) }, claims: {}, ideas: {}, received: clone(db.received[me] || []) };
    for (const p of Object.keys(db.users)) {
      if (!canSee(p)) continue;
      S.people[p] = { uid: p, ...clone(db.users[p]) };
      S.items[p] = clone(db.items[p] || []);
      S.claims[p] = clone(db.claims[p] || []);
      S.ideas[p] = clone((db.ideas[p] || []).filter(i => i.by === me || shared(p, i.scope)));
    }
    return S;
  }
  function emit() { save(); if (cb) { const s = state(); setTimeout(() => cb(s), 0); } }
  const ok = v => Promise.resolve(v);
  const fail = msg => Promise.reject(new Error(msg));
  const list = (col, u) => (db[col][u] = db[col][u] || []);
  function upsert(arr, obj) { const i = arr.findIndex(x => x.id === obj.id); if (i >= 0) arr[i] = obj; else arr.push(obj); }
  function keep(o) {
    const out = {};
    for (const k of ['name', 'link', 'price', 'photo', 'notes', 'store']) if (o[k] !== undefined && o[k] !== null && o[k] !== '') out[k] = o[k];
    return out;
  }
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const makeCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

  return {
    configured: true,
    sample: true,
    onUser(f) { load(); setTimeout(() => f({ uid: as, email: 'sample@wishwell.app', name: db.users[as].name }), 0); return () => {}; },
    signOut() { return ok(); },
    start(f) { load(); cb = f; emit(); },
    stop() { cb = null; },
    createProfile(p) { db.users[as] = { ...p, code: makeCode(), groups: [] }; emit(); return ok(); },
    saveProfile(patch) { Object.assign(db.users[as], clone(patch)); emit(); return ok(); },
    savePersonDates(other, d) { Object.assign(db.users[other], clone(d)); emit(); return ok(); },
    newPersonalCode(custom) {
      const code = custom ? custom.toUpperCase().replace(/[^A-Z0-9]/g, '') : makeCode();
      if (code.length < 3 || code.length > 20) return fail('Codes need 3 to 20 letters or numbers.');
      if (code === db.users[as].code) return ok(code);
      if (db.codes[code]) return fail('That code is already taken — try another.');
      delete db.codes[db.users[as].code];
      db.codes[code] = { type: 'person', uid: as };
      db.users[as].code = code;
      emit();
      return ok(code);
    },
    createGroup(name, custom) {
      const code = custom ? custom.toUpperCase().replace(/[^A-Z0-9]/g, '') : makeCode();
      if (code.length < 3 || code.length > 20) return fail('Codes need 3 to 20 letters or numbers.');
      if (db.codes[code]) return fail('That code is already taken — try another.');
      const gid = newId();
      db.groups[gid] = { name, code, members: [as] };
      db.codes[code] = { type: 'group', gid };
      db.users[as].groups.push(gid);
      emit();
      return ok(code);
    },
    renameGroup(gid, name) { db.groups[gid].name = name; emit(); return ok(); },
    changeGroupCode(gid, custom) {
      const g = db.groups[gid];
      const code = custom ? custom.toUpperCase().replace(/[^A-Z0-9]/g, '') : makeCode();
      if (code.length < 3 || code.length > 20) return fail('Codes need 3 to 20 letters or numbers.');
      if (code === g.code) return ok(code);
      if (db.codes[code]) return fail('That code is already taken — try another.');
      delete db.codes[g.code];
      db.codes[code] = { type: 'group', gid };
      g.code = code;
      emit();
      return ok(code);
    },
    join(raw) {
      const code = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const c = db.codes[code];
      if (!c) return fail('That code didn’t match anyone. Check it and try again.');
      if (c.type === 'person') {
        if (c.uid === as) return fail('That’s your own code — send it to someone else so they can link to you.');
        if (linked(as, c.uid)) return fail('You’re already linked with them.');
        db.links[pairId(as, c.uid)] = { users: [as, c.uid].sort() };
        emit();
        return ok({ type: 'person', uid: c.uid });
      }
      const g = db.groups[c.gid];
      if (g.members.includes(as)) return fail('You’re already in that group.');
      g.members.push(as);
      db.users[as].groups.push(c.gid);
      emit();
      return ok({ type: 'group', code });
    },
    leaveGroup(gid) {
      const g = db.groups[gid];
      g.members = g.members.filter(m => m !== as);
      if (!g.members.length) { delete db.codes[g.code]; delete db.groups[gid]; }
      db.users[as].groups = db.users[as].groups.filter(x => x !== gid);
      emit();
      return ok();
    },
    unlink(other) { delete db.links[pairId(as, other)]; emit(); return ok(); },
    saveItem(item) { const id = item.id || newId(); upsert(list('items', as), { ...clone(item), id }); emit(); return ok(id); },
    deleteItem(id) { db.items[as] = list('items', as).filter(x => x.id !== id); emit(); return ok(); },
    receiveItem(item) {
      list('received', as).push({ id: item.id, ...keep(item), fromUid: as, fromName: '', at: Date.now() });
      db.items[as] = list('items', as).filter(x => x.id !== item.id);
      emit();
      return ok();
    },
    deleteReceived(id) { db.received[as] = list('received', as).filter(x => x.id !== id); emit(); return ok(); },
    claim(owner, ref, kind, snap, byName) {
      upsert(list('claims', owner), { id: ref + '_' + as, ref, kind, by: as, byName, name: snap.name || '', price: snap.price || null, link: snap.link || '', at: Date.now() });
      emit();
      return ok();
    },
    setBought(owner, claimId, bought) { const c = list('claims', owner).find(x => x.id === claimId); if (c) c.bought = bought; emit(); return ok(); },
    unclaim(owner, claimId) { db.claims[owner] = list('claims', owner).filter(c => c.id !== claimId); emit(); return ok(); },
    given(owner, entry, kind, byName) {
      db.claims[owner] = list('claims', owner).filter(c => c.id !== entry.id + '_' + as);
      list('received', owner).push({ id: newId(), ...keep(entry), fromUid: as, fromName: byName, at: Date.now() });
      if (kind === 'idea') db.ideas[owner] = list('ideas', owner).filter(x => x.id !== entry.id);
      else {
        const it = list('items', owner).find(x => x.id === entry.id);
        if (it && (it.qty || 1) > 1) it.qty -= 1;
        else db.items[owner] = list('items', owner).filter(x => x.id !== entry.id);
      }
      emit();
      return ok();
    },
    saveIdea(owner, idea) { const id = idea.id || newId(); upsert(list('ideas', owner), { ...clone(idea), id }); emit(); return ok(id); },
    deleteIdea(owner, idea) { db.ideas[owner] = list('ideas', owner).filter(x => x.id !== idea.id); emit(); return ok(); },
    addToken() { return ok(); },
    removeToken() { return ok(); },
    deleteAccount() { return fail('Sample mode has no account to delete.'); },
    uid: () => as,
    // sample-only
    people: () => Object.entries(db.users).map(([uid, u]) => ({ uid, name: u.name })),
    viewAs(u) { try { localStorage.setItem(KEY + '-as', u); } catch (e) {} location.reload(); },
    reset() { try { localStorage.removeItem(KEY); localStorage.removeItem(KEY + '-as'); } catch (e) {} location.reload(); },
  };
})();
