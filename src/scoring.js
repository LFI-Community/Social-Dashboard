// Moteur de scoring — décisions brainstorm :
//   activity_score = quantité(posts/sem) + qualité(engagement moyen) + reach(followers)
//   watch_score    = activity_score × poids_mandat
//   chiffre-roi affiché = followers/réseau
//
// Pré-mortem #3 : bornes ABSOLUES a priori (pas de min-max sur la population) → stable dès N=100,
// score PAR réseau (jamais d'engagement cross-réseau additionné).
import { db } from './db.js';
import { mandateWeight } from './util.js';

// Bornes de normalisation (log). Tunables via settings ; valeurs par défaut raisonnables.
const BOUNDS = {
  QMAX: 70,          // ~10 posts/jour = plafond quantité
  EMAX: 100_000,     // engagement moyen/post plafond (likes+reposts+comments)
  RMAX: 5_000_000,   // followers plafond
};
// Pondération des 3 composantes de l'activité (somme = 1).
const W = { quantity: 0.4, quality: 0.3, reach: 0.3 };

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const logNorm = (v, max) => clamp01(Math.log10(1 + Math.max(0, v)) / Math.log10(1 + max));

// Poids du mandat le plus fort d'une personne (sinon personnalité / standalone).
function personWeight(personId) {
  if (!personId) return 0.5; // compte standalone
  const rows = db.prepare('SELECT mandate_type, mandate_weight FROM mandates WHERE person_id = ?').all(personId);
  if (rows.length) return Math.max(...rows.map((m) => m.mandate_weight ?? mandateWeight(m.mandate_type)));
  const p = db.prepare('SELECT is_public_figure FROM persons WHERE id = ?').get(personId);
  return p?.is_public_figure ? mandateWeight('public_figure') : 0.5;
}

export function computeAccountStats(accountId, windowDays = 90) {
  const acc = db.prepare('SELECT id, person_id, followers FROM accounts WHERE id = ?').get(accountId);
  if (!acc) return null;
  const since = `date('now','-${windowDays} day')`;

  const act = db.prepare(
    `SELECT COALESCE(SUM(posts_count),0) AS posts, COUNT(*) AS active_days, MAX(day) AS last_day
     FROM activity_daily WHERE account_id = ? AND day >= ${since}`
  ).get(accountId);

  const eng = db.prepare(
    `SELECT AVG(engagement) AS avg_eng, MAX(posted_at) AS last_post
     FROM posts WHERE account_id = ? AND posted_at >= ${since}`
  ).get(accountId);

  const postsCount = act.posts || 0;
  const postsPerWeek = postsCount / (windowDays / 7);
  const avgEng = eng.avg_eng || 0;
  const followers = acc.followers || 0;

  const quantity = logNorm(postsPerWeek, BOUNDS.QMAX / (90 / 7)); // QMAX exprimé en posts/sem
  const quality = logNorm(avgEng, BOUNDS.EMAX);
  const reach = logNorm(followers, BOUNDS.RMAX);

  const activity = W.quantity * quantity + W.quality * quality + W.reach * reach;
  const watch = activity * personWeight(acc.person_id);
  const lastPost = eng.last_post || (act.last_day ? act.last_day + 'T12:00:00' : null);

  db.prepare(
    `INSERT INTO account_stats
       (account_id, window_days, posts_count, posts_per_week, last_post_at, active_days, activity_score, watch_score, quality, reach, computed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'))
     ON CONFLICT(account_id, window_days) DO UPDATE SET
       posts_count=excluded.posts_count, posts_per_week=excluded.posts_per_week, last_post_at=excluded.last_post_at,
       active_days=excluded.active_days, activity_score=excluded.activity_score, watch_score=excluded.watch_score,
       quality=excluded.quality, reach=excluded.reach, computed_at=excluded.computed_at`
  ).run(accountId, windowDays, postsCount, postsPerWeek, lastPost, act.active_days || 0,
        activity, watch, quality, reach);

  return { accountId, postsPerWeek, activity, watch, quality, reach, followers };
}

// Agrégat par PERSONNE (l'app raisonne par personnalité, pas par compte).
export function computePersonStats(personId, windowDays = 90) {
  const agg = db.prepare(`
    SELECT COALESCE(SUM(a.followers),0) AS followers,
           COALESCE(SUM(s.posts_per_week),0) AS ppw,
           COALESCE(MAX(s.quality),0) AS quality,
           COUNT(DISTINCT a.network) AS nets,
           MAX(s.last_post_at) AS last_post
    FROM accounts a LEFT JOIN account_stats s ON s.account_id = a.id AND s.window_days = ?
    WHERE a.person_id = ? AND a.active = 1
  `).get(windowDays, personId);

  const reach = logNorm(agg.followers, 8_000_000);   // reach cumulé tous réseaux
  const quantity = logNorm(agg.ppw, 120);            // posts/sem cumulés
  const quality = clamp01(agg.quality || 0);         // meilleure qualité d'engagement
  const activity = W.quantity * quantity + W.quality * quality + W.reach * reach;
  const watch = activity * personWeight(personId);

  db.prepare(
    `INSERT INTO person_stats (person_id, followers, posts_per_week, activity_score, watch_score, networks, last_post_at, computed_at)
     VALUES (?,?,?,?,?,?,?, datetime('now'))
     ON CONFLICT(person_id) DO UPDATE SET followers=excluded.followers, posts_per_week=excluded.posts_per_week,
       activity_score=excluded.activity_score, watch_score=excluded.watch_score, networks=excluded.networks,
       last_post_at=excluded.last_post_at, computed_at=excluded.computed_at`
  ).run(personId, agg.followers, agg.ppw, activity, watch, agg.nets || 0, agg.last_post || null);
  return { personId, followers: agg.followers, watch };
}

export function recomputeAll(windowDays = 90) {
  const ids = db.prepare('SELECT id FROM accounts WHERE active = 1').all().map((r) => r.id);
  const personIds = db.prepare('SELECT id FROM persons').all().map((r) => r.id);
  const tx = db.transaction(() => {
    ids.forEach((id) => computeAccountStats(id, windowDays));
    personIds.forEach((id) => computePersonStats(id, windowDays));
  });
  tx();
  return ids.length;
}

// CLI : `node src/scoring.js [window]`
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  const w = Number(process.argv[2]) || 90;
  const n = recomputeAll(w);
  console.log(`[scoring] ${n} comptes recalculés (fenêtre ${w} j)`);
}
