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
  API.onUser(u => {
    user = u;
    if (!u) { S = null; API.stop(); renderWelcome(); return; }
    view.innerHTML = '<p class="loading">Loading…</p>';
    API.start(s => { S = s; render(); });
  });
  window.addEventListener('hashchange', () => { ui.showTaken = false; render(); window.scrollTo(0, 0); });
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
    $('#top').hidden = false;
    const r = route();
    renderTabs(r.name);
    const screens = { list: viewList, received: viewReceived, people: viewPeople, p: viewPerson, shopping: viewShopping, settings: viewSettings };
    (screens[r.name] || viewList)(r.arg);
    renderBanner();
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
    const mine = myClaims().length;
    const tabs = [
      ['list', 'gift', 'My list'],
      ['people', 'people', 'People'],
      ['shopping', 'bag', 'Shopping', mine],
    ];
    const cur = on === 'received' ? 'list' : on === 'p' ? 'people' : on;
    $('#tabs').innerHTML = tabs.map(([k, ic, label, n]) =>
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
    $('#banner').hidden = true;
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
    </div>`;
    $('#a-switch').onclick = () => renderWelcome(up ? 'in' : 'up');
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
    view.innerHTML = `<div class="welcome">
      <svg class="brand-mark" aria-hidden="true"><use href="#i-mark"/></svg>
      <h1>Welcome!</h1>
      <p class="tagline">A couple of things so your people know when to shop.</p>
      <form class="card" id="setup">
        <div class="field"><label for="s-name">Your name</label><input class="input" id="s-name" value="${esc(signUpName || user.name || '')}" required></div>
        <div class="field"><span class="label">Your birthday</span>${mdPicker('s-bday', '')}</div>
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
          name, birthday: readMD('s-bday'), anniversary: '', custom: [],
          holidays: [...view.querySelectorAll('[name=hol]:checked')].map(x => x.value),
          remind: [14, 7], palette: ls.get('ww-palette', 'sage'),
        });
        location.hash = '#/people';
      } catch (err) { oops(err); }
    };
  }

  function mdPicker(id, md) {
    const [m, d] = Dates.valid(md) ? md.split('-').map(Number) : [0, 0];
    return `<div class="md">
      <select class="input" id="${id}-m" aria-label="Month"><option value="">Month</option>${Dates.MONTHS.map((n, i) => `<option value="${i + 1}" ${m === i + 1 ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <select class="input" id="${id}-d" aria-label="Day"><option value="">Day</option>${Array.from({ length: 31 }, (_, i) => `<option ${d === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>
    </div>`;
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
      <div class="page-head"><div><h1>My wish list</h1>
        <p class="sub">${items.length ? `${items.length} wish${items.length === 1 ? '' : 'es'} · ` : ''}${n ? `${n} ${n === 1 ? 'person' : 'people'} can see it` : 'No one linked yet'}</p></div>
        <button class="btn" id="add">${icon('plus')}Add a wish</button></div>
      ${items.length ? `<div class="toolbar">${sortPick()}</div><div class="wishes">${items.map(ownerCard).join('')}</div>` : `
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
      <div class="sheet-head"><h2>${e.id ? (isIdea ? 'Edit idea' : 'Edit wish') : (isIdea ? `Gift idea for ${esc(ownerName)}` : 'Add a wish')}</h2>
        <button class="btn quiet" data-act="close">Cancel</button></div>
      ${isIdea ? `<p class="secret-note">${icon('lock')}<span>${esc(ownerName)} will never see this.</span></p>` : ''}
      <div class="field"><label for="f-link">Link <span class="muted">(optional)</span></label>
        <div class="row"><input class="input grow" id="f-link" type="url" inputmode="url" placeholder="Paste a store link" value="${esc(e.link || '')}">
        <button class="btn soft small" id="f-fill" type="button">Fill in</button></div>
        <div class="fill-note" id="f-note"></div></div>
      <div class="field"><label for="f-name">${isIdea ? 'Idea' : 'What is it?'}</label><input class="input" id="f-name" value="${esc(e.name || '')}" placeholder="${isIdea ? 'e.g. A new grill' : 'e.g. Cozy slippers'}"></div>
      <div class="field"><span class="label">Photo <span class="muted">(optional)</span></span>
        <div class="photo-pick"><span id="f-photo">${thumb({ photo, name: e.name || '+' })}</span>
          <div class="row"><button class="btn ghost small" id="f-upload" type="button">${icon('photo')}Choose</button>
          <button class="btn ghost small" id="f-paste" type="button">Paste</button>
          <button class="btn quiet small" id="f-nophoto" type="button" ${photo ? '' : 'hidden'}>Remove</button></div></div></div>
      <div class="row" style="gap:12px;align-items:flex-start">
        <div class="field grow"><label for="f-price">Price <span class="muted">(optional)</span></label><input class="input" id="f-price" inputmode="decimal" placeholder="$" value="${e.price != null ? esc(e.price) : ''}"></div>
        <div class="field grow"><label for="f-store">Store <span class="muted">(optional)</span></label><input class="input" id="f-store" value="${esc(e.store || '')}"></div>
      </div>
      <div class="field"><label for="f-notes">Notes <span class="muted">(size, color…)</span></label><textarea class="input" id="f-notes" rows="2">${esc(e.notes || '')}</textarea></div>
      ${isIdea ? `<div class="field"><label for="f-scope">Who can see this idea</label><select class="input" id="f-scope">
          ${groups.map(g => `<option value="${esc(g.id)}" ${scope === g.id ? 'selected' : ''}>${esc(g.name)} (not ${esc(ownerName)})</option>`).join('')}
          <option value="me" ${scope === 'me' ? 'selected' : ''}>Just me</option></select></div>` : `
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <button class="star-toggle ${star ? 'on' : ''}" id="f-star" type="button">${icon('star')}Really want</button>
        <div class="row"><span class="label">How many</span><span class="stepper"><button type="button" id="f-minus" aria-label="Fewer">−</button><span id="f-qty">${qty}</span><button type="button" id="f-plus" aria-label="More">+</button></span></div>
      </div>`}
      <div class="sheet-foot"><button class="btn wide" id="f-save">${e.id ? 'Save' : (isIdea ? 'Add idea' : 'Add to my list')}</button></div>
      ${e.id && !isIdea ? `<div class="sheet-foot"><button class="btn soft wide" id="f-got">${icon('check')}I got this</button><button class="btn danger" id="f-del">Delete</button></div>` : ''}
      ${e.id && isIdea && canDelete ? `<div class="sheet-foot"><button class="btn danger wide" id="f-del">Delete idea</button></div>` : ''}
    `);

    const note = (msg, good) => { const n = $('#f-note'); n.textContent = msg; n.className = 'fill-note' + (good ? ' good' : ''); };
    const setPhoto = p => {
      photo = p || '';
      $('#f-photo').innerHTML = thumb({ photo, name: $('#f-name').value || '+' });
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
          await API.saveIdea(ctx.owner, cleanEntry({ ...base, id: e.id, scope: $('#f-scope').value, by: e.by || S.me, byName: e.byName || myName(), at: e.at || Date.now() }), e.id ? e : null);
        } else {
          await API.saveItem(cleanEntry({ ...base, id: e.id, star, qty, createdAt: e.createdAt || Date.now() }));
        }
        closeSheet();
        toast(e.id ? 'Saved' : isIdea ? 'Idea added' : 'Added to your list');
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
      try { if (isIdea) await API.deleteIdea(ctx.owner, e); else await API.deleteItem(e.id); toast('Deleted'); } catch (err) { oops(err); }
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
    const bday = Dates.valid(p.birthday) ? Dates.fmtMD(p.birthday) : '';
    return `<a class="person-row" href="#/p/${encodeURIComponent(p.uid)}">
      <span class="pr-name">${esc(p.name)}</span>
      <span class="pr-next">${bday ? `🎂 ${bday}` : 'No birthday yet'}</span>
      <span class="chev">›</span></a>`;
  }

  function viewPeople() {
    const ups = upcoming();
    const friends = S.links.map(l => S.people[l.users.find(u => u !== S.me)]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    const groups = S.groups.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const nobody = !groups.length && !S.links.length;
    view.innerHTML = `
      <div class="page-head"><div><h1>People</h1><p class="sub">Tap someone to see their list.</p></div></div>
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
      status = `<span class="status mine">${icon('check')}You’re getting this</span>`;
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
    return `<article class="wish ${full && !mine ? 'taken' : ''} ${editable ? 'tap' : ''}" ${editable ? `data-editidea="${esc(e.id)}"` : ''}>
      <div class="wish-top">${thumb(e)}<div class="wish-body">
        <div class="wish-name">${esc(e.name || 'Untitled')}</div>${metaLine(e)}
        ${e.notes ? `<div class="wish-notes">${esc(e.notes)}</div>` : ''}
        ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
      </div></div>
      <div class="wish-foot">${status}${linkOut(e)}<div class="acts">${acts}</div></div>
    </article>`;
  }

  function wireGiving(owner) {
    const find = (id, kind) => (kind === 'idea' ? S.ideas[owner] : S.items[owner] || []).find(x => x.id === id);
    view.querySelectorAll('[data-claim]').forEach(b => b.onclick = async ev => {
      ev.stopPropagation();
      const e = find(b.dataset.claim, b.dataset.kind);
      if (!e) return;
      const who = S.people[owner] ? S.people[owner].name : 'they';
      try { await API.claim(owner, e.id, b.dataset.kind, e, myName()); toast(`You’re getting this! Others will see it’s taken so no one doubles up — ${who} won’t see it. Find it in Shopping.`, 5000); } catch (err) { oops(err); }
    });
    view.querySelectorAll('[data-unclaim]').forEach(b => b.onclick = async ev => {
      ev.stopPropagation();
      try { await API.unclaim(owner, b.dataset.unclaim + '_' + S.me); } catch (err) { oops(err); }
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
    const whoSees = groups.length ? `Only ${groups.map(g => esc(g.name)).join(' and ')} can see these — never ${esc(p.name)}.` : `Only you can see ideas you add here — ${esc(p.name)} can’t.`;
    view.innerHTML = `<a class="back" href="#/people">${icon('back')}People</a>
      <div class="person-head"><div><h1>${esc(p.name)}</h1><p class="sub muted" style="margin:2px 0 0">${esc(circleWords(uid))}</p></div></div>
      <div class="event-tiles">${evs.map(ev => `<div class="event-tile ${ev.days <= 14 ? 'soon' : ''}"><span class="et-emoji">${ev.emoji}</span><span class="et-name">${esc(ev.name)}</span><span class="et-date">${Dates.fmt(ev.date)}</span><span class="et-when">${Dates.inWords(ev.days)}</span></div>`).join('')}
        <button class="event-tile add" id="edit-dates">${icon(evs.length ? 'edit' : 'plus')}<span class="et-name">${evs.length ? 'Edit dates' : 'Add dates'}</span></button></div>
      <div class="section-title" style="margin-top:6px;align-items:center"><h2>${esc(Dates.possessive(p.name))} wishes</h2>${(S.items[uid] || []).length > 1 ? sortPick() : ''}</div>
      ${items.length ? `<div class="wishes">${items.map(e => giverCard(uid, e, 'item')).join('')}</div>` : `<div class="card empty" style="padding:28px 20px"><p style="margin:0">${(S.items[uid] || []).length ? 'Everything on this list has been claimed.' : `${esc(p.name)} hasn’t added any wishes yet.`}</p></div>`}
      ${taken ? `<p class="center" style="margin:14px 0 0"><button class="linkbtn quiet-link" id="toggle-taken">${ui.showTaken ? 'Hide claimed' : `${taken} claimed — show`}</button></p>` : ''}
      <section class="secret">
        <div class="section-title"><h2>Gift ideas for ${esc(p.name)}</h2><button class="btn soft small" id="add-idea">${icon('plus')}Add</button></div>
        <p class="secret-note">${icon('lock')}<span>${whoSees}</span></p>
        ${ideas.length ? `<div class="wishes">${ideas.map(e => giverCard(uid, e, 'idea')).join('')}</div>` : `<p class="muted small" style="margin:0">Heard them mention something? Jot it here so you don’t forget.</p>`}
      </section>`;
    wireSort();
    wireGiving(uid);
    $('#edit-dates').onclick = () => datesSheet(p);
    const tt = $('#toggle-taken');
    if (tt) tt.onclick = () => { ui.showTaken = !ui.showTaken; render(); };
    $('#add-idea').onclick = () => itemSheet({ owner: uid, kind: 'idea' });
  }

  // Set someone's birthday / holidays for them (handy if they never open Settings).
  function datesSheet(p) {
    openSheet(`<div class="sheet-head"><h2>${esc(Dates.possessive(p.name))} dates</h2><button class="btn quiet" data-act="close">Cancel</button></div>
      <p class="hint" style="margin:-8px 0 14px">This updates ${esc(p.name)}’s own settings, so everyone linked to them sees it — and they can change it too.</p>
      <div class="field"><span class="label">Birthday</span>${mdPicker('pd-bday', p.birthday)}</div>
      <div class="field"><span class="label">Holidays ${esc(p.name)} gets gifts for</span>${holidayChips(p.holidays || [])}</div>
      <div class="sheet-foot"><button class="btn wide" id="pd-save">Save</button></div>`);
    $('#pd-save').onclick = async () => {
      const birthday = readMD('pd-bday');
      const holidays = [...sheet.querySelectorAll('[name=hol]:checked')].map(x => x.value);
      closeSheet();
      try { await API.savePersonDates(p.uid, { birthday: birthday || p.birthday || '', holidays }); toast('Saved'); } catch (e) { oops(e); }
    };
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
    const blocks = owners.map(o => {
      const p = S.people[o];
      const ev = nextEvent(p);
      let total = 0;
      const cards = byOwner[o].map(c => {
        const e = (c.kind === 'idea' ? S.ideas[o] || [] : S.items[o] || []).find(x => x.id === c.ref);
        if (!e) {
          return `<div class="gone"><span>${esc(p.name)} took “${esc(c.name || 'this')}” off their list.</span><button class="btn quiet small" data-drop="${esc(c.id)}" data-owner="${esc(o)}">OK</button></div>`;
        }
        total += e.price || 0;
        return giverCard(o, e, c.kind || 'item');
      }).join('');
      grand += total;
      return `<section class="shop-person" data-owner="${esc(o)}">
        <div class="shop-head"><div class="person-main"><a class="person-name" href="#/p/${encodeURIComponent(o)}">${esc(p.name)}</a><br>
          <span class="person-sub">${ev ? `${ev.emoji} ${esc(Dates.title(ev, p.name))} · ${Dates.inWords(ev.days)}` : ''}</span></div>
          ${total ? `<div class="total">about<b>${money(total)}</b></div>` : ''}</div>
        <div class="wishes">${cards}</div></section>`;
    }).join('');
    view.innerHTML = `<div class="page-head"><div><h1>Shopping</h1><p class="sub">${all.length ? `${all.length} gift${all.length === 1 ? '' : 's'} you’re getting${grand ? ` · about ${money(grand)}` : ''}` : 'Gifts you’ve claimed show up here.'}</p></div></div>
      ${all.length ? blocks + `<p class="hint center">Tap <b>Given</b> once they’ve opened it to clear it from their list.</p>` : `<div class="card empty"><svg class="mark"><use href="#i-mark"/></svg><h2>Nothing claimed yet</h2>
        <p>When you tap “I’ll get this” on someone’s list, it lands here so you can shop in one place.</p><a class="btn" href="#/people">See people</a></div>`}`;
    view.querySelectorAll('.shop-person').forEach(sec => {
      const o = sec.dataset.owner;
      const find = (id, kind) => (kind === 'idea' ? S.ideas[o] : S.items[o] || []).find(x => x.id === id);
      sec.querySelectorAll('[data-unclaim]').forEach(b => b.onclick = () => API.unclaim(o, b.dataset.unclaim + '_' + S.me).catch(oops));
      sec.querySelectorAll('[data-given]').forEach(b => b.onclick = async () => {
        const e = find(b.dataset.given, b.dataset.kind);
        if (!e) return;
        const who = S.people[o].name;
        if (!(await ask('Mark as given?', `Only once ${esc(who)} has it in hand. It comes off the list for everyone and shows up in ${esc(Dates.possessive(who))} Received as from you.`, 'Given 🎁'))) return;
        try { await API.given(o, e, b.dataset.kind, myName()); toast('Marked as given 🎁'); } catch (err) { oops(err); }
      });
      sec.querySelectorAll('[data-drop]').forEach(b => b.onclick = () => API.unclaim(o, b.dataset.drop).catch(oops));
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
    const P = S.profile;
    const custom = P.custom || [];
    view.innerHTML = `<div class="page-head"><div><h1>Settings</h1></div></div>
      <div class="settings"><div class="col">
        <div class="card">
          <h3 style="margin-bottom:14px">About you</h3>
          <div class="field"><label for="st-name">Name</label><input class="input" id="st-name" value="${esc(P.name || '')}"></div>
          <div class="field"><span class="label">Birthday</span>${mdPicker('st-bday', P.birthday)}</div>
          <div class="field"><span class="label">Anniversary <span class="muted">(optional)</span></span>${mdPicker('st-anni', P.anniversary)}</div>
          <div class="field"><label for="st-partner">Partner</label>
            <select class="input" id="st-partner"><option value="">No one</option>${people().map(p => `<option value="${esc(p.uid)}" ${P.partner === p.uid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
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
          <p class="hint" style="margin:0 0 12px">Your code shares just your list with one person (and theirs with you).</p>
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
