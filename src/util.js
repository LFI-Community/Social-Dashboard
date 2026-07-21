// Normalisation pour la dédup des personnes (RNE sans identifiant unique).
export function normalizeName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function dedupKey({ last_name, first_name, birth_date }) {
  return [normalizeName(last_name), normalizeName(first_name), String(birth_date || '').trim()].join('|');
}

export function slugify(s) {
  return normalizeName(s).replace(/\s+/g, '-').slice(0, 80);
}

// Poids par type de mandat (importance institutionnelle / audience présumée).
// Ajustable après le brainstorm BMAD.
export const MANDATE_WEIGHT = {
  mep: 1.0,
  ministre: 1.0,
  depute: 0.9,
  senateur: 0.9,
  cr_president: 0.85,
  cd_president: 0.85,
  maire_grande_ville: 0.8,
  maire: 0.6,
  cr: 0.5,
  cd: 0.5,
  epci: 0.35,
  arrondissement: 0.3,
  cm: 0.25,
  afe: 0.3,
  public_figure: 0.7,
  autre: 0.25,
};

export function mandateWeight(type) {
  return MANDATE_WEIGHT[type] ?? MANDATE_WEIGHT.autre;
}

// Permalien d'un post au format de chaque plateforme (id déterministe depuis `seed`).
// Démo = ids synthétiques (structure correcte, non résolvables) ; la collecte réelle (monid.ai) fournit les vrais.
export function postUrl(net, handle, seed) {
  let x = (Number(seed) >>> 0) || 1;
  const next = () => (x = (x * 1103515245 + 12345) & 0x7fffffff);
  const digits = (n) => { let s = ''; for (let i = 0; i < n; i++) s += next() % 10; return s; };
  const alnum = (n) => { const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; let s = ''; for (let i = 0; i < n; i++) s += c[next() % c.length]; return s; };
  switch (net) {
    case 'x': return `https://x.com/${handle}/status/1${digits(17)}`;
    case 'tiktok': return `https://www.tiktok.com/@${handle}/video/7${digits(18)}`;
    case 'youtube': return `https://www.youtube.com/watch?v=${alnum(11)}`;
    case 'instagram': return `https://www.instagram.com/p/${alnum(11)}/`;
    case 'facebook': return `https://www.facebook.com/${handle}/posts/${digits(15)}`;
    case 'twitch': return `https://www.twitch.tv/${handle}/clip/${alnum(16)}`;
    default: return `https://${handle}`;
  }
}
