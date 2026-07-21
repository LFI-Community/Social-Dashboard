import express from 'express';
import cookieParser from 'cookie-parser';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { collectorConfig } from './collectors/registry.js';
import { slugify } from './util.js';

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
  SELECT p.id AS person_id, p.display_name, p.slug, p.is_public_figure, p.camp,
         a.id AS account_id, a.network, a.handle, a.followers,
         s.posts_per_week, s.watch_score, s.last_post_at
  FROM account_stats s
  JOIN accounts a ON a.id = s.account_id
  LEFT JOIN persons p ON p.id = a.person_id
  WHERE s.window_days = ? AND (?='' OR p.camp = ?) AND (?='' OR a.network = ?)
  ORDER BY s.watch_score DESC
  LIMIT ?
`);

function ranking(limit = 100, camp = '', network = '') {
  return rankingStmt.all(WINDOW, camp, camp, network, network, limit);
}

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
  const camp = ['insoumis', 'allie', 'adversaire'].includes(req.query.camp) ? req.query.camp : '';
  const network = String(req.query.network || '');
  const rows = ranking(120, camp, network);
  const counts = {
    persons: db.prepare('SELECT COUNT(*) n FROM persons').get().n,
    accounts: db.prepare('SELECT COUNT(*) n FROM accounts').get().n,
    mandates: db.prepare('SELECT COUNT(*) n FROM mandates').get().n,
  };
  const note = db.prepare("SELECT value FROM settings WHERE key='dataset_note'").get()?.value || '';
  res.render('dashboard', { rows, counts, window: WINDOW, collectors: collectorConfig(), camp, network, note, CAMP_LABEL });
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
  const persons = db.prepare('SELECT id, display_name, slug FROM persons ORDER BY id DESC LIMIT 30').all();
  res.render('admin/index', { persons, collectors: collectorConfig() });
});

app.use((req, res) => res.status(404).render('404'));

app.listen(PORT, () => console.log(`[veille-elus] en écoute sur http://localhost:${PORT}`));
