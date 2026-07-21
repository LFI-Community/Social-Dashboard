import express from 'express';
import cookieParser from 'cookie-parser';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { collectorConfig } from './collectors/registry.js';
import { slugify } from './util.js';
import { recomputeAll } from './scoring.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', true);
app.locals.ASSET_V = Date.now().toString(36);
const PORT = process.env.PORT || 3040;

// Sparkline SVG à partir d'une série [{day, posts}] (ou [nombres]).
app.locals.spark = function (series, w = 240, h = 44) {
  const vals = (series || []).map((p) => (typeof p === 'number' ? p : p.posts || 0));
  if (vals.length < 2) return `<svg class="spark" width="${w}" height="${h}"></svg>`;
  const max = Math.max(1, ...vals), n = vals.length, pad = 3;
  const x = (i) => pad + (i * (w - 2 * pad)) / (n - 1);
  const y = (v) => h - pad - (v / max) * (h - 2 * pad);
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)},${h - pad} L${x(0).toFixed(1)},${h - pad} Z`;
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">`
    + `<path class="area" d="${area}"/><path class="line" d="${line}"/></svg>`;
};
app.locals.fmt = (n) => (n || 0).toLocaleString('fr-FR');

// Icônes officielles des marques (Simple Icons, CC0) — viewBox 24, fill=currentColor.
const NET_ICONS = {
  x: 'M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z',
  instagram: 'M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077',
  facebook: 'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z',
  tiktok: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z',
  youtube: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  twitch: 'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z',
};
app.locals.icon = function (net, size = 18) {
  const d = NET_ICONS[net];
  if (!d) return '';
  return `<svg class="ico ico-${net}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
};
app.locals.NET_LABEL = { x: 'X', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', twitch: 'Twitch' };

// Badge-logo d'un parti (monogramme aux couleurs du parti).
app.locals.plogo = function (short, color, name) {
  if (!short) return '<span class="plogo plogo-none" title="Sans parti">·</span>';
  const c = color || '#7b8291';
  return `<span class="plogo" style="--pc:${c}"${name ? ` title="${name}"` : ''}>${short}</span>`;
};

// --- Auth admin : PIN -> jeton HMAC en cookie (pattern regulation-radicale) ---
const ADMIN_PIN = process.env.ADMIN_PIN || '7351';
const ADMIN_SECRET = process.env.ADMIN_SECRET || randomBytes(32).toString('hex');
const ADMIN_TOKEN = createHmac('sha256', ADMIN_SECRET).update('admin:' + ADMIN_PIN).digest('hex');
if (ADMIN_PIN === '7351') console.warn('[veille-elus] ⚠ ADMIN_PIN par défaut (7351) — définir ADMIN_PIN + ADMIN_SECRET en prod.');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || '')), bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
function requireAdmin(req, res, next) {
  if (safeEqual(req.cookies?.ve_admin, ADMIN_TOKEN)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'auth requise' });
  return res.redirect('/admin/login');
}

// Anti-bruteforce login (mémoire, par IP)
const LOGIN_MAX = 8, LOGIN_WINDOW = 15 * 60 * 1000, loginHits = new Map();
function loginBlocked(req) {
  const h = loginHits.get(req.ip), now = Date.now();
  if (h && now > h.reset) { loginHits.delete(req.ip); return false; }
  return !!(h && h.count >= LOGIN_MAX);
}
function loginFail(req) {
  const h = loginHits.get(req.ip), now = Date.now();
  if (!h || now > h.reset) loginHits.set(req.ip, { count: 1, reset: now + LOGIN_WINDOW });
  else h.count++;
}

app.set('view engine', 'ejs');
app.set('views', resolve(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use('/static', express.static(resolve(__dirname, '..', 'public')));
app.use((req, res, next) => {
  res.locals.isAdmin = safeEqual(req.cookies?.ve_admin, ADMIN_TOKEN);
  res.locals.path = req.path;
  next();
});

const WINDOW = Number(db.prepare("SELECT value FROM settings WHERE key='default_window'").get()?.value) || 90;

// ---------- Requêtes de lecture ----------
const rankingStmt = db.prepare(`
  SELECT p.id AS person_id, p.display_name, p.slug, p.is_public_figure,
         pa.short AS party_short, pa.color AS party_color, pa.name AS party_name,
         a.id AS account_id, a.network, a.handle, a.followers,
         s.posts_per_week, s.watch_score, s.last_post_at
  FROM account_stats s
  JOIN accounts a ON a.id = s.account_id
  LEFT JOIN persons p ON p.id = a.person_id
  LEFT JOIN person_parties pp ON pp.person_id = p.id AND pp.is_current = 1
  LEFT JOIN parties pa ON pa.id = pp.party_id
  WHERE s.window_days = ? AND (?='' OR pa.short = ?) AND (?='' OR a.network = ?)
  ORDER BY s.watch_score DESC
  LIMIT ?
`);

function ranking(limit = 100, party = '', network = '') {
  return rankingStmt.all(WINDOW, party, party, network, network, limit);
}

// Partis présents (pour les filtres) — triés par nb de comptes.
const partiesFilterStmt = db.prepare(`
  SELECT pa.short, pa.name, pa.color, COUNT(DISTINCT a.id) n
  FROM parties pa JOIN person_parties pp ON pp.party_id = pa.id
  JOIN accounts a ON a.person_id = pp.person_id
  GROUP BY pa.id ORDER BY n DESC
`);

// Série d'activité (posts/jour) sur la fenêtre, pour la sparkline d'une personne (agrégée sur ses comptes).
const seriesStmt = db.prepare(`
  SELECT ad.day, SUM(ad.posts_count) AS posts
  FROM activity_daily ad JOIN accounts a ON a.id = ad.account_id
  WHERE a.person_id = ? AND ad.day >= date('now','-90 day')
  GROUP BY ad.day ORDER BY ad.day
`);
const hotPostsStmt = db.prepare(`
  SELECT po.*, a.network, a.handle FROM posts po JOIN accounts a ON a.id = po.account_id
  WHERE a.person_id = ? ORDER BY po.engagement DESC LIMIT 8
`);
const partyStmt = db.prepare(`
  SELECT pa.name, pa.short, pa.color FROM person_parties pp JOIN parties pa ON pa.id = pp.party_id
  WHERE pp.person_id = ? AND pp.is_current = 1 LIMIT 1
`);
const CAMP_LABEL = { insoumis: 'Insoumis', allie: 'Allié', adversaire: 'Adversaire', autre: 'Autre' };

// ---------- Pages ----------
app.get('/', (req, res) => {
  const party = String(req.query.party || '');
  const network = String(req.query.network || '');
  const rows = ranking(120, party, network);
  const counts = {
    persons: db.prepare('SELECT COUNT(*) n FROM persons').get().n,
    accounts: db.prepare('SELECT COUNT(*) n FROM accounts').get().n,
    mandates: db.prepare('SELECT COUNT(*) n FROM mandates').get().n,
  };
  const note = db.prepare("SELECT value FROM settings WHERE key='dataset_note'").get()?.value || '';
  res.render('dashboard', { rows, counts, window: WINDOW, collectors: collectorConfig(), party, network, note, parties: partiesFilterStmt.all() });
});

app.get('/person/:id', (req, res) => {
  const person = db.prepare('SELECT * FROM persons WHERE id = ? OR slug = ?').get(req.params.id, req.params.id);
  if (!person) return res.status(404).render('404');
  const mandates = db.prepare('SELECT * FROM mandates WHERE person_id = ? ORDER BY mandate_weight DESC').all(person.id);
  const accounts = db.prepare(`
    SELECT a.*, s.posts_per_week, s.watch_score, s.last_post_at, s.quality, s.reach, s.activity_score
    FROM accounts a LEFT JOIN account_stats s ON s.account_id = a.id AND s.window_days = ?
    WHERE a.person_id = ? ORDER BY a.followers DESC`).all(WINDOW, person.id);
  const series = seriesStmt.all(person.id);
  const hotPosts = hotPostsStmt.all(person.id);
  const party = partyStmt.get(person.id);
  res.render('person', { person, mandates, accounts, series, hotPosts, party, CAMP_LABEL });
});

app.get('/compare', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((x) => parseInt(x, 10)).filter(Boolean).slice(0, 4);
  const people = ids.map((id) => {
    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(id);
    if (!person) return null;
    const accounts = db.prepare(`
      SELECT a.*, s.posts_per_week, s.watch_score, s.last_post_at
      FROM accounts a LEFT JOIN account_stats s ON s.account_id = a.id AND s.window_days = ?
      WHERE a.person_id = ? ORDER BY a.followers DESC`).all(WINDOW, id);
    const party = partyStmt.get(id);
    const totalFollowers = accounts.reduce((s, a) => s + (a.followers || 0), 0);
    const bestScore = accounts.reduce((m, a) => Math.max(m, a.watch_score || 0), 0);
    const ppw = accounts.reduce((s, a) => s + (a.posts_per_week || 0), 0);
    return { person, accounts, party, totalFollowers, bestScore, ppw };
  }).filter(Boolean);
  res.render('compare', { people, window: WINDOW, CAMP_LABEL });
});

// ---------- API ----------
app.get('/api/ranking', (req, res) => {
  res.json(ranking(Math.min(500, Number(req.query.limit) || 100)));
});

app.get('/api/persons', (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = q
    ? db.prepare(`SELECT id, display_name, slug, is_public_figure FROM persons
                  WHERE display_name LIKE ? ORDER BY display_name LIMIT 50`).all('%' + q + '%')
    : db.prepare('SELECT id, display_name, slug, is_public_figure FROM persons ORDER BY id DESC LIMIT 50').all();
  res.json(rows);
});

app.get('/api/compare', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((x) => parseInt(x, 10)).filter(Boolean).slice(0, 4);
  const out = ids.map((id) => ({
    person: db.prepare('SELECT id, display_name FROM persons WHERE id = ?').get(id),
    stats: db.prepare('SELECT a.network, a.handle, s.posts_per_week, s.watch_score FROM accounts a LEFT JOIN account_stats s ON s.account_id=a.id AND s.window_days=? WHERE a.person_id=?').all(WINDOW, id),
  }));
  res.json(out);
});

// Ajout libre d'un compte (protégé). person_id optionnel -> compte standalone.
app.post('/api/accounts', requireAdmin, (req, res) => {
  const { network, handle, account_ref, url, person_id } = req.body || {};
  if (!network || !(account_ref || handle)) return res.status(400).json({ error: 'network + (account_ref ou handle) requis' });
  const ref = String(account_ref || handle).trim();
  try {
    const info = db.prepare(`INSERT INTO accounts (person_id, network, handle, account_ref, url, is_standalone, added_by)
      VALUES (?,?,?,?,?,?, 'manual')`).run(
      person_id ? Number(person_id) : null, String(network), String(handle || ''), ref, String(url || ''), person_id ? 0 : 1);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'compte déjà enregistré' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/accounts/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Collecte à la demande (Tier C) — implémentée en Phase 3.
app.post('/api/accounts/:id/refresh', requireAdmin, (req, res) => {
  res.status(501).json({ error: 'collecteurs pas encore implémentés (Phase 3)' });
});

// ---------- API Admin (outils) ----------
app.get('/api/stats', (req, res) => {
  res.json({
    persons: db.prepare('SELECT COUNT(*) n FROM persons').get().n,
    accounts: db.prepare('SELECT COUNT(*) n FROM accounts').get().n,
    mandates: db.prepare('SELECT COUNT(*) n FROM mandates').get().n,
    byCamp: db.prepare('SELECT camp, COUNT(*) n FROM persons GROUP BY camp').all(),
    byNetwork: db.prepare('SELECT network, COUNT(*) n, SUM(followers) f FROM accounts GROUP BY network ORDER BY f DESC').all(),
    byTier: db.prepare('SELECT tier, COUNT(*) n FROM accounts GROUP BY tier').all(),
  });
});

// Créer une personne (+ rattachement parti optionnel)
app.post('/api/persons', requireAdmin, (req, res) => {
  const { display_name, party_id, is_public_figure } = req.body || {};
  if (!display_name) return res.status(400).json({ error: 'display_name requis' });
  const parts = String(display_name).trim().split(/\s+/);
  try {
    const info = db.prepare(
      `INSERT INTO persons (slug, display_name, first_name, last_name, is_public_figure)
       VALUES (?,?,?,?,?)`
    ).run(slugify(display_name) + '-' + Date.now().toString(36).slice(-4), String(display_name).trim(),
      parts[0] || '', parts.slice(1).join(' '), is_public_figure ? 1 : 0);
    if (party_id) db.prepare('INSERT OR IGNORE INTO person_parties (person_id, party_id, is_current) VALUES (?,?,1)')
      .run(info.lastInsertRowid, Number(party_id));
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/persons/:id', requireAdmin, (req, res) => {
  const { camp, display_name, notes } = req.body || {};
  const p = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'introuvable' });
  db.prepare('UPDATE persons SET camp=?, display_name=?, notes=?, updated_at=datetime(\'now\') WHERE id=?')
    .run(['insoumis', 'allie', 'adversaire', 'autre'].includes(camp) ? camp : p.camp,
      display_name || p.display_name, notes ?? p.notes, p.id);
  res.json({ ok: true });
});

app.delete('/api/persons/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM persons WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Lister les comptes (admin) avec personne + score
app.get('/api/accounts', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.network, a.handle, a.followers, a.tier, a.person_id, p.display_name, p.camp,
           s.watch_score, s.posts_per_week
    FROM accounts a LEFT JOIN persons p ON p.id = a.person_id
    LEFT JOIN account_stats s ON s.account_id = a.id AND s.window_days = ?
    ORDER BY s.watch_score DESC NULLS LAST LIMIT 500`).all(WINDOW);
  res.json(rows);
});

