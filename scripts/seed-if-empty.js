// Seed le jeu de démo seulement si la base est vide (idempotent au boot conteneur).
import { db } from '../src/db.js';
const n = db.prepare('SELECT COUNT(*) c FROM persons').get().c;
if (n === 0) {
  console.log('[boot] base vide → seed du jeu de démo…');
  await import('./seed-poc.js');
} else {
  console.log(`[boot] ${n} personnes déjà en base, pas de seed.`);
}
