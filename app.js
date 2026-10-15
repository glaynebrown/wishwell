/* Wishwell screens. Data comes from store.js (Firebase) or demo.js (sample mode)
   as one state object S; every change re-draws the current screen.

   Screens (hash routes):
     #/list        My wish list
     #/received    Things I've been given / marked received
     #/people      Coming up + my family groups + friends
     #/p/{uid}     Someone's list + the gift ideas only our circle sees
     #/shopping    Everything I said "I'll get this" to
     #/settings    About me, colors, sharing codes, reminders, account */

(() => {
  const API = Store.configured ? Store : Demo;
  const SAMPLE = !!API.sample;
  const $ = s => document.querySelector(s);
  const view = $('#view');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (id, cls) => `<svg class="icon ${cls || ''}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} },
  };

  let user = null;
  let S = null;
  let pending = false;
  let signUpName = '';
  let lastPage = '#/list';
  // showTaken: claimed wishes are hidden on someone's list until you tap "show" (per visit)
  const ui = { sort: ls.get('ww-sort', 'star'), showTaken: false };

  // ---------- small helpers ----------
  const money = n => (n == null || n === '' || isNaN(n) ? '' : '$' + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0));
  const parsePrice = s => { const n = parseFloat(String(s || '').replace(/[^0-9.]/g, '')); return isNaN(n) ? null : Math.round(n * 100) / 100; };
  const myName = () => (S && S.profile && S.profile.name) || (user && user.name) || 'Me';
  const people = () => Object.values(S.people).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const nameOf = uid => (uid === S.me ? 'You' : (S.people[uid] && S.people[uid].name) || '');
  const first = s => (s || '?').trim().charAt(0).toUpperCase();
  const mySharedGroups = uid => S.groups.filter(g => (S.profile.groups || []).includes(g.id) && (g.members || []).includes(uid));
  const isLinked = uid => S.links.some(l => l.users.includes(uid));
  const claimsOn = (owner, ref) => (S.claims[owner] || []).filter(c => c.ref === ref);
  const thumb = e => (e.photo
    ? `<span class="thumb"><img src="${esc(e.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.textContent='${esc(first(e.name)).replace(/'/g, '')}'"></span>`
    : `<span class="thumb">${esc(first(e.name))}</span>`);
  function nextEvent(p) {
    const evs = Dates.events(p, undefined, S.me);
    return evs[0] || null;
  }
  function sorted(list, mode) {
    const by = {
      star: (a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0) || (b.createdAt || b.at || 0) - (a.createdAt || a.at || 0),
      low: (a, b) => (a.price == null) - (b.price == null) || (a.price || 0) - (b.price || 0),
      high: (a, b) => (a.price == null) - (b.price == null) || (b.price || 0) - (a.price || 0),
      new: (a, b) => (b.createdAt || b.at || 0) - (a.createdAt || a.at || 0),
    }[mode] || (() => 0);
    return list.slice().sort(by);
  }

  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), ms || 2400);
  }
  function oops(e) { console.error(e); toast((e && e.message && e.message.length < 140 ? e.message : 'Something went wrong — try again.')); }

  // ---------- dialogs ----------
  function ask(title, body, ok = 'OK', opts = {}) {
    return new Promise(res => {
      const wrap = $('#dialog-wrap');
      $('#dialog').innerHTML = `<h2>${esc(title)}</h2>${body ? `<p>${body}</p>` : ''}
        ${opts.input ? `<input class="input" id="dlg-in" type="${opts.input}" autocomplete="${opts.input === 'password' ? 'current-password' : 'off'}" placeholder="${esc(opts.placeholder || '')}">` : ''}
        <div class="row">${opts.cancel === false ? '' : `<button class="btn quiet" data-r="0">${esc(opts.cancelLabel || 'Cancel')}</button>`}
        <button class="btn ${opts.danger ? 'danger' : ''}" data-r="1">${esc(ok)}</button></div>`;
      wrap.hidden = false;
      const inp = $('#dlg-in');
      if (inp) setTimeout(() => inp.focus(), 50);
      wrap.onclick = e => {
        const b = e.target.closest('[data-r]');
        if (!b && e.target !== wrap) return;
        const yes = b && b.dataset.r === '1';
        wrap.hidden = true;
        wrap.onclick = null;
        res(opts.input ? (yes ? inp.value : null) : yes);
      };
    });
  }
  const tell = (title, body) => ask(title, body, 'Got it', { cancel: false });

  // ---------- sheet ----------
  const sheetWrap = $('#sheet-wrap');
  const sheet = $('#sheet');
  function openSheet(html, onClick) {
    sheet.innerHTML = `<div class="grab"></div>${html}`;
    sheetWrap.hidden = false;
    sheet.scrollTop = 0;
    sheet.onclick = onClick || null;
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    sheetWrap.hidden = true;
    sheet.innerHTML = '';
    sheet.onclick = null;
    sheet.onpaste = null;
    document.body.style.overflow = '';
    if (pending) render();
  }
  sheetWrap.addEventListener('click', e => { if (e.target.closest('[data-act="close"]')) closeSheet(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheetWrap.hidden) closeSheet(); });

  // ---------- boot ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // Always open at the top (don't let the browser restore an old scroll spot).
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  let freshStart = true;
  API.onUser(u => {
    user = u;
    freshStart = true;
    if (!u) { S = null; API.stop(); renderWelcome(); return; }
    view.innerHTML = '<p class="loading">Loading…</p>';
    API.start(s => { S = s; render(); });
  });
  window.addEventListener('hashchange', () => { ui.showTaken = false; findStarted = 0; render(); window.scrollTo(0, 0); });
  view.addEventListener('focusout', () => setTimeout(() => { if (pending && !typing()) render(); }, 0));
  const typing = () => view.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.type !== 'checkbox';

  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name, arg] = h.split('/');
    return { name: name || 'list', arg: arg ? decodeURIComponent(arg) : '' };
  }

  function render() {
    if (!S) return;
    // Don't yank a field out from under someone typing in Settings.
    if (typing() || !sheetWrap.hidden) { pending = true; return; }
    pending = false;
    if (!S.loaded) { view.innerHTML = '<p class="loading">Loading…</p>'; return; }
    if (!S.profile) { renderSetup(); return; }
    applyPalette(S.profile.palette);
    applyFont(S.profile.font);
    // A kid whose parent switched them to a grown-up account: set up their own login first.
    if (S.profile.kid === false && S.profile.kidCode) { renderGrownUp(); return; }
    $('#top').hidden = false;
    const r = route();
    renderTabs(r.name);
    const screens = isKid()
      ? { list: viewList, received: viewReceived, settings: viewSettings }
      : { list: viewList, received: viewReceived, people: viewPeople, p: viewPerson, shopping: viewShopping, settings: viewSettings, find: viewFind };
    (screens[r.name] || viewList)(r.arg);
    if (!document.documentElement.classList.contains('embed')) renderBanner();
    if (freshStart) { freshStart = false; window.scrollTo(0, 0); }
  }

  // Kid mode: just their own list (and a few settings).
  const isKid = () => !!(S && S.profile && S.profile.kid);
  const managedKids = () => people().filter(p => p.kid && (p.managers || []).includes(S.me));

  function renderGrownUp() {
    $('#top').hidden = true;
    window.scrollTo(0, 0);
    view.innerHTML = `<div class="welcome">
      <svg class="brand-mark" aria-hidden="true"><use href="#i-mark"/></svg>
      <h1>Your own login</h1>
      <p class="tagline">You’ve got the full Wishwell now! Pick an email and password to sign in with from now on. Your list stays just as it is.</p>
      <form class="card" id="gu">
        <p class="err" id="gu-err" hidden></p>
        <div class="field"><label for="gu-email">Email</label><input class="input" id="gu-email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="gu-pw">New password</label><input class="input" id="gu-pw" type="password" autocomplete="new-password" minlength="6" required></div>
        <button class="btn wide" type="submit">Save</button>
      </form>
    </div>`;
    $('#gu').onsubmit = async e => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        await API.finishGrownUp($('#gu-email').value.trim(), $('#gu-pw').value);
        tell('Almost done', 'Check your email and tap the link to confirm it. Until then, you can keep using Wishwell like normal.');
      } catch (err) {
        btn.disabled = false;
        const er = $('#gu-err'); er.hidden = false;
        er.textContent = /requires-recent-login/.test(err.code || '') ? 'Please sign out and back in with your kid code, then try again.' : niceAuth(err);
      }
    };
  }

  function applyFont(f) {
    f = window.WW_FONTS && window.WW_FONTS[f] ? f : 'classic';
    document.documentElement.dataset.font = f;
    ls.set('ww-font', f);
    const link = document.getElementById('fonts');
    if (link && window.WW_FONTS && link.href !== window.WW_FONTS[f]) link.href = window.WW_FONTS[f];
  }
  function applyPalette(p) {
    p = p || 'sage';
    document.documentElement.dataset.palette = p;
    ls.set('ww-palette', p);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && bg) meta.content = bg;
  }

  function renderTabs(on) {
    const mine = myClaims().filter(x => !x.c.bought).length;
    const tabs = [
      ['list', 'gift', 'My list'],
      ['people', 'people', 'People'],
      ['shopping', 'bag', 'Shopping', mine],
    ];
    const cur = on === 'received' ? 'list' : on === 'p' ? 'people' : on;
    document.body.classList.toggle('kid-mode', isKid());
    $('#tabs').innerHTML = isKid() ? '' : tabs.map(([k, ic, label, n]) =>
      `<a class="tab ${cur === k ? 'on' : ''}" href="#/${k}" ${cur === k ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${n ? `<span class="count">${n}</span>` : ''}</a>`).join('');
    $('#gear').classList.toggle('on', on === 'settings');
    // Tapping the gear again closes Settings and goes back to where you were.
    $('#gear').onclick = e => {
      if (route().name !== 'settings') { lastPage = location.hash || '#/list'; return; }
      e.preventDefault();
      location.hash = lastPage && !/settings/.test(lastPage) ? lastPage : '#/list';
    };
  }

  function renderBanner() {
    const b = $('#banner');
    if (SAMPLE) {
      b.hidden = false;
      const as = S.profile.name;
      b.innerHTML = `Sample mode — pretend family, saved only in this browser. Viewing as <b>${esc(as)}</b> · <button class="linkbtn" data-go="settings">switch</button>`;
      b.onclick = e => { if (e.target.closest('[data-go]')) location.hash = '#/settings'; };
    } else b.hidden = true;
  }

  // ---------- signed out ----------
  function renderWelcome(mode = 'in', msg = '') {
    $('#top').hidden = true;
    window.scrollTo(0, 0);
    $('#banner').hidden = true;
    if (mode === 'kid') { renderKidSignIn(msg); return; }
    const up = mode === 'up';
    view.innerHTML = `<div class="welcome">
      <svg class="brand-mark" aria-hidden="true"><use href="#i-mark"/></svg>
      <h1>Wishwell</h1>
      <p class="tagline">Wish lists for the people you love.</p>
      <form class="card" id="auth">
        ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
        ${up ? `<div class="field"><label for="a-name">Your name</label><input class="input" id="a-name" autocomplete="given-name" required></div>` : ''}
        <div class="field"><label for="a-email">Email</label><input class="input" id="a-email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="a-pw">Password</label><input class="input" id="a-pw" type="password" autocomplete="${up ? 'new-password' : 'current-password'}" minlength="6" required></div>
        <button class="btn wide" type="submit">${up ? 'Create account' : 'Sign in'}</button>
        ${up ? '' : `<p class="center small"><button type="button" class="linkbtn" id="a-forgot">Forgot password?</button></p>`}
      </form>
      <p class="center muted">${up ? 'Already have an account?' : 'New here?'} <button class="linkbtn" id="a-switch">${up ? 'Sign in' : 'Create an account'}</button></p>
      <p class="center muted small" style="margin-top:18px"><button class="linkbtn" id="a-kid">I have a kid code</button></p>
    </div>`;
    $('#a-switch').onclick = () => renderWelcome(up ? 'in' : 'up');
    $('#a-kid').onclick = () => renderWelcome('kid');
    const forgot = $('#a-forgot');
    if (forgot) forgot.onclick = async () => {
      const email = $('#a-email').value.trim();
      if (!email) { renderWelcome('in', 'Type your email first, then tap “Forgot password?”'); return; }
      try { await API.reset(email); tell('Check your email', 'We sent a link to reset your password.'); } catch (e) { renderWelcome('in', niceAuth(e)); }
    };
    $('#auth').onsubmit = async e => {
      e.preventDefault();
      const email = $('#a-email').value.trim();
      const pw = $('#a-pw').value;
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        if (up) { signUpName = $('#a-name').value.trim(); await API.signUp(signUpName, email, pw); }
        else await API.signIn(email, pw);
      } catch (err) { renderWelcome(mode, niceAuth(err)); }
    };
  }
  function renderKidSignIn(msg) {
    view.innerHTML = `<div class="welcome">
      <svg class="brand-mark" aria-hidden="true"><use href="#i-mark"/></svg>
      <h1>Hi there!</h1>
      <p class="tagline">Type in the code your grown-up gave you.</p>
      <form class="card" id="kid">
        ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
        <div class="field"><input class="input" id="k-code" autocapitalize="characters" autocomplete="off" aria-label="Kid code" placeholder="Kid code" style="font-size:22px;letter-spacing:.1em;text-transform:uppercase;text-align:center" required></div>
        <button class="btn wide" type="submit">Let’s go</button>
      </form>
      <p class="center muted"><button class="linkbtn" id="k-back">Back to sign in</button></p>
    </div>`;
    setTimeout(() => $('#k-code').focus(), 60);
    $('#k-back').onclick = () => renderWelcome('in');
    $('#kid').onsubmit = async e => {
      e.preventDefault();
      e.target.querySelector('button').disabled = true;
      try { await API.kidSignIn($('#k-code').value); }
      catch (err) { renderKidSignIn(/invalid-credential|wrong-password|user-not-found|invalid-email/.test(err.code || '') ? 'That code didn’t work — check it with your grown-up.' : niceAuth(err)); }
    };
  }
  function niceAuth(e) {
    const c = (e && e.code) || '';
    if (/invalid-credential|wrong-password|user-not-found/.test(c)) return 'That email and password don’t match.';
    if (/email-already-in-use/.test(c)) return 'There’s already an account with that email — try signing in.';
    if (/weak-password/.test(c)) return 'Use at least 6 characters for your password.';
    if (/invalid-email/.test(c)) return 'That email doesn’t look right.';
    if (/too-many-requests/.test(c)) return 'Too many tries — wait a minute and try again.';
    if (/network/.test(c)) return 'No connection — check your internet.';
    return (e && e.message) || 'Something went wrong.';
  }

  // ---------- first time ----------
  function renderSetup() {
    $('#top').hidden = true;
    window.scrollTo(0, 0);
    view.innerHTML = `<div class="welcome">
      <svg class="brand-mark" aria-hidden="true"><use href="#i-mark"/></svg>
      <h1>Welcome!</h1>
      <p class="tagline">A couple of things so your people know when to shop.</p>
      <form class="card" id="setup">
        <div class="field"><label for="s-name">Your name</label><input class="input" id="s-name" value="${esc(signUpName || user.name || '')}" required></div>
        <div class="field"><span class="label">Your birthday <span class="muted">(year optional)</span></span>${mdPicker('s-bday', '', '')}</div>
        <div class="field"><span class="label">Holidays you <i>get</i> gifts for</span>${holidayChips(['christmas'])}
          <p class="hint" style="margin-top:2px">You can change these, add an anniversary, or add other occasions (like a graduation) anytime in Settings.</p></div>
        <button class="btn wide" type="submit">Continue</button>
      </form>
    </div>`;
    $('#setup').onsubmit = async e => {
      e.preventDefault();
      const name = $('#s-name').value.trim() || user.name || 'Me';
      try {
        await API.createProfile({
          name, birthday: readMD('s-bday'), birthYear: readYear('s-bday'), anniversary: '', custom: [],
          holidays: [...view.querySelectorAll('[name=hol]:checked')].map(x => x.value),
          remind: [14, 7], palette: ls.get('ww-palette', 'sage'),
        });
        location.hash = '#/people';
      } catch (err) { oops(err); }
    };
  }

  // withYear: show an optional year box (birthdays) -- pass the current year or ''
  function mdPicker(id, md, withYear) {
    const [m, d] = Dates.valid(md) ? md.split('-').map(Number) : [0, 0];
    const yr = withYear !== undefined ? `<input class="input" id="${id}-y" inputmode="numeric" maxlength="4" placeholder="Year" aria-label="Birth year (optional)" value="${esc(withYear || '')}">` : '';
    return `<div class="md ${yr ? 'with-year' : ''}">
      <select class="input" id="${id}-m" aria-label="Month"><option value="">Month</option>${Dates.MONTHS.map((n, i) => `<option value="${i + 1}" ${m === i + 1 ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <select class="input" id="${id}-d" aria-label="Day"><option value="">Day</option>${Array.from({ length: 31 }, (_, i) => `<option ${d === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>${yr}
    </div>`;
  }
  // '' or a sensible 4-digit year
  function readYear(id) {
    const el = $('#' + id + '-y');
    const y = el ? parseInt(el.value, 10) : NaN;
    return y > 1900 && y <= new Date().getFullYear() ? y : '';
  }
  function readMD(id) {
    const m = $('#' + id + '-m').value;
    const d = $('#' + id + '-d').value;
    return m && d ? String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0') : '';
  }
  function holidayChips(on) {
    return `<div class="check-chips">${Dates.HOLIDAYS.map(h => `<label><input type="checkbox" name="hol" value="${h.key}" ${on.includes(h.key) ? 'checked' : ''}><span>${h.emoji} ${esc(h.name)}</span></label>`).join('')}</div>`;
  }

  // ---------- My list ----------
  function sortPick() {
    const opts = [['star', 'Really want'], ['low', 'Lowest price'], ['high', 'Highest price'], ['new', 'Newest']];
    return `<label class="sort-pick" title="Sort">${icon('sort')}<select id="sort" aria-label="Sort">${opts.map(([k, l]) => `<option value="${k}" ${ui.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
  }
  function wireSort() {
    const sel = $('#sort');
    if (sel) sel.onchange = () => { ui.sort = sel.value; ls.set('ww-sort', ui.sort); sel.blur(); render(); };
  }

  function metaLine(e) {
    const bits = [];
    if (e.price != null && e.price !== '') bits.push(`<span class="price">${money(e.price)}</span>`);
    if (e.store) bits.push(`<span>${esc(e.store)}</span>`);
    return bits.length ? `<div class="wish-meta">${bits.join('<span aria-hidden="true">·</span>')}</div>` : '';
  }
  const linkOut = e => (e.link ? `<a class="openlink" href="${esc(e.link)}" target="_blank" rel="noopener noreferrer">${icon('link')}Open</a>` : '');

  function ownerCard(it) {
    return `<article class="wish tap" data-edit="${esc(it.id)}">
      <div class="wish-top">${thumb(it)}<div class="wish-body">
        <div class="wish-name">${esc(it.name || 'Untitled')}</div>
        ${metaLine(it)}
        ${it.notes ? `<div class="wish-notes">${esc(it.notes)}</div>` : ''}
        <div class="tags">${it.star ? `<span class="tag star">${icon('star')}Really want</span>` : ''}${(it.qty || 1) > 1 ? `<span class="tag">Wants ${it.qty}</span>` : ''}</div>
      </div></div>
      ${it.link ? `<div class="wish-foot">${linkOut(it)}</div>` : ''}
    </article>`;
  }

  function viewList() {
    const items = sorted(S.items[S.me] || [], ui.sort);
    const n = people().length;
    view.innerHTML = `
      <div class="list-head">
        <h1>My wish list</h1><button class="btn" id="add">${icon('plus')}Add a wish</button>
        <p class="sub">${[items.length ? `${items.length} wish${items.length === 1 ? '' : 'es'}` : '', n ? '' : 'not shared yet'].filter(Boolean).join(' · ')}</p>${items.length > 1 ? sortPick() : ''}
      </div>
      ${items.length ? `<div class="wishes">${items.map(ownerCard).join('')}</div>` : `
        <div class="card empty"><svg class="mark"><use href="#i-mark"/></svg><h2>Your list is empty</h2>
        <p>Add something you’d love. Paste a store link and Wishwell fills in what it can.</p>
        <button class="btn" id="add2">${icon('plus')}Add your first wish</button></div>`}
      <p class="center" style="margin-top:28px"><a href="#/received" class="linkbtn">Received${S.received.length ? ` (${S.received.length})` : ''}</a></p>
      <p class="center hint">Gifts marked as given move to Received, so your list stays tidy. You’ll never see what’s been claimed.</p>`;
    wireSort();
    const add = () => itemSheet({ owner: S.me, kind: 'item' });
    $('#add').onclick = add;
    if ($('#add2')) $('#add2').onclick = add;
    view.querySelectorAll('[data-edit]').forEach(c => c.onclick = e => {
      if (e.target.closest('a')) return;
      const it = (S.items[S.me] || []).find(x => x.id === c.dataset.edit);
      if (it) itemSheet({ owner: S.me, kind: 'item', entry: it });
    });
  }

  function viewReceived() {
    const list = S.received.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
    view.innerHTML = `<a class="back" href="#/list">${icon('back')}My list</a>
      <div class="page-head"><div><h1>Received</h1><p class="sub">Gifts people marked as given, and things you marked as gotten.</p></div></div>
      ${list.length ? `<div class="wishes">${list.map(r => `<article class="wish">
        <div class="wish-top">${thumb(r)}<div class="wish-body">
          <div class="wish-name">${esc(r.name || 'Untitled')}</div>${metaLine(r)}
          <div class="wish-notes">${r.fromName ? `From <b>${esc(r.fromName)}</b>` : 'You marked this received'} · ${r.at ? Dates.fmt(new Date(r.at)) + ' ' + new Date(r.at).getFullYear() : ''}</div>
        </div></div>
        <div class="wish-foot"><div class="acts">
          <button class="btn quiet small" data-restore="${esc(r.id)}">Put back on my list</button>
          <button class="btn ghost small" data-del="${esc(r.id)}">Remove</button></div></div>
      </article>`).join('')}</div>` : `<div class="card empty"><h2>Nothing yet</h2><p>When someone marks a gift as given, it shows up here with who it was from — handy for thank-you notes.</p></div>`}`;
    view.querySelectorAll('[data-del]').forEach(b => b.onclick = () => API.deleteReceived(b.dataset.del).catch(oops));
    view.querySelectorAll('[data-restore]').forEach(b => b.onclick = async () => {
      const r = S.received.find(x => x.id === b.dataset.restore);
      if (!r) return;
      try {
        await API.saveItem(cleanEntry({ name: r.name, link: r.link, price: r.price, photo: r.photo, notes: r.notes, store: r.store, qty: 1, createdAt: Date.now() }));
        await API.deleteReceived(r.id);
        toast('Back on your list');
      } catch (e) { oops(e); }
    });
  }

  // ---------- add / edit sheet ----------
  // ctx: { owner, kind: 'item'|'idea', entry? }
  function itemSheet(ctx) {
    const e = ctx.entry || {};
    const isIdea = ctx.kind === 'idea';
    const ownerName = isIdea ? S.people[ctx.owner].name : '';
    const groups = isIdea ? mySharedGroups(ctx.owner) : [];
    const scope = e.scope || (groups[0] ? groups[0].id : 'me');
    let photo = e.photo || '';
    let star = !!e.star;
    let qty = e.qty || 1;
    const canDelete = !!e.id && (!isIdea || e.by === S.me || groups.some(g => g.id === e.scope));

    openSheet(`
      <div class="sheet-head"><h2>${e.id ? (isIdea ? 'Edit idea' : 'Edit wish') : (isIdea ? `Gift idea for ${esc(ownerName)}` : ctx.owner !== S.me ? `A wish for ${esc(S.people[ctx.owner].name)}` : 'Add a wish')}</h2>
        <button class="btn quiet" data-act="close">Cancel</button></div>
      ${isIdea ? `<div class="vis-pick" role="radiogroup" aria-label="Who can see this idea">${icon('lock')}
          ${groups.map(g => `<label><input type="radio" name="f-scope" value="${esc(g.id)}" ${scope === g.id ? 'checked' : ''}><span>${esc(g.name)}</span></label>`).join('')}
          <label><input type="radio" name="f-scope" value="me" ${scope === 'me' ? 'checked' : ''}><span>Just me</span></label></div>
        <p class="hint" style="margin:-4px 0 12px">${esc(ownerName)} never sees ideas.</p>` : ''}
      <div class="row tight"><input class="input grow" id="f-link" type="url" inputmode="url" aria-label="Link" placeholder="Paste a store link (optional)" value="${esc(e.link || '')}">
        <button class="btn soft small" id="f-fill" type="button">Fill in</button></div>
      <div class="fill-note" id="f-note"></div>
      <input class="input tight" id="f-name" aria-label="${isIdea ? 'Idea' : 'What is it?'}" value="${esc(e.name || '')}" placeholder="${isIdea ? 'The idea' : 'What is it?'}">
      <div class="photo-row tight">
        <button type="button" class="photo-btn" id="f-upload" aria-label="Choose a photo"><span id="f-photo">${photo ? thumb({ photo, name: '' }) : `<span class="thumb">${icon('photo')}</span>`}</span></button>
        <div class="photo-side">
          <label class="money-in"><span aria-hidden="true">$</span><input class="input" id="f-price" inputmode="decimal" aria-label="Price" placeholder="Price" value="${e.price != null ? esc(e.price) : ''}"></label>
          <input class="input" id="f-store" aria-label="Store" placeholder="Store" value="${esc(e.store || '')}">
          <div class="photo-links"><button class="linkbtn" id="f-paste" type="button">Paste photo</button><button class="linkbtn" id="f-nophoto" type="button" ${photo ? '' : 'hidden'}>Remove photo</button></div>
        </div>
      </div>
      <textarea class="input tight notes" id="f-notes" rows="3" aria-label="Notes" placeholder="Notes — size, color, anything helpful…">${esc(e.notes || '')}</textarea>
      ${isIdea ? '' : `
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <button class="star-toggle ${star ? 'on' : ''}" id="f-star" type="button">${icon('star')}Really want</button>
        <div class="row"><span class="label">How many</span><span class="stepper"><button type="button" id="f-minus" aria-label="Fewer">−</button><span id="f-qty">${qty}</span><button type="button" id="f-plus" aria-label="More">+</button></span></div>
      </div>`}
      <div class="sheet-foot"><button class="btn wide" id="f-save">${e.id ? 'Save' : (isIdea ? 'Add idea' : ctx.owner !== S.me ? 'Add to their list' : 'Add to my list')}</button></div>
      ${e.id && !isIdea && ctx.owner === S.me ? `<div class="sheet-foot"><button class="btn soft wide" id="f-got">${icon('check')}I got this</button><button class="btn danger" id="f-del">Delete</button></div>` : ''}
      ${e.id && !isIdea && ctx.owner !== S.me ? `<div class="sheet-foot"><button class="btn danger wide" id="f-del">Delete from ${esc(Dates.possessive(S.people[ctx.owner].name))} list</button></div>` : ''}
      ${e.id && isIdea && canDelete ? `<div class="sheet-foot"><button class="btn danger wide" id="f-del">Delete idea</button></div>` : ''}
    `);

    const note = (msg, good) => { const n = $('#f-note'); n.textContent = msg; n.className = 'fill-note' + (good ? ' good' : ''); };
    const setPhoto = p => {
      photo = p || '';
      $('#f-photo').innerHTML = photo ? thumb({ photo, name: '' }) : `<span class="thumb">${icon('photo')}</span>`;
      $('#f-nophoto').hidden = !photo;
    };
    let lastFilled = '';
    async function fill() {
      const url = $('#f-link').value.trim();
      if (!url || url === lastFilled) return;
      lastFilled = url;
      note('Looking it up…');
      const r = await Lookup.lookup(url);
      if (!sheet.contains($('#f-link'))) return;
      if (r.link && r.link !== url) $('#f-link').value = r.link;
      const nameEl = $('#f-name');
      if (r.name && !nameEl.value.trim()) nameEl.value = r.name;
      if (r.store && !$('#f-store').value.trim()) $('#f-store').value = r.store;
      if (r.photo && !photo) setPhoto(r.photo);
      if (r.limited) note('Auto-fill is resting for today (free limit) — add the details yourself.');
      else if (r.photo) note('Filled in what we could — check it over.', true);
      else if (r.name) note('Got the name from the link. Add a photo or price if you like.', true);
      else note('Couldn’t fill this one in — add the details yourself.');
    }
    $('#f-fill').onclick = () => { lastFilled = ''; fill(); };
    $('#f-link').addEventListener('paste', () => setTimeout(fill, 30));
    $('#f-link').addEventListener('change', fill);
    $('#f-upload').onclick = () => pickFile().then(p => p && setPhoto(p));
    $('#f-paste').onclick = async () => {
      try {
        if (!navigator.clipboard || !navigator.clipboard.read) throw new Error('no');
        const items = await navigator.clipboard.read();
        for (const it of items) {
          const type = it.types.find(t => t.startsWith('image/'));
          if (type) { setPhoto(await shrink(await it.getType(type))); return; }
        }
        toast('No photo on the clipboard — copy one first');
      } catch (err) { toast('Couldn’t paste here — try “Choose” instead'); }
    };
    sheet.onpaste = async ev => {
      const f = [...(ev.clipboardData && ev.clipboardData.files || [])].find(x => x.type.startsWith('image/'));
      if (f) { ev.preventDefault(); setPhoto(await shrink(f)); }
    };
    $('#f-nophoto').onclick = () => setPhoto('');
    if (!isIdea) {
      $('#f-star').onclick = () => { star = !star; $('#f-star').classList.toggle('on', star); };
      const q = d => { qty = Math.max(1, Math.min(20, qty + d)); $('#f-qty').textContent = qty; };
      $('#f-minus').onclick = () => q(-1);
      $('#f-plus').onclick = () => q(1);
    }

    $('#f-save').onclick = async () => {
      const name = $('#f-name').value.trim();
      const link = $('#f-link').value.trim();
      if (!name && !link) { toast('Add a name or a link'); $('#f-name').focus(); return; }
      const base = {
        name: name || Lookup.storeName(link) + ' item', link, photo,
        price: parsePrice($('#f-price').value), store: $('#f-store').value.trim(), notes: $('#f-notes').value.trim(),
      };
      $('#f-save').disabled = true;
      try {
        if (isIdea) {
          await API.saveIdea(ctx.owner, cleanEntry({ ...base, id: e.id, scope: (sheet.querySelector('[name=f-scope]:checked') || {}).value || 'me', by: e.by || S.me, byName: e.byName || myName(), at: e.at || Date.now() }), e.id ? e : null);
        } else {
          await API.saveItem(cleanEntry({ ...base, id: e.id, star, qty, createdAt: e.createdAt || Date.now() }), ctx.owner);
        }
        closeSheet();
        toast(e.id ? 'Saved' : isIdea ? 'Idea added' : ctx.owner !== S.me ? 'Added' : 'Added to your list');
      } catch (err) { $('#f-save').disabled = false; oops(err); }
    };
    const got = $('#f-got');
    if (got) got.onclick = async () => {
      closeSheet();
      try { await API.receiveItem(e); toast('Moved to Received'); } catch (err) { oops(err); }
    };
    const del = $('#f-del');
    if (del) del.onclick = async () => {
      if (!(await ask(isIdea ? 'Delete this idea?' : 'Delete this wish?', 'It’s gone for everyone.', 'Delete', { danger: true }))) return;
      closeSheet();
      try { if (isIdea) await API.deleteIdea(ctx.owner, e); else await API.deleteItem(e.id, ctx.owner); toast('Deleted'); } catch (err) { oops(err); }
    };
  }
  function cleanEntry(o) {
    const out = {};
    for (const k in o) if (o[k] !== undefined && o[k] !== '' && !(k === 'id' && !o[k])) out[k] = o[k];
    if (!('price' in out)) out.price = null;
    return out;
  }

  function pickFile() {
    return new Promise(res => {
      const f = $('#file');
      f.value = '';
      f.onchange = async () => { res(f.files[0] ? await shrink(f.files[0]) : null); };
      f.click();
    });
  }
  // Photos are kept small (they live in the database, not file storage).
  function shrink(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 640;
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That photo couldn’t be opened.')); };
      img.src = url;
    });
  }

  // ---------- People ----------
  // Birthdays + anniversaries (partner only) in the next 30 days, holidays in the
  // next 60, soonest first. A holiday is one row however many people it's for.
  function upcoming() {
    const rows = [];
    const hol = {};
    for (const p of people()) {
      for (const ev of Dates.events(p, undefined, S.me)) {
        if (ev.kind === 'custom' || ev.days > (ev.kind === 'holiday' ? 60 : 30)) continue;
        if (ev.kind === 'holiday') hol[ev.key] = hol[ev.key] || { ev, people: [] };
        else rows.push({ ev, p });
      }
    }
    Object.values(hol).forEach(h => rows.push(h));
    return rows.sort((a, b) => a.ev.days - b.ev.days);
  }
  function upRow(r) {
    const when = `<span class="up-when ${r.ev.days <= 14 ? 'soon' : ''}">${Dates.inWords(r.ev.days)}</span>`;
    if (r.p) {
      return `<a class="up-row" href="#/p/${encodeURIComponent(r.p.uid)}"><span class="up-emoji">${r.ev.emoji}</span>
        <span class="up-main"><span class="up-title">${esc(Dates.title(r.ev, r.p.name))}</span><br><span class="up-sub">${Dates.fmt(r.ev.date, true)}</span></span>${when}</a>`;
    }
    return `<div class="up-row"><span class="up-emoji">${r.ev.emoji}</span>
      <span class="up-main"><span class="up-title">${esc(r.ev.name)}</span><br><span class="up-sub">${Dates.fmt(r.ev.date, true)}</span></span>${when}</div>`;
  }
  function personRow(p) {
    const bev = Dates.events(p, undefined, S.me).find(e => e.kind === 'birthday');
    return `<a class="person-row" href="#/p/${encodeURIComponent(p.uid)}">
      <span class="pr-name">${esc(p.name)}</span>
      ${bev && bev.turning ? `<span class="pr-age">Turning ${bev.turning}</span>` : ''}
      <span class="pr-next">${bev ? `🎂 ${Dates.fmtMD(p.birthday)}` : 'No birthday yet'}</span>
      <span class="chev">›</span></a>`;
  }

  function viewPeople() {
    const ups = upcoming();
    const friends = S.links.map(l => S.people[l.users.find(u => u !== S.me)]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    const groups = S.groups.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const nobody = !groups.length && !S.links.length;
    view.innerHTML = `
      <div class="page-head"><div><h1>People</h1><p class="sub">Tap someone to see their wishlist.</p></div></div>
      ${ups.length ? `<div class="card"><div class="circle-head"><h3>Coming up</h3></div><div class="upcoming">${ups.map(upRow).join('')}</div></div>` : ''}
      ${groups.map(g => {
        const mem = (g.members || []).filter(m => m !== S.me).map(m => S.people[m]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
        return `<div class="section-title"><h2>${esc(g.name)}</h2><button class="codepill" data-copy="${esc(g.code)}" data-what="${esc(g.name)}" aria-label="Copy family code">${esc(fmtCode(g.code))}${icon('copy')}</button></div>
          <div class="card">${mem.length ? mem.map(personRow).join('') : `<p class="muted" style="margin:0">No one else yet. Send them the code <b>${esc(fmtCode(g.code))}</b> — they enter it in Wishwell to join.</p>`}</div>`;
      }).join('')}
      ${friends.length ? `<div class="section-title"><h2>Friends</h2><span class="hint">Linked just with you</span></div><div class="card">${friends.map(personRow).join('')}</div>` : ''}
      ${nobody ? `<div class="card empty"><svg class="mark"><use href="#i-mark"/></svg><h2>Bring your people in</h2>
        <p>Start a family group and share its code, or enter a code someone sent you.</p></div>` : ''}
      <div class="btn-row">
        <button class="btn" id="join">Enter a code</button>
        <button class="btn soft" id="newgroup">Start a group</button>
        <button class="btn ghost" id="sharemine">Share my code</button>
      </div>
      <p class="hint" style="margin-top:12px">A <b>family code</b> lets everyone in the group see each other’s lists. <b>Your code</b> shares just your list with one person — like a friend — and theirs with you.</p>`;
    wireCopy();
    $('#join').onclick = joinSheet;
    $('#newgroup').onclick = groupSheet;
    $('#sharemine').onclick = () => shareCode(S.profile.code, 'person');
  }
  const fmtCode = c => c || '';
  function wireCopy() {
    view.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => shareCode(b.dataset.copy, 'group', b.dataset.what));
  }
  async function shareCode(code, type, groupName) {
    const text = type === 'group'
      ? `Join “${groupName}” on Wishwell so we can see each other’s wish lists! Code: ${fmtCode(code)}\n${appURL()}`
      : `Link with me on Wishwell so we can see each other’s wish lists! My code: ${fmtCode(code)}\n${appURL()}`;
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); toast('Copied — paste it in a text'); } catch (e) { tell('Your code', esc(fmtCode(code))); }
  }
  const appURL = () => location.href.split('#')[0];

  function joinSheet() {
    openSheet(`<div class="sheet-head"><h2>Enter a code</h2><button class="btn quiet" data-act="close">Cancel</button></div>
      <p class="hint" style="margin-top:-8px;margin-bottom:14px">A family code adds you to the group. A person’s code links just the two of you.</p>
      <div class="field"><input class="input" id="j-code" autocapitalize="characters" autocomplete="off" placeholder="e.g. ABC-123" style="font-size:20px;letter-spacing:.1em;text-transform:uppercase"></div>
      <p class="err" id="j-err" hidden></p>
      <div class="sheet-foot"><button class="btn wide" id="j-go">Join</button></div>`);
    setTimeout(() => $('#j-code').focus(), 60);
    const go = async () => {
      $('#j-go').disabled = true;
      try {
        const r = await API.join($('#j-code').value);
        closeSheet();
        toast(r.type === 'group' ? 'You’re in! 🎉' : 'Linked! 🎉');
        location.hash = '#/people';
      } catch (e) { $('#j-go').disabled = false; const er = $('#j-err'); er.hidden = false; er.textContent = e.message || 'That didn’t work.'; }
    };
    $('#j-go').onclick = go;
    $('#j-code').onkeydown = e => { if (e.key === 'Enter') go(); };
  }
  function groupSheet() {
    openSheet(`<div class="sheet-head"><h2>Start a family group</h2><button class="btn quiet" data-act="close">Cancel</button></div>
      <div class="field"><label for="g-name">Group name</label><input class="input" id="g-name" placeholder="e.g. Brown Family"></div>
      <div class="field"><label for="g-code">Family code</label><input class="input" id="g-code" autocapitalize="characters" autocomplete="off" placeholder="e.g. BROWNFAM" style="text-transform:uppercase;letter-spacing:.06em">
        <p class="hint" style="margin:0">What your family types in to join. Letters and numbers, 3–20. Leave blank for a random one.</p></div>
      <p class="err" id="g-err" hidden></p>
      <div class="sheet-foot"><button class="btn wide" id="g-go">Create</button></div>`);
    setTimeout(() => $('#g-name').focus(), 60);
    $('#g-go').onclick = async () => {
      const name = $('#g-name').value.trim() || 'Family';
      $('#g-go').disabled = true;
      try {
        const code = await API.createGroup(name, $('#g-code').value.trim());
        openSheet(`<div class="sheet-head"><h2>${esc(name)}</h2><button class="btn quiet" data-act="close">Done</button></div>
          <p class="muted">Send this code to your family. They sign up for Wishwell, tap <b>Enter a code</b>, and they’re in.</p>
          <div class="mycode"><span class="code">${esc(fmtCode(code))}</span><button class="btn small" id="g-share">${icon('copy')}Share</button></div>`);
        $('#g-share').onclick = () => shareCode(code, 'group', name);
      } catch (e) { $('#g-go').disabled = false; const er = $('#g-err'); er.hidden = false; er.textContent = e.message || 'That didn’t work.'; }
    };
  }

  // ---------- someone's list ----------
  function circleWords(uid) {
    const gs = S.groups.filter(g => (g.members || []).includes(uid)).map(g => g.name);
    if (isLinked(uid)) gs.push('linked with you');
    return gs.join(' · ');
  }
  function claimerWords(cl) {
    // Names only for people you're connected to yourself.
    const names = cl.filter(c => c.by !== S.me).map(c => (S.people[c.by] ? S.people[c.by].name : null));
    const known = names.filter(Boolean);
    const unknown = names.length - known.length;
    return known.join(' & ') + (unknown ? (known.length ? ' & someone' : 'someone') : '');
  }

  function giverCard(owner, e, kind) {
    const cl = claimsOn(owner, e.id);
    const qty = kind === 'idea' ? 1 : e.qty || 1;
    const mine = cl.find(c => c.by === S.me);
    const full = cl.length >= qty;
    let status = '';
    let acts = '';
    if (mine) {
      // "Bought" is just for you -- the person never sees it, others just see "Claimed"
      status = `<label class="bought-box"><input type="checkbox" data-bought="${esc(mine.id)}" ${mine.bought ? 'checked' : ''}><span>${icon('check')}</span>Bought</label>`;
      acts = `<button class="btn quiet small" data-unclaim="${esc(e.id)}" data-kind="${kind}">Undo</button><button class="btn small" data-given="${esc(e.id)}" data-kind="${kind}">Given</button>`;
    } else if (full) {
      status = `<span class="status">${icon('check')}Claimed by ${esc(claimerWords(cl))}</span>`;
    } else {
      if (cl.length) status = `<span class="status">${cl.length} of ${qty} claimed</span>`;
      acts = `<button class="btn ghost small" data-claim="${esc(e.id)}" data-kind="${kind}">I’ll get this</button>`;
    }
    const tags = [];
    if (e.star) tags.push(`<span class="tag star">${icon('star')}Really want</span>`);
    if (qty > 1) tags.push(`<span class="tag">Wants ${qty}</span>`);
    if (kind === 'idea') {
      const g = S.groups.find(x => x.id === e.scope);
      tags.push(`<span class="tag idea">Added by ${esc(e.by === S.me ? 'you' : e.byName || 'someone')}</span>`);
      tags.push(`<span class="tag">${icon('lock')} ${esc(e.scope === 'me' ? 'Just you' : g ? g.name : 'Group')}</span>`);
    }
    const editable = kind === 'idea' && (e.by === S.me || S.groups.some(g => g.id === e.scope));
    if (kind === 'item' && S.people[owner] && (S.people[owner].managers || []).includes(S.me)) acts = `<button class="btn quiet small" data-kidedit="${esc(e.id)}">Edit</button>` + acts;
    return `<article class="wish ${full && !mine ? 'taken' : ''} ${editable ? 'tap' : ''}" ${editable ? `data-editidea="${esc(e.id)}"` : ''}>
      <div class="wish-top">${thumb(e)}<div class="wish-body">
        <div class="wish-name">${esc(e.name || 'Untitled')}</div>${metaLine(e)}
        ${e.notes ? `<div class="wish-notes">${esc(e.notes)}</div>` : ''}
        ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
      </div></div>
      <div class="wish-foot">${status}${linkOut(e)}<div class="acts">${acts}</div></div>
    </article>`;
  }

  const confirmUndo = owner => ask('Return to their wishlist?', `You won’t be getting this anymore, and it’ll be open for others to claim on ${esc(Dates.possessive(S.people[owner] ? S.people[owner].name : 'their'))} list.`, 'Return it');

  function wireGiving(owner) {
    const find = (id, kind) => (kind === 'idea' ? S.ideas[owner] : S.items[owner] || []).find(x => x.id === id);
    view.querySelectorAll('[data-claim]').forEach(b => b.onclick = async ev => {
      ev.stopPropagation();
      const e = find(b.dataset.claim, b.dataset.kind);
      if (!e) return;
      const who = S.people[owner] ? S.people[owner].name : 'they';
      try { await API.claim(owner, e.id, b.dataset.kind, e, myName()); toast(`You’re getting this! Others will see it’s taken so no one doubles up — ${who} won’t see it. Find it in Shopping.`, 5000); } catch (err) { oops(err); }
    });
    view.querySelectorAll('[data-bought]').forEach(b => b.onchange = () => API.setBought(owner, b.dataset.bought, b.checked).catch(oops));
    view.querySelectorAll('[data-unclaim]').forEach(b => b.onclick = async ev => {
      ev.stopPropagation();
      if (await confirmUndo(owner)) API.unclaim(owner, b.dataset.unclaim + '_' + S.me).catch(oops);
    });
    view.querySelectorAll('[data-given]').forEach(b => b.onclick = async ev => {
      ev.stopPropagation();
      const e = find(b.dataset.given, b.dataset.kind);
      if (!e) return;
      const who = S.people[owner] ? S.people[owner].name : 'them';
      if (!(await ask('Mark as given?', `Only once ${esc(who)} has it in hand. It comes off the list for everyone and shows up in ${esc(Dates.possessive(who))} Received as from you.`, 'Given 🎁'))) return;
      try { await API.given(owner, e, b.dataset.kind, myName()); toast('Marked as given 🎁'); } catch (err) { oops(err); }
    });
    view.querySelectorAll('[data-editidea]').forEach(c => c.onclick = ev => {
      if (ev.target.closest('a, button')) return;
      const e = (S.ideas[owner] || []).find(x => x.id === c.dataset.editidea);
      if (e) itemSheet({ owner, kind: 'idea', entry: e });
    });
  }

  function viewPerson(uid) {
    const p = S.people[uid];
    if (!p) {
      view.innerHTML = `<a class="back" href="#/people">${icon('back')}People</a><div class="card empty"><h2>Not linked</h2><p>You’re not connected with this person (anymore).</p></div>`;
      return;
    }
    const claimedFull = e => claimsOn(uid, e.id).length >= (e.qty || 1) && !claimsOn(uid, e.id).some(c => c.by === S.me);
    let items = sorted(S.items[uid] || [], ui.sort);
    const taken = items.filter(claimedFull).length;
    if (!ui.showTaken) items = items.filter(e => !claimedFull(e));
    const ideas = sorted(S.ideas[uid] || [], 'new');
    const groups = mySharedGroups(uid);
    const evs = Dates.events(p, undefined, S.me);
    const whoSees = groups.length ? `Seen by ${groups.map(g => esc(g.name)).join(' and ')}, or just you — never ${esc(p.name)}.` : `Only you can see ideas you add here — ${esc(p.name)} can’t.`;
    view.innerHTML = `<a class="back" href="#/people">${icon('back')}People</a>
      <div class="person-head"><div><h1>${esc(p.name)}</h1><p class="sub muted" style="margin:2px 0 0">${esc(circleWords(uid))}</p></div></div>
      <p class="date-line">${evs.length ? evs.map(ev => `<span title="${esc(ev.name)} · ${Dates.inWords(ev.days)}">${ev.emoji} ${Dates.fmt(ev.date)}${ev.turning ? ` (turns ${ev.turning})` : ''}</span>`).join('<span aria-hidden="true">·</span>') : '<span>No dates yet</span>'}
        <button class="edit-btn" id="edit-dates" aria-label="${evs.length ? 'Edit dates' : 'Add dates'}">${icon(evs.length ? 'edit' : 'plus')}</button></p>
      <div class="section-title" style="margin-top:6px;align-items:center"><h2>${esc(Dates.possessive(p.name))} wishes</h2>${(S.items[uid] || []).length > 1 ? sortPick() : ''}</div>
      ${(p.managers || []).includes(S.me) && p.kid ? `<p class="kid-manage">${icon('edit')}<span>You manage ${esc(Dates.possessive(p.name))} list.</span><button class="btn soft small" id="kid-add">${icon('plus')}Add a wish</button></p>` : ''}
      ${items.length ? `<div class="wishes">${items.map(e => giverCard(uid, e, 'item')).join('')}</div>` : `<div class="card empty" style="padding:28px 20px"><p style="margin:0">${(S.items[uid] || []).length ? 'Everything on this list has been claimed.' : `${esc(p.name)} hasn’t added any wishes yet.`}</p></div>`}
      ${taken ? `<p class="center" style="margin:14px 0 0"><button class="linkbtn quiet-link" id="toggle-taken">${ui.showTaken ? 'Hide claimed' : `${taken} claimed — show`}</button></p>` : ''}
      <section class="secret">
        <div class="section-title"><h2>Gift ideas for ${esc(p.name)}</h2><button class="btn soft small" id="add-idea">${icon('plus')}Add</button></div>
        <p class="secret-note">${icon('lock')}<span>${whoSees}</span></p>
        ${ideas.length ? `<div class="wishes">${ideas.map(e => giverCard(uid, e, 'idea')).join('')}</div>` : `<p class="muted small" style="margin:0">Heard them mention something? Jot it here so you don’t forget.</p>`}
      </section>`;
    wireSort();
    wireGiving(uid);
    if ($('#kid-add')) $('#kid-add').onclick = () => itemSheet({ owner: uid, kind: 'item' });
    view.querySelectorAll('[data-kidedit]').forEach(b => b.onclick = ev => {
      ev.stopPropagation();
      const it = (S.items[uid] || []).find(x => x.id === b.dataset.kidedit);
      if (it) itemSheet({ owner: uid, kind: 'item', entry: it });
    });
    $('#edit-dates').onclick = () => datesSheet(p);
    const tt = $('#toggle-taken');
    if (tt) tt.onclick = () => { ui.showTaken = !ui.showTaken; render(); };
    $('#add-idea').onclick = () => itemSheet({ owner: uid, kind: 'idea' });
  }

  // Set someone's birthday / holidays for them (handy if they never open Settings).
  function datesSheet(p) {
    openSheet(`<div class="sheet-head"><h2>${esc(Dates.possessive(p.name))} dates</h2><button class="btn quiet" data-act="close">Cancel</button></div>
      <p class="hint" style="margin:-8px 0 14px">This updates ${esc(p.name)}’s own settings, so everyone linked to them sees it — and they can change it too.</p>
      <div class="field"><span class="label">Birthday <span class="muted">(year optional)</span></span>${mdPicker('pd-bday', p.birthday, p.birthYear || '')}</div>
      <div class="field"><span class="label">Holidays ${esc(p.name)} gets gifts for</span>${holidayChips(p.holidays || [])}</div>
      <div class="sheet-foot"><button class="btn wide" id="pd-save">Save</button></div>`);
    $('#pd-save').onclick = async () => {
      const birthday = readMD('pd-bday');
      const birthYear = readYear('pd-bday');
      const holidays = [...sheet.querySelectorAll('[name=hol]:checked')].map(x => x.value);
      closeSheet();
      try { await API.savePersonDates(p.uid, { birthday: birthday || p.birthday || '', birthYear, holidays }); toast('Saved'); } catch (e) { oops(e); }
    };
  }

  // #/find/Mom -- opened from the Family Calendar's "wishlist" link on a birthday.
  // Finds that person among your connections (lists load in a moment, so give
  // it a few seconds before giving up and showing People).
  let findStarted = 0;
  function viewFind(name) {
    const q = (name || '').trim().toLowerCase();
    const all = people();
    const p = all.find(x => (x.name || '').trim().toLowerCase() === q)
      || all.find(x => (x.name || '').toLowerCase().split(/\s+/)[0] === q.split(/\s+/)[0])
      || all.find(x => (x.name || '').toLowerCase().includes(q) || q.includes((x.name || '').toLowerCase()));
    if (p) { findStarted = 0; location.replace('#/p/' + encodeURIComponent(p.uid)); return; }
    if (!findStarted) { findStarted = Date.now(); setTimeout(render, 3500); }
    if (Date.now() - findStarted < 3000) { view.innerHTML = '<p class="loading">Finding their wishlist…</p>'; return; }
    // Not found: they're probably not on Wishwell (or not linked with you yet).
    const embed = document.documentElement.classList.contains('embed');
    const g = S.groups[0];
    view.innerHTML = `<div class="card empty" style="margin-top:24px">
      <svg class="mark"><use href="#i-mark"/></svg>
      <h2>${esc(name)} isn’t on Wishwell yet</h2>
      <p>Or you’re not linked with ${esc(name)} yet. Invite them to make a wishlist${g ? ` — they’ll join ${esc(g.name)}` : ''}.</p>
      <button class="btn" id="find-invite">${icon('copy')}Invite ${esc(name)}</button>
      ${embed ? `<p class="hint" style="margin-top:16px">Your calendar’s gift notes still work for ${esc(name)} in the meantime.</p>` : ''}
      <p style="margin:14px 0 0"><a class="linkbtn" href="#/people">Pick from your people instead</a></p>
    </div>`;
    $('#find-invite').onclick = () => (g ? shareCode(g.code, 'group', g.name) : shareCode(S.profile.code, 'person'));
  }

  // ---------- Shopping ----------
  function myClaims() {
    if (!S) return [];
    const out = [];
    for (const owner of Object.keys(S.claims)) {
      if (!S.people[owner]) continue;
      for (const c of S.claims[owner] || []) if (c.by === S.me) out.push({ owner, c });
    }
    return out;
  }
  function viewShopping() {
    const all = myClaims();
    const byOwner = {};
    for (const x of all) (byOwner[x.owner] = byOwner[x.owner] || []).push(x.c);
    const owners = Object.keys(byOwner).sort((a, b) => {
      const ea = nextEvent(S.people[a]), eb = nextEvent(S.people[b]);
      return (ea ? ea.days : 999) - (eb ? eb.days : 999);
    });
    let grand = 0;
    let left = 0;
    let toBuyCount = 0;
    const blocks = owners.map(o => {
      const p = S.people[o];
      const ev = nextEvent(p);
      let total = 0;
      let leftHere = 0;
      const toBuy = [];
      const bought = [];
      const gone = [];
      for (const c of byOwner[o]) {
        const e = (c.kind === 'idea' ? S.ideas[o] || [] : S.items[o] || []).find(x => x.id === c.ref);
        if (!e) {
          gone.push(`<div class="gone"><span>${esc(p.name)} took “${esc(c.name || 'this')}” off their list.</span><button class="btn quiet small" data-drop="${esc(c.id)}" data-owner="${esc(o)}">OK</button></div>`);
          continue;
        }
        total += e.price || 0;
        if (!c.bought) { leftHere += e.price || 0; toBuyCount++; }
        (c.bought ? bought : toBuy).push(giverCard(o, e, c.kind || 'item'));
      }
      grand += total;
      left += leftHere;
      const group = (label, cards) => (cards.length ? `<p class="shop-label">${label}</p><div class="wishes">${cards.join('')}</div>` : '');
      return `<section class="shop-person" data-owner="${esc(o)}">
        <div class="shop-head"><div class="person-main"><a class="person-name" href="#/p/${encodeURIComponent(o)}">${esc(p.name)}</a><br>
          <span class="person-sub">${ev ? `${ev.emoji} ${esc(Dates.title(ev, p.name))} · ${Dates.inWords(ev.days)}` : ''}</span></div>
          ${total ? `<div class="total">about<b>${money(total)}</b>${leftHere && leftHere !== total ? `<span>${money(leftHere)} left to buy</span>` : ''}</div>` : ''}</div>
        ${group('To buy', toBuy)}${group('Bought', bought)}${gone.join('')}</section>`;
    }).join('');
    const sub = all.length
      ? `${all.length} gift${all.length === 1 ? '' : 's'}${toBuyCount ? ` · ${toBuyCount} left to buy` : ' · all bought 🎉'}${grand ? ` · about ${money(grand)}` : ''}`
      : 'Gifts you’ve claimed show up here.';
    view.innerHTML = `<div class="page-head"><div><h1>Shopping</h1><p class="sub">${sub}</p></div></div>
      ${all.length ? blocks + `<p class="hint center">Check <b>Bought</b> once you have it, then tap <b>Given</b> once they’ve opened it to clear it from their list.</p>` : `<div class="card empty"><svg class="mark"><use href="#i-mark"/></svg><h2>Nothing claimed yet</h2>
        <p>When you tap “I’ll get this” on someone’s list, it lands here so you can shop in one place.</p><a class="btn" href="#/people">See people</a></div>`}`;
    view.querySelectorAll('.shop-person').forEach(sec => {
      const o = sec.dataset.owner;
      const find = (id, kind) => (kind === 'idea' ? S.ideas[o] : S.items[o] || []).find(x => x.id === id);
      sec.querySelectorAll('[data-unclaim]').forEach(b => b.onclick = async () => { if (await confirmUndo(o)) API.unclaim(o, b.dataset.unclaim + '_' + S.me).catch(oops); });
      sec.querySelectorAll('[data-given]').forEach(b => b.onclick = async () => {
        const e = find(b.dataset.given, b.dataset.kind);
        if (!e) return;
        const who = S.people[o].name;
        if (!(await ask('Mark as given?', `Only once ${esc(who)} has it in hand. It comes off the list for everyone and shows up in ${esc(Dates.possessive(who))} Received as from you.`, 'Given 🎁'))) return;
        try { await API.given(o, e, b.dataset.kind, myName()); toast('Marked as given 🎁'); } catch (err) { oops(err); }
      });
      sec.querySelectorAll('[data-drop]').forEach(b => b.onclick = () => API.unclaim(o, b.dataset.drop).catch(oops));
      sec.querySelectorAll('[data-bought]').forEach(b => b.onchange = () => API.setBought(o, b.dataset.bought, b.checked).catch(oops));
    });
  }

  // ---------- Settings ----------
  const PALETTES = [
    { key: 'sage', name: 'Sage & cream', sw: ['#F6F3EC', '#E6EADD', '#8A9A7B', '#5E6E51'] },
    { key: 'blue', name: 'Dusty blue & linen', sw: ['#F4F1EB', '#E0E8EE', '#7F9BB0', '#4E6A7F'] },
    { key: 'blush', name: 'Blush & warm gray', sw: ['#F7F2EF', '#F3E3DE', '#CF9F96', '#A26C64'] },
  ];
  const FONTS = [
    { key: 'classic', name: 'Classic', head: "'Fraunces', serif", body: "'Nunito Sans', sans-serif", w: 500, scale: 1 },
    { key: 'elegant', name: 'Elegant', head: "'Cormorant Garamond', serif", body: "'Lato', sans-serif", w: 600, scale: 1.15 },
    { key: 'modern', name: 'Modern', head: "'Outfit', sans-serif", body: "'Outfit', sans-serif", w: 600, scale: 0.95 },
    { key: 'cozy', name: 'Handwritten', head: "'Caveat', cursive", body: "'Nunito Sans', sans-serif", w: 600, scale: 1.3 },
  ];
  // Load every font once Settings opens, so each choice previews in its own style.
  function loadAllFonts() {
    if (document.getElementById('fonts-all')) return;
    const l = document.createElement('link');
    l.id = 'fonts-all';
    l.rel = 'stylesheet';
    const fams = new Set();
    Object.values(window.WW_FONTS || {}).forEach(u => u.split('?')[1].split('&').filter(x => x.startsWith('family=')).forEach(x => fams.add(x)));
    l.href = 'https://fonts.googleapis.com/css2?' + [...fams].join('&') + '&display=swap';
    document.head.appendChild(l);
  }
  const REMIND = [[14, '2 wks'], [7, '1 wk'], [3, '3 days']];
  const customRemind = P => (P.remind || []).find(d => !REMIND.some(([x]) => x === d));
  const pushOn = () => !!ls.get('ww-push', '') && typeof Notification !== 'undefined' && Notification.permission === 'granted';

  function viewSettings() {
    if (isKid()) { viewKidSettings(); return; }
    const P = S.profile;
    const custom = P.custom || [];
    const kids = managedKids();
    view.innerHTML = `<div class="page-head"><div><h1>Settings</h1></div></div>
      <div class="settings"><div class="col">
        <div class="card">
          <h3 style="margin-bottom:14px">About you</h3>
          <div class="field"><label for="st-name">Name</label><input class="input" id="st-name" value="${esc(P.name || '')}"></div>
          <div class="field"><span class="label">Birthday <span class="muted">(year optional)</span></span>${mdPicker('st-bday', P.birthday, P.birthYear || '')}</div>
          <div class="field"><span class="label">Anniversary <span class="muted">(optional)</span></span>${mdPicker('st-anni', P.anniversary)}</div>
          <div class="field"><label for="st-partner">Partner</label>
            <select class="input" id="st-partner"><option value="">—</option>${people().map(p => `<option value="${esc(p.uid)}" ${P.partner === p.uid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
            <p class="hint" style="margin:0">Only your partner sees your anniversary and Valentine’s Day and gets reminders for them.</p></div>
          <div class="field"><span class="label">Holidays you <i>get</i> gifts for</span>${holidayChips(P.holidays || [])}
            <p class="hint" style="margin:0">Only the ones where people shop for <b>you</b> — your family can see these on your list.</p></div>
          <div class="field"><span class="label">Other occasions</span>
            ${custom.map((c, i) => `<div class="list-row"><span class="grow">✨ ${esc(c.name)} · ${Dates.fmtMD(c.md)}</span><button class="btn quiet small" data-rmcustom="${i}">Remove</button></div>`).join('')}
            <button class="btn ghost small" id="st-addcustom" style="justify-self:start">${icon('plus')}Add an occasion</button></div>
          <p class="hint">People linked to you see these dates and get reminders before them.</p>
        </div>
        <div class="card">
          <h3 style="margin-bottom:14px">Fonts</h3>
          <div class="fonts">${FONTS.map(f => `<button class="fontopt ${(P.font || 'classic') === f.key ? 'on' : ''}" data-font="${f.key}">
            <span class="aa" style="font-family:${f.head};font-weight:${f.w};font-size:${Math.round(24 * f.scale)}px">Wishwell</span>
            <small style="font-family:${f.body}">${f.name}</small></button>`).join('')}</div>
        </div>
        <div class="card">
          <h3 style="margin-bottom:14px">Colors</h3>
          <div class="palettes">${PALETTES.map(p => `<button class="pal ${(P.palette || 'sage') === p.key ? 'on' : ''}" data-pal="${p.key}"><span class="sw">${p.sw.map(c => `<i style="background:${c}"></i>`).join('')}</span><b>${p.name}</b></button>`).join('')}</div>
          <p class="hint">Just for you — everyone picks their own.</p>
        </div>
      </div><div class="col">
        <div class="card">
          <h3 style="margin-bottom:6px">Sharing</h3>
          <p class="hint" style="margin:0 0 12px">Your individual code, used to connect 1-to-1 (like with a friend). You’ll see each other’s lists.</p>
          <div class="mycode"><span class="code">${esc(fmtCode(P.code))}</span><button class="edit-btn" id="st-newcode" aria-label="Change my code">${icon('edit')}</button><button class="btn small" id="st-share" style="margin-left:auto">${icon('copy')}Share</button></div>
          <div class="field" style="margin-top:18px"><span class="label">Family groups</span>
            ${S.groups.length ? S.groups.map(g => `<div class="group-row">
              <div class="group-meta"><button class="group-name" data-rename="${esc(g.id)}" aria-label="Rename ${esc(g.name)}">${esc(g.name)}</button>
                <button class="codepill" data-copy="${esc(g.code)}" data-what="${esc(g.name)}" aria-label="Share code">${esc(fmtCode(g.code))}${icon('copy')}</button>
                <button class="edit-btn" data-gcode="${esc(g.id)}" aria-label="Change ${esc(g.name)} code">${icon('edit')}</button>
                <button class="leave-x" data-leave="${esc(g.id)}" aria-label="Leave ${esc(g.name)}" title="Leave group">×</button></div>
              <div class="group-meta"><span>${(g.members || []).length} member${(g.members || []).length === 1 ? '' : 's'}</span></div></div>`).join('') : '<p class="muted small" style="margin:0">None yet.</p>'}
          </div>
          ${S.links.length ? `<div class="field"><span class="label">Linked with you</span>
            ${S.links.map(l => { const o = l.users.find(u => u !== S.me); const p = S.people[o]; return `<div class="list-row"><span class="grow">${esc(p ? p.name : 'Someone')}</span><button class="btn quiet small" data-unlink="${esc(o)}">Unlink</button></div>`; }).join('')}</div>` : ''}
          <div class="row" style="flex-wrap:wrap"><button class="btn soft small" id="st-join">Enter a code</button><button class="btn ghost small" id="st-group">Start a family group</button></div>
        </div>
        <div class="card">
          <h3 style="margin-bottom:6px">Kids</h3>
          <p class="hint" style="margin:0 0 12px">Kids get just their own wishlist, and sign in with a code instead of a password. You can add to or tidy their list from their page.</p>
          ${kids.map(k => `<div class="group-row"><div class="group-meta">
              <a class="group-name" href="#/p/${encodeURIComponent(k.uid)}">${esc(k.name)}</a>
              <button class="codepill" data-kidcode="${esc(k.kidCode || '')}" data-kname="${esc(k.name)}" aria-label="Share ${esc(k.name)}’s kid code">${esc(k.kidCode || '')}${icon('copy')}</button>
              <button class="btn quiet small" data-adult="${esc(k.uid)}" style="margin-left:auto">Switch to adult</button></div></div>`).join('')}
          ${S.groups.length ? `<button class="btn ghost small" id="st-addkid" style="margin-top:${kids.length ? 10 : 0}px">${icon('plus')}Add a kid</button>` : '<p class="muted small" style="margin:0">Start or join a family group first.</p>'}
        </div>
        <div class="card">
          <h3 style="margin-bottom:6px">Reminders</h3>
          <p class="hint" style="margin:0 0 12px">Before birthdays, anniversaries and holidays of the people you’re linked with.</p>
          <label class="switch" style="color:var(--ink)"><input type="checkbox" id="st-push" ${pushOn() ? 'checked' : ''}>Phone notifications on this device</label>
          <p class="status-line" id="st-push-note" style="margin:6px 0 14px">${pushNote()}</p>
          <span class="label">Remind me before each event</span>
          <div class="check-chips one-row" style="margin-top:6px">${REMIND.map(([d, l]) => `<label><input type="checkbox" name="remind" value="${d}" ${(P.remind || []).includes(d) ? 'checked' : ''}><span>${l}</span></label>`).join('')}
            <button type="button" class="chip-btn ${customRemind(P) ? 'on' : ''}" id="st-rcustom">${customRemind(P) ? `${customRemind(P)} day${customRemind(P) === 1 ? '' : 's'}${icon('edit')}` : `${icon('plus')}Custom`}</button></div>
        </div>
        <div class="card">
          <h3 style="margin-bottom:10px">Account</h3>
          <p class="muted small" style="margin:0 0 12px">${esc(user.email || '')}</p>
          ${SAMPLE ? `<div class="field"><label for="st-as">View sample as</label><select class="input" id="st-as">${Demo.people().map(x => `<option value="${x.uid}" ${x.uid === S.me ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
            <button class="btn ghost small" id="st-reset">Reset sample family</button>` : `
            <div class="row" style="flex-wrap:wrap"><button class="btn ghost small" id="st-out">Sign out</button><button class="btn danger small" id="st-delete">Delete account</button></div>`}
        </div>
      </div></div>`;

    const save = patch => API.saveProfile(patch).catch(oops);
    $('#st-name').onchange = e => { const v = e.target.value.trim(); if (v) save({ name: v }); };
    ['st-bday', 'st-anni'].forEach(id => ['m', 'd'].forEach(x => {
      $(`#${id}-${x}`).onchange = () => {
        const md = readMD(id);
        const mEmpty = !$(`#${id}-m`).value && !$(`#${id}-d`).value;
        if (md || mEmpty) save(id === 'st-bday' ? { birthday: md } : { anniversary: md });
      };
    }));
    $('#st-bday-y').onchange = () => save({ birthYear: readYear('st-bday') });
    $('#st-partner').onchange = e => save({ partner: e.target.value });
    view.querySelectorAll('[name=hol]').forEach(c => c.onchange = () => save({ holidays: [...view.querySelectorAll('[name=hol]:checked')].map(x => x.value) }));
    const presets = () => [...view.querySelectorAll('[name=remind]:checked')].map(x => Number(x.value));
    view.querySelectorAll('[name=remind]').forEach(c => c.onchange = () => { const cu = customRemind(P); save({ remind: presets().concat(cu ? [cu] : []) }); });
    $('#st-rcustom').onclick = () => {
      const cu = customRemind(P);
      openSheet(`<div class="sheet-head"><h2>Custom reminder</h2><button class="btn quiet" data-act="close">Cancel</button></div>
        <div class="field"><label for="rc-days">How many days before each event?</label>
          <input class="input" id="rc-days" type="number" inputmode="numeric" min="1" max="90" value="${cu || 10}"></div>
        <div class="sheet-foot"><button class="btn wide" id="rc-save">Save</button>${cu ? '<button class="btn danger" id="rc-off">Turn off</button>' : ''}</div>`);
      setTimeout(() => $('#rc-days').select(), 60);
      const pre = presets();
      $('#rc-save').onclick = () => {
        const n = Math.round(Number($('#rc-days').value));
        if (!(n >= 1 && n <= 90)) { toast('Pick 1 to 90 days'); return; }
        closeSheet();
        save({ remind: [...new Set(pre.concat([n]))] });
      };
      const off = $('#rc-off');
      if (off) off.onclick = () => { closeSheet(); save({ remind: pre }); };
    };
    view.querySelectorAll('[data-rmcustom]').forEach(b => b.onclick = () => save({ custom: custom.filter((_, i) => i !== Number(b.dataset.rmcustom)) }));
    $('#st-addcustom').onclick = () => {
      openSheet(`<div class="sheet-head"><h2>Add an occasion</h2><button class="btn quiet" data-act="close">Cancel</button></div>
        <div class="field"><label for="c-name">What is it?</label><input class="input" id="c-name" placeholder="e.g. Graduation, Name day"></div>
        <div class="field"><span class="label">Date (every year)</span>${mdPicker('c-md', '')}</div>
        <div class="sheet-foot"><button class="btn wide" id="c-go">Add</button></div>`);
      $('#c-go').onclick = () => {
        const name = $('#c-name').value.trim();
        const md = readMD('c-md');
        if (!name || !md) { toast('Add a name and a date'); return; }
        closeSheet();
        save({ custom: custom.concat([{ name, md }]) });
      };
    };
    view.querySelectorAll('[data-pal]').forEach(b => b.onclick = () => { applyPalette(b.dataset.pal); save({ palette: b.dataset.pal }); });
    loadAllFonts();
    view.querySelectorAll('[data-font]').forEach(b => b.onclick = () => { applyFont(b.dataset.font); save({ font: b.dataset.font }); });
    $('#st-share').onclick = () => shareCode(P.code, 'person');
    $('#st-newcode').onclick = () => codeSheet('Change my code', P.code,
      'Your old code stops working. People already linked with you stay linked.', c => API.newPersonalCode(c));
    view.querySelectorAll('[data-gcode]').forEach(b => b.onclick = () => {
      const g = S.groups.find(x => x.id === b.dataset.gcode);
      codeSheet(`${g.name} code`, g.code, 'The old code stops working. Everyone already in the group stays in.', c => API.changeGroupCode(g.id, c));
    });
    wireCopy();
    view.querySelectorAll('[data-leave]').forEach(b => b.onclick = async () => {
      const g = S.groups.find(x => x.id === b.dataset.leave);
      if (!(await ask(`Leave ${esc(g.name)}?`, 'You’ll stop seeing their lists (and they’ll stop seeing yours) unless you’re linked another way. You can rejoin with the code.', 'Leave', { danger: true }))) return;
      API.leaveGroup(g.id).catch(oops);
    });
    view.querySelectorAll('[data-rename]').forEach(b => b.onclick = async () => {
      const g = S.groups.find(x => x.id === b.dataset.rename);
      const name = await ask('Rename group', '', 'Save', { input: 'text', placeholder: g.name });
      if (name && name.trim()) API.renameGroup(g.id, name.trim()).catch(oops);
    });
    view.querySelectorAll('[data-unlink]').forEach(b => b.onclick = async () => {
      const p = S.people[b.dataset.unlink];
      if (!(await ask(`Unlink ${esc(p ? p.name : '')}?`, 'You’ll stop seeing each other’s lists (unless you share a family group).', 'Unlink', { danger: true }))) return;
      API.unlink(b.dataset.unlink).catch(oops);
    });
    $('#st-join').onclick = joinSheet;
    $('#st-group').onclick = groupSheet;
    if ($('#st-addkid')) $('#st-addkid').onclick = kidSheet;
    view.querySelectorAll('[data-kidcode]').forEach(b => b.onclick = () => shareKidCode(b.dataset.kidcode, b.dataset.kname));
    view.querySelectorAll('[data-adult]').forEach(b => b.onclick = async () => {
      const k = S.people[b.dataset.adult];
      if (!(await ask(`Switch ${esc(k.name)} to adult view?`, `${esc(k.name)} will get the full app — family lists, shopping and gift ideas — and set up their own email and password next time they open Wishwell. This can’t be switched back.`, 'Switch'))) return;
      API.setKidAdult(k.uid).then(() => toast(`${k.name} is all grown up 🎉`)).catch(oops);
    });
    $('#st-push').onchange = e => (e.target.checked ? turnOnPush() : turnOffPush());
    if (SAMPLE) {
      $('#st-as').onchange = e => Demo.viewAs(e.target.value);
      $('#st-reset').onclick = async () => { if (await ask('Reset the sample family?', 'Puts all the pretend lists back the way they started.', 'Reset')) Demo.reset(); };
    } else {
      $('#st-out').onclick = () => API.signOut();
      $('#st-delete').onclick = async () => {
        const pw = await ask('Delete your account?', 'Your list, history and codes are erased for good. Type your password to confirm.', 'Delete forever', { danger: true, input: 'password', placeholder: 'Password' });
        if (!pw) return;
        try { await API.deleteAccount(pw); toast('Account deleted'); } catch (e) { oops(e.code ? { message: niceAuth(e) } : e); }
      };
    }
  }

  function codeSheet(title, current, note, saveFn) {
    openSheet(`<div class="sheet-head"><h2>${esc(title)}</h2><button class="btn quiet" data-act="close">Cancel</button></div>
      <div class="field"><input class="input" id="pc-code" autocapitalize="characters" autocomplete="off" value="${esc(current || '')}" aria-label="Code" style="text-transform:uppercase;letter-spacing:.06em;font-size:20px">
        <p class="hint" style="margin:0">Letters and numbers, 3–20. ${esc(note)}</p></div>
      <p class="err" id="pc-err" hidden></p>
      <div class="sheet-foot"><button class="btn wide" id="pc-save">Save</button><button class="btn ghost" id="pc-random">Random</button></div>`);
    setTimeout(() => $('#pc-code').select(), 60);
    const go = async custom => {
      try { await saveFn(custom); closeSheet(); toast('Code changed'); }
      catch (e) { const er = $('#pc-err'); er.hidden = false; er.textContent = e.message || 'That didn’t work.'; }
    };
    $('#pc-save').onclick = () => go($('#pc-code').value.trim());
    $('#pc-random').onclick = () => go('');
  }

  // ---------- kids ----------
  function kidSheet() {
    openSheet(`<div class="sheet-head"><h2>Add a kid</h2><button class="btn quiet" data-act="close">Cancel</button></div>
      <input class="input" id="kd-name" aria-label="Name" placeholder="Their name">
      <div class="field tight"><span class="label">Birthday <span class="muted">(year optional)</span></span>${mdPicker('kd-bday', '', '')}</div>
      ${S.groups.length > 1 ? `<div class="field"><label for="kd-group">Family group</label><select class="input" id="kd-group">${S.groups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select></div>` : ''}
      <p class="err" id="kd-err" hidden></p>
      <div class="sheet-foot"><button class="btn wide" id="kd-go">Add</button></div>`);
    setTimeout(() => $('#kd-name').focus(), 60);
    $('#kd-go').onclick = async () => {
      const name = $('#kd-name').value.trim();
      if (!name) { toast('Add their name'); return; }
      const gid = $('#kd-group') ? $('#kd-group').value : S.groups[0].id;
      $('#kd-go').disabled = true;
      try {
        const code = await API.addKid({ name, birthday: readMD('kd-bday'), birthYear: readYear('kd-bday'), gid });
        openSheet(`<div class="sheet-head"><h2>${esc(name)} is in! 🎉</h2><button class="btn quiet" data-act="close">Done</button></div>
          <p class="muted">On ${esc(Dates.possessive(name))} phone: open Wishwell, tap <b>I have a kid code</b>, and type this in. It works on any phone, any time.</p>
          <div class="mycode"><span class="code">${esc(code)}</span><button class="btn small" id="kd-share" style="margin-left:auto">${icon('copy')}Share</button></div>`);
        $('#kd-share').onclick = () => shareKidCode(code, name);
      } catch (e) { $('#kd-go').disabled = false; const er = $('#kd-err'); er.hidden = false; er.textContent = e.message || 'That didn’t work.'; }
    };
  }
  async function shareKidCode(code, name) {
    const text = `${Dates.possessive(name)} Wishwell kid code: ${code}\nOpen ${appURL()} and tap “I have a kid code.”`;
    if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch (e) { tell('Kid code', esc(code)); }
  }
  // Kids' settings: their name and how the app looks.
  function viewKidSettings() {
    const P = S.profile;
    view.innerHTML = `<div class="page-head"><div><h1>Settings</h1></div></div>
      <div class="settings"><div class="col">
        <div class="card"><div class="field"><label for="st-name">Your name</label><input class="input" id="st-name" value="${esc(P.name || '')}"></div></div>
        <div class="card"><h3 style="margin-bottom:14px">Fonts</h3>
          <div class="fonts">${FONTS.map(f => `<button class="fontopt ${(P.font || 'classic') === f.key ? 'on' : ''}" data-font="${f.key}">
            <span class="aa" style="font-family:${f.head};font-weight:${f.w};font-size:${Math.round(24 * f.scale)}px">Wishwell</span>
            <small style="font-family:${f.body}">${f.name}</small></button>`).join('')}</div></div>
      </div><div class="col">
        <div class="card"><h3 style="margin-bottom:14px">Colors</h3>
          <div class="palettes">${PALETTES.map(p => `<button class="pal ${(P.palette || 'sage') === p.key ? 'on' : ''}" data-pal="${p.key}"><span class="sw">${p.sw.map(c => `<i style="background:${c}"></i>`).join('')}</span><b>${p.name}</b></button>`).join('')}</div></div>
        <div class="card">
          ${SAMPLE ? `<div class="field"><label for="st-as">View sample as</label><select class="input" id="st-as">${Demo.people().map(x => `<option value="${x.uid}" ${x.uid === S.me ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>`
            : '<button class="btn ghost small" id="st-out">Sign out</button>'}
        </div>
      </div></div>`;
    const save = patch => API.saveProfile(patch).catch(oops);
    $('#st-name').onchange = e => { const v = e.target.value.trim(); if (v) save({ name: v }); };
    loadAllFonts();
    view.querySelectorAll('[data-font]').forEach(b => b.onclick = () => { applyFont(b.dataset.font); save({ font: b.dataset.font }); });
    view.querySelectorAll('[data-pal]').forEach(b => b.onclick = () => { applyPalette(b.dataset.pal); save({ palette: b.dataset.pal }); });
    if (SAMPLE) $('#st-as').onchange = e => Demo.viewAs(e.target.value);
    else $('#st-out').onclick = () => API.signOut();
  }

  // ---------- phone notifications ----------
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  function pushNote() {
    if (pushOn()) return '<span class="good">On — you’ll get reminders here.</span>';
    if (isIOS() && !standalone()) return 'On iPhone, add Wishwell to your Home Screen first (Share → Add to Home Screen), then turn this on from there.';
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') return 'Notifications are blocked for Wishwell in this browser’s settings.';
    return 'Off';
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('Couldn’t load notifications — check your connection.'));
      document.head.appendChild(s);
    });
  }
  async function turnOnPush() {
    const box = $('#st-push');
    const note = $('#st-push-note');
    const undo = msg => { box.checked = false; note.innerHTML = msg || pushNote(); };
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
      if (isIOS() && !standalone()) {
        undo();
        tell('Add to Home Screen first', 'iPhone only allows notifications for apps on your Home Screen. In Safari tap <b>Share</b> → <b>Add to Home Screen</b>, open Wishwell from there, and turn this on again.');
      } else undo('This browser can’t do notifications.');
      return;
    }
    if (SAMPLE) { undo('Sample mode — notifications work once Wishwell is connected.'); return; }
    try {
      note.textContent = 'Turning on…';
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { undo(); tell('Notifications are off', 'To allow them: iPhone Settings → Notifications → Wishwell → Allow Notifications.'); return; }
      await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
      const reg = await navigator.serviceWorker.ready;
      const token = await firebase.messaging().getToken({ serviceWorkerRegistration: reg });
      if (!token) throw new Error('No token');
      await API.addToken(token);
      ls.set('ww-push', token);
      note.innerHTML = pushNote();
      toast('Notifications on 🔔');
    } catch (e) { console.error(e); undo('Couldn’t turn on notifications — try again in a moment.'); }
  }
  async function turnOffPush() {
    const token = ls.get('ww-push', '');
    ls.set('ww-push', null);
    $('#st-push-note').innerHTML = pushNote();
    if (!token || SAMPLE) return;
    try {
      await API.removeToken(token);
      await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
      await firebase.messaging().deleteToken();
    } catch (e) { console.warn(e); }
  }
})();