app.patch('/api/accounts/:id', requireAdmin, (req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'introuvable' });
  const { tier, followers, person_id } = req.body || {};
  db.prepare('UPDATE accounts SET tier=?, followers=?, person_id=? WHERE id=?').run(
    ['A', 'B', 'C'].includes(tier) ? tier : a.tier,
    followers != null ? Number(followers) : a.followers,
    person_id !== undefined ? (person_id ? Number(person_id) : null) : a.person_id, a.id);
  res.json({ ok: true });
});

// Activer/désactiver un collecteur
app.post('/api/collectors/:network/toggle', requireAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM collectors WHERE network = ?').get(req.params.network);
  if (!c) return res.status(404).json({ error: 'collecteur inconnu' });
  db.prepare('UPDATE collectors SET enabled = ? WHERE network = ?').run(c.enabled ? 0 : 1, c.network);
  res.json({ ok: true, enabled: c.enabled ? 0 : 1 });
});

// Recalculer tous les scores
app.post('/api/recompute', requireAdmin, (req, res) => {
  const n = recomputeAll(WINDOW);
  res.json({ ok: true, accounts: n });
});

// ---------- Admin ----------
app.get('/admin/login', (req, res) => res.render('admin/login', { error: null }));
app.post('/admin/login', (req, res) => {
  if (loginBlocked(req)) return res.status(429).render('admin/login', { error: 'Trop de tentatives, réessayez plus tard.' });
  if (safeEqual(String(req.body.pin), ADMIN_PIN)) {
    loginHits.delete(req.ip);
    res.cookie('ve_admin', ADMIN_TOKEN, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 1000 * 60 * 60 * 24 * 30 });
    return res.redirect('/admin');
  }
  loginFail(req);
  res.render('admin/login', { error: 'Code incorrect.' });
});
app.post('/admin/logout', (req, res) => { res.clearCookie('ve_admin'); res.redirect('/'); });

