// The admin page (behind Cloudflare Access). Builds everything with textContent.
const $ = (id) => document.getElementById(id);

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

function say(msg, kind = '') {
  $('status').textContent = msg;
  $('status').className = `status ${kind}`.trim();
}

async function api(path, body) {
  const opts = body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { headers: { Accept: 'application/json' } };
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch { /* not JSON */ }
  if (res.status === 401) throw new Error('Signed out. Reload the page to sign in again.');
  if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
  return data;
}

const shortNum = (n) => String(n).replace(/-1$/, '');
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

async function change(id, body, done) {
  try {
    await api(`/admin/api/sets/${id}`, body);
    say(done, 'ok');
    await load();
  } catch (err) {
    say(err.message, 'error');
  }
}

function row(s, buttons) {
  const bits = [`#${shortNum(s.set_num)}`, s.theme, s.year].filter(Boolean);
  if (s.status === 'claimed' && !s.deleted_at) bits.push(`claimed ${day(s.claimed_at)}`);
  if (s.status === 'owned' && s.received_at && !s.deleted_at) bits.push(`received ${day(s.received_at)}`);
  if (s.deleted_at) bits.push(`removed ${day(s.deleted_at)}`);
  const btns = el('div', { class: 'btns' });
  for (const [label, body, done, ghost] of buttons) {
    const b = el('button', { type: 'button', class: ghost ? 'btn ghost' : 'btn', text: label });
    b.addEventListener('click', () => change(s.id, body, done.replace('{name}', s.name)));
    btns.append(b);
  }
  return el('li', {}, el('div', { class: 'what' }, el('b', { text: s.name }), el('small', { text: bits.join(' · ') })), btns);
}

const REMOVE = ['Remove', { remove: true }, 'Removed {name}.', true];

function fill(listId, countId, sets, buttons) {
  $(countId).textContent = `(${sets.length})`;
  $(listId).replaceChildren(...(sets.length ? sets.map((s) => row(s, buttons)) : [el('li', {}, el('span', { class: 'empty', text: 'None.' }))]));
}

async function load() {
  let data;
  try {
    data = await api('/admin/api/sets');
  } catch (err) {
    say(err.message, 'error');
    return;
  }
  const live = data.sets.filter((s) => !s.deleted_at);
  fill('list-claimed', 'n-claimed', live.filter((s) => s.status === 'claimed'), [
    ['Received', { status: 'owned' }, '{name} moved to Has.'],
    ['Undo claim', { status: 'wishlist' }, '{name} is back on the wishlist.', true],
    REMOVE,
  ]);
  fill('list-wishlist', 'n-wishlist', live.filter((s) => s.status === 'wishlist'), [
    ['He got it', { status: 'owned' }, '{name} moved to Has.', true],
    REMOVE,
  ]);
  fill('list-owned', 'n-owned', live.filter((s) => s.status === 'owned'), [
    ['To wishlist', { status: 'wishlist' }, '{name} moved to the wishlist.', true],
    REMOVE,
  ]);
  fill('list-removed', 'n-removed', data.sets.filter((s) => s.deleted_at), [
    ['Restore', { restore: true }, '{name} is back.', true],
  ]);
}

async function add(e) {
  e.preventDefault();
  const nums = $('add-nums').value.split(/[\s,;]+/).map((n) => n.trim()).filter(Boolean);
  if (!nums.length) return;
  const status = $('add-status').value;
  const name = nums.length === 1 ? $('add-name').value.trim() : '';
  const theme = nums.length === 1 ? $('add-theme').value.trim() : '';
  const log = $('add-log');
  log.replaceChildren();
  $('add-btn').disabled = true;
  const failed = [];
  // One at a time: Rebrickable allows about one lookup a second.
  for (const n of nums) {
    const line = el('li', { text: `${n}: adding…` });
    log.append(line);
    try {
      const r = await api('/admin/api/sets', { set_num: n, status, name, theme });
      const what = { added: 'added', moved: 'moved here', already: 'already here' }[r.result];
      line.textContent = `${n}: ${r.set.name}, ${what}`;
      line.className = 'ok';
    } catch (err) {
      line.textContent = `${n}: ${err.message}`;
      line.className = 'error';
      failed.push(n);
    }
  }
  $('add-nums').value = failed.join('\n');
  if (!failed.length) { $('add-name').value = ''; $('add-theme').value = ''; }
  $('add-btn').disabled = false;
  await load();
}

document.addEventListener('DOMContentLoaded', () => {
  $('add-form').addEventListener('submit', add);
  load();
});
