/* Paste a store link -> fill in what we can.

   Asks Microlink (free plan, no account, no card: about 25 lookups a day per
   network; past that it just says no until tomorrow, never charges). Big stores
   (Amazon, Target, Walmart...) often block it, so the product name is also read
   out of the link itself, e.g. target.com/p/stanley-40oz-quencher-tumbler/-/A-123
   -> "Stanley 40oz Quencher Tumbler". Everything stays editable. */

const Lookup = (() => {
  const JUNK = /access denied|robot|captcha|just a moment|attention required|page not found|not found|sign in|are you a human|blocked|error/i;
  const STORES = {
    amazon: 'Amazon', target: 'Target', walmart: 'Walmart', etsy: 'Etsy', ulta: 'Ulta', sephora: 'Sephora',
    lululemon: 'Lululemon', barnesandnoble: 'Barnes & Noble', kohls: 'Kohl’s', nordstrom: 'Nordstrom',
    homedepot: 'Home Depot', lowes: 'Lowe’s', bestbuy: 'Best Buy', costco: 'Costco', oldnavy: 'Old Navy',
    gap: 'Gap', anthropologie: 'Anthropologie', potterybarn: 'Pottery Barn', williamssonoma: 'Williams Sonoma',
    crateandbarrel: 'Crate & Barrel', wayfair: 'Wayfair', apple: 'Apple', nike: 'Nike', rei: 'REI',
    tjmaxx: 'TJ Maxx', marshalls: 'Marshalls', hobbylobby: 'Hobby Lobby', michaels: 'Michaels', dickssportinggoods: 'Dick’s',
  };
  const SKIP = new Set(['p', 'dp', 'ip', 'gp', 'product', 'products', 'w', 'en-us', 'us', 'shop', 'listing', 'item', 'itm', 'pd', 'b', 's']);

  function parse(url) { try { return new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url); } catch (e) { return null; } }

  function storeName(u) {
    const parts = u.hostname.replace(/^www\.|^m\./, '').split('.');
    const main = parts.length > 2 && parts[parts.length - 2].length <= 3 ? parts[parts.length - 3] : parts[parts.length - 2] || parts[0];
    return STORES[main] || (main ? main.charAt(0).toUpperCase() + main.slice(1) : '');
  }

  // Longest wordy piece of the path, turned back into words.
  function nameFromLink(u) {
    let best = '';
    for (let seg of u.pathname.split('/')) {
      seg = decodeURIComponent(seg).replace(/\.(html?|aspx|php)$/i, '');
      if (!seg || SKIP.has(seg.toLowerCase())) continue;
      const words = seg.split(/[-_+]+/).filter(w => (/[a-z]/i.test(w) || /^\d{1,2}$/.test(w)) && !/^(prod|pimprod|sku|a)?\d{3,}$/i.test(w) && !(w.length > 3 && /^[a-z]?\d+[a-z]*\d+$/i.test(w)));
      if (words.filter(w => /[a-z]/i.test(w)).length < 2) continue;
      const s = words.join(' ');
      if (s.length > best.length) best = s;
    }
    if (!best) return '';
    return best.replace(/\b([a-z])/g, (m, c) => c.toUpperCase()).slice(0, 120);
  }

  function cleanTitle(t, store) {
    t = (t || '').replace(/\s+/g, ' ').trim();
    t = t.replace(/^amazon\.com\s*:\s*/i, '').replace(/\s*:\s*[^:]{2,40}$/, m => (/amazon/i.test(store) ? '' : m));
    // drop a trailing " | Store" / " - Store" (but keep things like " - Jet Black")
    t = t.replace(/\s+[|–—-]\s+([^|–—-]{2,40})$/, (m, tail) => (store && tail.toLowerCase().replace(/\W/g, '').includes(store.toLowerCase().replace(/\W/g, '')) || /official|online|shop|store/i.test(tail) ? '' : m));
    return t.slice(0, 120).trim();
  }

  // -> { name, photo, store, link, found, limited }
  async function lookup(raw) {
    const u = parse(raw.trim());
    if (!u) return { found: false };
    const out = { link: u.href, store: storeName(u), name: nameFromLink(u), photo: '' };
    try {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => ctl && ctl.abort(), 12000);
      const r = await fetch('https://api.microlink.io/?url=' + encodeURIComponent(u.href), ctl ? { signal: ctl.signal } : {});
      clearTimeout(timer);
      if (r.status === 429) out.limited = true;
      const j = await r.json().catch(() => ({}));
      if (j.status === 'success' && j.data) {
        const d = j.data;
        const lastSeg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
        const t = cleanTitle(d.title, out.store);
        const good = t && !JUNK.test(t) && t.toLowerCase() !== out.store.toLowerCase()
          && t !== lastSeg && !/^[\w.-]+$/.test(t) && /\s/.test(t);
        if (good) {
          out.name = t;
          const img = d.image && d.image.url;
          if (img && !/logo|sprite|icon|placeholder|\.svg(\?|$)/i.test(img)) out.photo = img;
        }
        if (d.publisher && !/\./.test(d.publisher) && d.publisher.length < 30) out.store = d.publisher.replace(/\.com$/i, '');
      } else if (/rate|limit/i.test(j.message || '') || j.code === 'ERATE') out.limited = true;
    } catch (e) { /* offline or timed out -- the link-only guess still stands */ }
    out.found = !!(out.name || out.photo);
    return out;
  }

  return { lookup, storeName: raw => { const u = parse(raw); return u ? storeName(u) : ''; } };
})();