app.get('/admin', requireAdmin, (req, res) => {
  const stats = {
    persons: db.prepare('SELECT COUNT(*) n FROM persons').get().n,
    accounts: db.prepare('SELECT COUNT(*) n FROM accounts').get().n,
    mandates: db.prepare('SELECT COUNT(*) n FROM mandates').get().n,
    followers: db.prepare('SELECT COALESCE(SUM(followers),0) f FROM accounts').get().f,
    byParty: db.prepare(`SELECT pa.short, pa.name, pa.color, COUNT(DISTINCT pp.person_id) n
      FROM parties pa JOIN person_parties pp ON pp.party_id = pa.id
      GROUP BY pa.id ORDER BY n DESC`).all(),
    byNetwork: db.prepare('SELECT network, COUNT(*) n, COALESCE(SUM(followers),0) f FROM accounts GROUP BY network ORDER BY f DESC').all(),
    byTier: db.prepare('SELECT tier, COUNT(*) n FROM accounts GROUP BY tier').all(),
  };
  const accounts = db.prepare(`
    SELECT a.id, a.network, a.handle, a.followers, a.tier, p.id AS person_id, p.display_name,
           pa.short AS party_short, pa.color AS party_color, pa.name AS party_name, s.watch_score
    FROM accounts a LEFT JOIN persons p ON p.id = a.person_id
    LEFT JOIN person_parties pp ON pp.person_id = p.id AND pp.is_current = 1
    LEFT JOIN parties pa ON pa.id = pp.party_id
    LEFT JOIN account_stats s ON s.account_id = a.id AND s.window_days = ?
    ORDER BY s.watch_score DESC LIMIT 60`).all(WINDOW);
  const parties = db.prepare('SELECT id, short, name, color FROM parties ORDER BY name').all();
  res.render('admin/index', { stats, accounts, collectors: collectorConfig(), parties });
});

app.use((req, res) => res.status(404).render('404'));

app.listen(PORT, () => console.log(`[veille-elus] en écoute sur http://localhost:${PORT}`));
