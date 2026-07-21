import { db } from '../db.js';
import { assertCollector } from './base.js';

// Les collecteurs concrets seront ajoutés en Phase 3 (youtube, twitch) et Phase 5 (apify_*).
// Import paresseux pour ne pas casser le boot tant qu'ils n'existent pas.
const MODULES = {
  // youtube: () => import('./youtube.js'),
  // twitch: () => import('./twitch.js'),
  // x: () => import('./apify_x.js'),
  // instagram: () => import('./apify_instagram.js'),
  // facebook: () => import('./apify_facebook.js'),
  // tiktok: () => import('./apify_tiktok.js'),
};

const ENABLE_PAID = process.env.ENABLE_PAID === '1';

// Renvoie les collecteurs activés : gratuits toujours, payants seulement si ENABLE_PAID
// ET marqués enabled=1 en base (double garde-fou).
export async function activeCollectors() {
  const rows = db.prepare('SELECT network, kind, enabled FROM collectors').all();
  const out = {};
  for (const row of rows) {
    const loader = MODULES[row.network];
    if (!loader) continue; // collecteur pas encore implémenté
    const allowed = row.enabled === 1 && (row.kind === 'free' || ENABLE_PAID);
    if (!allowed) continue;
    const mod = await loader();
    out[row.network] = assertCollector(mod.default);
  }
  return out;
}

export function collectorConfig() {
  return db.prepare('SELECT network, name, kind, enabled FROM collectors ORDER BY kind, network').all();
}
