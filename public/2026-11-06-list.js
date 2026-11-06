// Pure list rules shared by the public page and the tests (no DOM here).

// "75192" -> "75192-1", as the server does. null when it isn't a set number.
export function normalizeSetNum(input) {
  let s = String(input ?? '').trim().toLowerCase().replace(/^#/, '');
  if (/^\d{3,8}$/.test(s)) s += '-1';
  return /^[0-9a-z]{1,20}-\d{1,3}$/.test(s) ? s : null;
}

// "75192-1" -> "75192" for showing; keeps the suffix when it isn't -1.
export const shortNum = (n) => String(n).replace(/-1$/, '');

// The wishlist tab shows wishlist and claimed sets (claimed ones last); Has shows owned.
export function visibleSets(sets, { tab, search = '', theme = '' }) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const inTab = (s) => (tab === 'owned' ? s.status === 'owned' : s.status === 'wishlist' || s.status === 'claimed');
  const hay = (s) => `${s.name} ${s.set_num} ${s.theme}`.toLowerCase();
  return sets
    .filter((s) => inTab(s) && (!theme || s.theme === theme) && words.every((w) => hay(s).includes(w)))
    .sort((a, b) => (a.status === 'claimed') - (b.status === 'claimed'));
}

export function themesOf(sets) {
  return [...new Set(sets.map((s) => s.theme).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function counts(sets) {
  return {
    owned: sets.filter((s) => s.status === 'owned').length,
    wishlist: sets.filter((s) => s.status === 'wishlist').length,
  };
}
