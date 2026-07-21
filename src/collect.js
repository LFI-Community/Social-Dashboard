// Collecte des données d'un compte, déclenchée à l'ajout et sur "Rafraîchir".
//   - Si MONID_API_KEY + collecteur activé  -> collecte réelle via monid.ai (résout le handle = validation).
//   - Sinon, en mode démo                   -> enrichissement de démonstration (followers + activité + hot posts).
// Dans les deux cas : recalcul des stats (compte + personne).
import { db } from './db.js';
import { computeAccountStats, computePersonStats } from './scoring.js';
import { postUrl } from './util.js';

const MONID_KEY = process.env.MONID_API_KEY;
const WINDOW = Number(db.prepare("SELECT value FROM settings WHERE key='default_window'").get()?.value) || 90;

const CAPTIONS = [
  'Mobilisation ce week-end, on ne lâche rien ✊',
  "Face à l'inflation, nos propositions concrètes ⬇️",
  "Mon intervention à l'Assemblée à revoir 👇",
  'Merci pour votre accueil sur le terrain aujourd’hui.',
  'Le débat de ce soir en replay — partagez largement.',
  'Nous exigeons des comptes. #Transparence',
  'Rendez-vous demain 18h pour le meeting, on compte sur vous !',
  'Ma tribune dans la presse ce matin.',
];

// PRNG déterministe par compte (reproductible, pas de Math.random).
function rngFrom(seedStr) {
  let s = 0;
  for (const c of String(seedStr)) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
const isoDay = (d) => d.toISOString().slice(0, 10);

// Enrichissement de démonstration (mode démo uniquement).
function demoEnrich(acc) {
  const rand = rngFrom(acc.network + ':' + (acc.handle || acc.account_ref));

  let followers = acc.followers;
  if (!followers) {
    const tiers = [45000, 130000, 320000, 780000];
    followers = tiers[Math.floor(rand() * tiers.length)] + Math.floor(rand() * 60000);
    db.prepare('UPDATE accounts SET followers = ? WHERE id = ?').run(followers, acc.id);
    acc.followers = followers;
  }

  const hasActivity = db.prepare('SELECT COUNT(*) n FROM activity_daily WHERE account_id = ?').get(acc.id).n;
  if (!hasActivity) {
    const niveau = 1 + (followers > 500000 ? 3 : followers > 150000 ? 1 : 0);
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    const insDaily = db.prepare('INSERT OR IGNORE INTO activity_daily (account_id, day, posts_count) VALUES (?,?,?)');
    const insPost = db.prepare(
      `INSERT OR IGNORE INTO posts (account_id, external_id, posted_at, url, like_count, view_count, engagement, content)
       VALUES (?,?,?,?,?,?,?,?)`);
    const tx = db.transaction(() => {
      for (let d = 89; d >= 0; d--) {
        const day = new Date(today); day.setUTCDate(day.getUTCDate() - d);
        const posts = Math.max(0, Math.round(niveau * (0.5 + rand()) - (rand() < 0.25 ? niveau * 0.7 : 0)));
        if (posts > 0) insDaily.run(acc.id, isoDay(day), posts);
      }
      const nHot = 6 + Math.floor(rand() * 5);
      for (let k = 0; k < nHot; k++) {
        const dt = new Date(today); dt.setUTCDate(dt.getUTCDate() - Math.floor(rand() * 55));
        dt.setUTCHours(8 + Math.floor(rand() * 12));
        const engagement = Math.round(followers * (0.004 + rand() * 0.03) * (0.6 + niveau / 6));
        const views = ['x', 'tiktok', 'youtube'].includes(acc.network) ? Math.round(engagement * (12 + rand() * 28)) : 0;
        insPost.run(acc.id, `${acc.network}-${acc.handle}-${k}`, dt.toISOString(),
          postUrl(acc.network, acc.handle, Math.floor(rand() * 1e9)),
          Math.round(engagement * 0.8), views, engagement, CAPTIONS[Math.floor(rand() * CAPTIONS.length)]);
      }
    });
    tx();
  }
  return { mode: 'demo' };
}

// Collecte réelle via monid.ai (structure ; à ajuster au schéma exact de l'endpoint choisi).
async function monidCollect(acc) {
  // POST /v1/run -> résout le profil (followers) + posts récents. Le handle qui ne résout pas = invalide.
  const res = await fetch('https://api.monid.ai/v1/run', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MONID_KEY}`,
      'Content-Type': 'application/json',
      ...(process.env.MONID_WORKSPACE_ID ? { 'x-workspace-id': process.env.MONID_WORKSPACE_ID } : {}),
    },
    body: JSON.stringify({ provider: 'apify', endpoint: acc.account_ref || acc.handle, input: { handle: acc.handle, maxItems: 20 } }),
  });
  if (!res.ok) throw new Error(`monid HTTP ${res.status}`);
  const data = await res.json();
  // TODO: mapper data -> followers + posts selon l'actor. Non finalisé tant que la clé n'est pas testée.
  throw new Error('mapping monid non finalisé (PoC clé requis)');
}

export async function collectAccount(accountId) {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!acc) return { ok: false, error: 'compte introuvable' };

  const collector = db.prepare('SELECT * FROM collectors WHERE network = ?').get(acc.network);
  const paidAllowed = process.env.ENABLE_PAID === '1';
  const canReal = MONID_KEY && collector?.enabled && (collector.kind === 'free' || paidAllowed);

  let mode = 'demo';
  if (canReal) {
    try { await monidCollect(acc); mode = 'monid'; }
    catch { demoEnrich(acc); mode = 'demo-fallback'; }
  } else {
    demoEnrich(acc);
  }

  computeAccountStats(acc.id, WINDOW);
  if (acc.person_id) computePersonStats(acc.person_id, WINDOW);
  return { ok: true, mode };
}
