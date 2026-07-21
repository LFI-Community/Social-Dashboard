// Interface commune à tous les collecteurs.
//
// Chaque collecteur exporte un objet conforme :
//   {
//     network: 'youtube',
//     kind: 'free' | 'paid',
//     // Résout le compte à partir d'un handle/ref (retourne { account_ref, display_name, url, followers, verified } ou null)
//     async resolve(handleOrRef) {},
//     // Récupère les posts depuis `sinceDate` (ISO) -> [{ external_id, posted_at, url, like_count }]
//     async fetchPosts(account, sinceDate) {},
//   }
//
// Le moteur de scoring (scoring.js) consomme fetchPosts() -> rollups activity_daily -> account_stats.

export class CollectorError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.name = 'CollectorError';
    this.retryable = retryable;
  }
}

// Fenêtre par défaut (jours) pour le calcul du taux de posting.
export const DEFAULT_WINDOW_DAYS = 90;

// Un collecteur minimal valide implémente au moins resolve() et fetchPosts().
export function assertCollector(c) {
  for (const k of ['network', 'kind', 'resolve', 'fetchPosts']) {
    if (!(k in c)) throw new Error(`Collecteur invalide : champ '${k}' manquant`);
  }
  return c;
}
