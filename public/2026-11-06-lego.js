// The public page. Builds everything with textContent; never innerHTML with data.
import { normalizeSetNum, shortNum, visibleSets, themesOf, counts } from './2026-11-06-list.js';

const $ = (id) => document.getElementById(id);
const state = { sets: [], tab: 'wishlist', search: '', theme: '', siteKey: '' };

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const k of kids) if (k) n.append(k);
  return n;
}

function say(id, msg, kind = '') {
  const n = $(id);
  n.textContent = msg;
  n.className = `status ${kind}`.trim();
}

async function load() {
  try {
    const res = await fetch('/api/sets', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    state.sets = data.sets;
    state.siteKey = data.turnstile_site_key;
    // Clear an old load error, but keep a "Thanks!" that was just shown.
    if ($('status').classList.contains('error')) say('status', '');
  } catch {
    say('status', "Couldn't load the list. Check your connection and reload.", 'error');
  }
  render();
}

function card(s) {
  const pic = el('div', { class: 'pic' });
  if (s.image_url) pic.append(el('img', { src: s.image_url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }));
  else pic.append(el('span', { class: 'none', text: '🧱', 'aria-hidden': 'true' }));

  const bits = [`#${shortNum(s.set_num)}`];
  if (s.year) bits.push(String(s.year));
  if (s.pieces) bits.push(`${s.pieces.toLocaleString()} pieces`);

  const body = el(
    'div',
    { class: 'body' },
    s.theme ? el('span', { class: 'theme-tag', text: s.theme }) : null,
    el('p', { class: 'name', text: s.name }),
    el('p', { class: 'meta', text: bits.join(' · ') }),
    el('span', { class: 'spacer' }),
  );
  if (s.status === 'wishlist') {
    const b = el('button', { type: 'button', class: 'btn', text: "I'm getting this" });
    b.addEventListener('click', () => confirmClaim(s));
    body.append(b);
  } else if (s.status === 'claimed') {
    body.append(el('p', { class: 'taken', text: "🎁 Someone's got this" }));
  }
  return el('li', { class: `card ${s.status}` }, pic, body);
}

function render() {
  const c = counts(state.sets);
  $('count-owned').textContent = `(${c.owned})`;
  $('count-wishlist').textContent = `(${c.wishlist})`;
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-pressed', String(t.dataset.tab === state.tab));

  const select = $('theme');
  const themes = themesOf(state.sets);
  if (state.theme && !themes.includes(state.theme)) state.theme = '';
  select.replaceChildren(el('option', { value: '', text: 'All themes' }), ...themes.map((t) => el('option', { value: t, text: t })));
  select.value = state.theme;

  const list = visibleSets(state.sets, state);
  const grid = $('grid');
  if (list.length === 0) {
    const empty = state.search || state.theme ? 'Nothing matches.' : state.tab === 'owned' ? 'Nothing here yet.' : 'The wishlist is empty right now.';
    grid.replaceChildren(el('li', { class: 'empty', text: empty }));
  } else {
    grid.replaceChildren(...list.map(card));
  }
}

// ---------- the confirm dialog with the Turnstile check ----------

let widget = null;
let token = '';
let pending = null; // { send(token) }

function closeDialog() {
  if (widget !== null && window.turnstile) window.turnstile.remove(widget);
  widget = null;
  token = '';
  pending = null;
  $('confirm').close();
}

function openDialog(title, text, send) {
  pending = { send };
  token = '';
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  say('confirm-status', '');
  const ok = $('confirm-ok');
  ok.disabled = true;
  $('confirm').showModal();

  if (!state.siteKey) {
    say('confirm-status', "Claiming isn't switched on yet.", 'error');
    return;
  }
  if (state.siteKey === 'local-preview') {
    token = 'local-preview';
    ok.disabled = false;
    return;
  }
  if (!window.turnstile) {
    say('confirm-status', "The check didn't load. Reload the page and try again.", 'error');
    return;
  }
  widget = window.turnstile.render($('confirm-check'), {
    sitekey: state.siteKey,
    callback: (t) => { token = t; ok.disabled = false; },
    'expired-callback': () => { token = ''; ok.disabled = true; },
    'error-callback': () => say('confirm-status', "The check didn't load. Try again.", 'error'),
  });
}

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, data };
}

async function confirmOk() {
  if (!pending || !token) return;
  const ok = $('confirm-ok');
  ok.disabled = true;
  say('confirm-status', 'Saving…');
  try {
    const msg = await pending.send(token);
    closeDialog();
    await load();
    return msg;
  } catch (err) {
    say('confirm-status', err.message, 'error');
    if (widget !== null && window.turnstile) window.turnstile.reset(widget);
    token = state.siteKey === 'local-preview' ? 'local-preview' : '';
    ok.disabled = !token;
    return null;
  }
}

function confirmClaim(s) {
  openDialog(s.name, `Set #${shortNum(s.set_num)}. Once you confirm, it shows as taken for everyone. Nobody sees who.`, async (t) => {
    const r = await post('/api/claim', { id: s.id, token: t });
    if (!r.ok) throw new Error(r.data.error || 'That didn\'t save. Try again.');
    say('status', `Thanks! ${s.name} is marked as taken.`, 'ok');
  });
}

function boughtSubmit(e) {
  e.preventDefault();
  const num = normalizeSetNum($('bought-num').value);
  if (!num) {
    say('bought-status', "That doesn't look like a set number. It's on the box, like 75192.", 'error');
    return;
  }
  const known = state.sets.find((s) => s.set_num === num);
  if (known?.status === 'owned') return say('bought-status', `He already has ${known.name}!`, 'error');
  if (known?.status === 'claimed') return say('bought-status', `Someone's already getting ${known.name}.`, 'error');
  if (known) return confirmClaim(known);
  say('bought-status', '');
  openDialog(`Set #${shortNum(num)}`, 'Mark this set as taken so nobody else buys it? Nobody sees who.', async (t) => {
    const r = await post('/api/bought', { set_num: num, token: t });
    if (!r.ok) throw new Error(r.data.error || 'That didn\'t save. Try again.');
    $('bought-num').value = '';
    say('bought-status', `Got it: ${r.data.set.name} is marked as taken.`, 'ok');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  for (const t of document.querySelectorAll('.tab')) {
    t.addEventListener('click', () => { state.tab = t.dataset.tab; render(); });
  }
  $('search').addEventListener('input', (e) => { state.search = e.target.value; render(); });
  $('theme').addEventListener('change', (e) => { state.theme = e.target.value; render(); });
  $('bought-form').addEventListener('submit', boughtSubmit);
  $('confirm-ok').addEventListener('click', confirmOk);
  $('confirm-cancel').addEventListener('click', closeDialog);
  $('confirm').addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(); });
  load();
});
