/* All database access lives here (and in demo.js, its stand-in for sample
   mode), so app.js only deals in plain objects.

   Firestore layout:
     users/{uid}                   profile: name, birthday, anniversary, holidays, custom,
                                   remind [days], palette, code (personal), groups [group codes]
     users/{uid}/items/{id}        their wishes (they and everyone linked to them can read)
     users/{uid}/claims/{ref_by}   "I'll get this" -- everyone linked EXCEPT the owner
     users/{uid}/circles/{c}/ideas/{id}
                                   gift ideas others added. c = a family group code (that
                                   group sees it) or 'u_' + adder's uid (just the adder).
                                   The idea's own scope field says the same: code or 'me'.
     users/{uid}/received/{id}     given/received history -- owner only
     users/{uid}/private/push      phone notification tokens -- owner only
     groups/{code}                 a family group: { name, members [uids] }
     codes/{code}                  { type: 'person', uid } or { type: 'group' }
     links/{uidA_uidB}             a one-to-one connection made with a personal code

   firestore.rules is what actually keeps the surprises hidden. */

const Store = (() => {
  const configured = typeof firebaseConfig !== 'undefined' && !/PASTE/.test(firebaseConfig.apiKey);
  if (!configured) return { configured: false };

  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const FV = firebase.firestore.FieldValue;
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

  const U = uid => db.collection('users').doc(uid);
  const uid = () => auth.currentUser && auth.currentUser.uid;
  const docs = s => s.docs.map(d => ({ id: d.id, ...d.data() }));
  const pairId = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
  const ideasCol = (owner, circle) => U(owner).collection('circles').doc(circle).collection('ideas');
  const circleOf = (idea, by) => (idea.scope && idea.scope !== 'me' ? idea.scope : 'u_' + (by || idea.by));

  // ---- account ----
  const onUser = cb => auth.onAuthStateChanged(u => cb(u ? { uid: u.uid, email: u.email, name: u.displayName || '' } : null));
  async function signUp(name, email, password) {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
    return cred.user;
  }
  const signIn = (email, password) => auth.signInWithEmailAndPassword(email, password);
  const reset = email => auth.sendPasswordResetEmail(email);
  const signOut = () => { stop(); return auth.signOut(); };

  // ---- live data ----
  // start(cb) keeps cb fed with one state object:
  //   { profile, groups, links, people {uid: profile}, items {uid: []}, claims {uid: []},
  //     ideas {uid: []}, received [] }
  let S = null;
  let subs = {};
  let emitT = null;
  let cb = null;
  let retryT = null;
  let fails = {};
  const emit = () => { clearTimeout(emitT); emitT = setTimeout(() => cb && cb(S), 20); };

  function listen(key, ref, fn) {
    if (subs[key]) return;
    subs[key] = ref.onSnapshot(s => { delete fails[key]; fn(s); }, e => {
      // Usually a connection that was just removed (or not readable yet).
      console.warn('listen', key, e.code);
      delete subs[key];
      fn(null);
      fails[key] = (fails[key] || 0) + 1;
      if (fails[key] <= 3) { clearTimeout(retryT); retryT = setTimeout(sync, 4000 * fails[key]); }
    });
  }
  function drop(key) { if (subs[key]) { subs[key](); delete subs[key]; } }

  function start(onState) {
    stop();
    cb = onState;
    const me = uid();
    S = { me, profile: null, loaded: false, groups: [], links: [], people: {}, items: {}, claims: {}, ideas: {}, received: [], _ideas: {} };
    listen('me', U(me), s => { S.profile = s && s.exists ? s.data() : null; S.loaded = true; sync(); emit(); });
    listen('myItems', U(me).collection('items'), s => { S.items[me] = s ? docs(s) : []; emit(); });
    listen('received', U(me).collection('received'), s => { S.received = s ? docs(s) : []; emit(); });
    listen('groups', db.collection('groups').where('members', 'array-contains', me), s => {
      S.groups = s ? s.docs.map(d => ({ code: d.id, ...d.data() })) : [];
      sync(); emit();
    });
    listen('links', db.collection('links').where('users', 'array-contains', me), s => {
      S.links = s ? docs(s) : [];
      sync(); emit();
    });
  }
  function stop() {
    Object.keys(subs).forEach(drop);
    subs = {};
    cb = null;
  }

  // Follow everyone I'm connected to: their profile, wishes, claims, and the
  // gift ideas I'm allowed to see (mine + each family group we share).
  function sync() {
    if (!S) return;
    const me = S.me;
    const myGroups = (S.profile && S.profile.groups) || [];
    const want = new Set();
    S.groups.forEach(g => (g.members || []).forEach(m => m !== me && want.add(m)));
    S.links.forEach(l => (l.users || []).forEach(m => m !== me && want.add(m)));

    const keys = new Set();
    for (const p of want) {
      const shared = S.groups.filter(g => myGroups.includes(g.code) && (g.members || []).includes(p)).map(g => g.code);
      const k = (name) => { keys.add(`p:${p}:${name}`); return `p:${p}:${name}`; };
      listen(k('profile'), U(p), s => { if (s && s.exists) S.people[p] = { uid: p, ...s.data() }; else delete S.people[p]; emit(); });
      listen(k('items'), U(p).collection('items'), s => { S.items[p] = s ? docs(s) : []; emit(); });
      listen(k('claims'), U(p).collection('claims'), s => { S.claims[p] = s ? docs(s) : []; emit(); });
      const bucket = (name, ref) => listen(k('ideas:' + name), ref, s => {
        S._ideas[p] = S._ideas[p] || {};
        S._ideas[p][name] = s ? docs(s) : [];
        const seen = new Set();
        S.ideas[p] = Object.values(S._ideas[p]).flat().filter(i => !seen.has(i.id) && seen.add(i.id));
        emit();
      });
      bucket('mine', ideasCol(p, 'u_' + me));
      for (const g of shared) bucket(g, ideasCol(p, g));
    }
    for (const key of Object.keys(subs)) if (key.startsWith('p:') && !keys.has(key)) {
      drop(key);
      const [, p, , name] = key.split(':');
      if (name && S._ideas[p]) delete S._ideas[p][name];
    }
    for (const p of Object.keys(S.people)) if (!want.has(p)) { delete S.people[p]; delete S.items[p]; delete S.claims[p]; delete S.ideas[p]; delete S._ideas[p]; }
  }

  // ---- codes ----
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const makeCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const cleanCode = c => (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  // A code you pick yourself (letters and numbers, 3-20), or a random one.
  function pickCode(custom) {
    if (!custom) return makeCode();
    const c = cleanCode(custom);
    if (c.length < 3 || c.length > 20) throw new Error('Codes need 3 to 20 letters or numbers.');
    return c;
  }
  const taken = e => (e && /permission|exists/i.test(e.code || e.message || '') ? new Error('That code is already taken — try another.') : e);

  // First sign-in: a profile and a personal code.
  async function createProfile(p) {
    const me = uid();
    const code = makeCode();
    const batch = db.batch();
    batch.set(db.collection('codes').doc(code), { type: 'person', uid: me });
    batch.set(U(me), { ...p, code, groups: [], createdAt: Date.now() });
    await batch.commit();
  }
  const saveProfile = patch => U(uid()).set(patch, { merge: true });

  async function newPersonalCode(custom) {
    const me = uid();
    const old = S.profile && S.profile.code;
    const code = pickCode(custom);
    if (code === old) return code;
    if ((await db.collection('codes').doc(code).get()).exists) throw new Error('That code is already taken — try another.');
    const batch = db.batch();
    batch.set(db.collection('codes').doc(code), { type: 'person', uid: me });
    if (old) batch.delete(db.collection('codes').doc(old));
    batch.update(U(me), { code });
    await batch.commit().catch(e => { throw taken(e); });
    return code;
  }

  async function createGroup(name, custom) {
    const me = uid();
    const code = pickCode(custom);
    if ((await db.collection('codes').doc(code).get()).exists) throw new Error('That code is already taken — try another.');
    const batch = db.batch();
    batch.set(db.collection('groups').doc(code), { name, members: [me], createdBy: me, createdAt: Date.now() });
    batch.set(db.collection('codes').doc(code), { type: 'group' });
    batch.update(U(me), { groups: FV.arrayUnion(code) });
    await batch.commit().catch(e => { throw taken(e); });
    return code;
  }
  const renameGroup = (code, name) => db.collection('groups').doc(code).update({ name });

  // One box for both kinds of code. -> { type: 'person'|'group' }
  async function join(raw) {
    const me = uid();
    const code = cleanCode(raw);
    if (code.length < 4) throw new Error('That code looks too short.');
    const snap = await db.collection('codes').doc(code).get();
    if (!snap.exists) throw new Error('That code didn’t match anyone. Check it and try again.');
    const c = snap.data();
    if (c.type === 'person') {
      if (c.uid === me) throw new Error('That’s your own code — send it to someone else so they can link to you.');
      if (S.links.some(l => l.users.includes(c.uid))) throw new Error('You’re already linked with them.');
      const users = [me, c.uid].sort();
      await db.collection('links').doc(pairId(me, c.uid)).set({ users, code, at: Date.now() });
      return { type: 'person', uid: c.uid };
    }
    if (S.groups.some(g => g.code === code)) throw new Error('You’re already in that group.');
    const batch = db.batch();
    batch.update(db.collection('groups').doc(code), { members: FV.arrayUnion(me) });
    batch.update(U(me), { groups: FV.arrayUnion(code) });
    await batch.commit();
    return { type: 'group', code };
  }

  async function leaveGroup(code) {
    const me = uid();
    const g = S.groups.find(x => x.code === code);
    const batch = db.batch();
    if (g && g.members.length <= 1) {
      batch.delete(db.collection('groups').doc(code));
      batch.delete(db.collection('codes').doc(code));
    } else {
      batch.update(db.collection('groups').doc(code), { members: FV.arrayRemove(me) });
    }
    batch.update(U(me), { groups: FV.arrayRemove(code) });
    await batch.commit();
  }
  const unlink = other => db.collection('links').doc(pairId(uid(), other)).delete();

  // ---- my wishes ----
  function saveItem(item) {
    const { id, ...rest } = item;
    const ref = id ? U(uid()).collection('items').doc(id) : U(uid()).collection('items').doc();
    return ref.set(rest).then(() => ref.id);
  }
  const deleteItem = id => U(uid()).collection('items').doc(id).delete();
  // "I got this" -- off the list, into Received.
  function receiveItem(item) {
    const me = uid();
    const { id, ...rest } = item;
    const batch = db.batch();
    batch.set(U(me).collection('received').doc(id), { ...keep(rest), fromUid: me, fromName: '', at: Date.now() });
    batch.delete(U(me).collection('items').doc(id));
    return batch.commit();
  }
  const deleteReceived = id => U(uid()).collection('received').doc(id).delete();

  // ---- gifts for other people ----
  function claim(owner, ref, kind, snap, byName) {
    const me = uid();
    return U(owner).collection('claims').doc(ref + '_' + me).set({ ref, kind, by: me, byName, name: snap.name || '', price: snap.price || null, link: snap.link || '', at: Date.now() });
  }
  const unclaim = (owner, claimId) => U(owner).collection('claims').doc(claimId).delete();

  // Handed over: it leaves their list (and the giver's shopping list) and shows
  // up in their Received history as "From <you>".
  function given(owner, entry, kind, byName) {
    const me = uid();
    const batch = db.batch();
    const claimRef = U(owner).collection('claims').doc(entry.id + '_' + me);
    batch.delete(claimRef);
    const rec = { ...keep(entry), fromUid: me, fromName: byName, at: Date.now() };
    if (kind === 'idea') {
      batch.set(U(owner).collection('received').doc(), rec);
      batch.delete(ideasCol(owner, circleOf(entry)).doc(entry.id));
    } else if ((entry.qty || 1) > 1) {
      batch.set(U(owner).collection('received').doc(entry.id + '_' + Date.now()), rec);
      batch.update(U(owner).collection('items').doc(entry.id), { qty: entry.qty - 1 });
    } else {
      batch.set(U(owner).collection('received').doc(entry.id), rec);
      batch.delete(U(owner).collection('items').doc(entry.id));
    }
    return batch.commit();
  }

  // prev = the idea as it was (when editing), so a change of circle moves it.
  async function saveIdea(owner, idea, prev) {
    const { id, ...rest } = idea;
    const ref = id ? ideasCol(owner, circleOf(rest)).doc(id) : ideasCol(owner, circleOf(rest)).doc();
    const batch = db.batch();
    if (prev && circleOf(prev) !== circleOf(rest)) batch.delete(ideasCol(owner, circleOf(prev)).doc(prev.id));
    batch.set(ref, rest);
    await batch.commit();
    return ref.id;
  }
  const deleteIdea = (owner, idea) => ideasCol(owner, circleOf(idea)).doc(idea.id).delete();

  function keep(o) {
    const out = {};
    for (const k of ['name', 'link', 'price', 'photo', 'notes', 'store']) if (o[k] !== undefined && o[k] !== null && o[k] !== '') out[k] = o[k];
    return out;
  }

  // ---- phone notifications ----
  const addToken = token => U(uid()).collection('private').doc('push').set({ tokens: FV.arrayUnion(token) }, { merge: true });
  const removeToken = token => U(uid()).collection('private').doc('push').set({ tokens: FV.arrayRemove(token) }, { merge: true });

  // ---- delete everything ----
  async function deleteAccount(password) {
    const u = auth.currentUser;
    await u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(u.email, password));
    const me = u.uid;
    const ops = [];
    const del = ref => ops.push(b => b.delete(ref));
    for (const sub of ['items', 'received', 'private']) (await U(me).collection(sub).get()).forEach(d => del(d.ref));
    for (const p of Object.keys(S.people)) {
      (S.claims[p] || []).filter(c => c.by === me).forEach(c => del(U(p).collection('claims').doc(c.id)));
      (S.ideas[p] || []).filter(i => i.by === me).forEach(i => del(ideasCol(p, circleOf(i)).doc(i.id)));
    }
    S.links.forEach(l => del(db.collection('links').doc(l.id)));
    if (S.profile && S.profile.code) del(db.collection('codes').doc(S.profile.code));
    for (let i = 0; i < ops.length; i += 400) {
      const b = db.batch();
      ops.slice(i, i + 400).forEach(f => f(b));
      await b.commit();
    }
    for (const g of S.groups) await leaveGroup(g.code);
    stop();
    await U(me).delete();
    await u.delete();
  }

  return {
    configured: true, onUser, signUp, signIn, reset, signOut, start, stop, createProfile, saveProfile,
    newPersonalCode, createGroup, renameGroup, join, leaveGroup, unlink, saveItem, deleteItem, receiveItem,
    deleteReceived, claim, unclaim, given, saveIdea, deleteIdea, addToken, removeToken, deleteAccount,
    uid,
  };
})();
