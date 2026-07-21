# Veille Élus

Outil de veille des comptes réseaux sociaux des élus et personnalités politiques françaises.

- **Référentiel** : RNE (Répertoire National des Élus, data.gouv.fr) + personnalités hors mandat.
- **Découverte des comptes** : Wikidata (SPARQL) puis ajout manuel. Réseaux : X, Instagram, Facebook, TikTok, YouTube, Twitch.
- **Score de pertinence** : taux de posting × poids du mandat → classement « qui surveiller ».
- **Comparaison** d'élu·es côte à côte.

## Réalités assumées

- ~500k élus dans le RNE : le **référentiel** tient sans souci, mais la **collecte** des posts est étagée (Tier A quotidien / B hebdo / C à la demande), jamais exhaustive.
- **Cap réaliste : 2000 comptes surveillés max** (CRUD libre). Le RNE ~500k n'est qu'un **référentiel de recherche** pour piocher qui ajouter — jamais collecté en masse.
- Collecte des réseaux fermés (**X / Instagram / Facebook / TikTok**) via l'API managée **[monid.ai](https://monid.ai/)** (~0,0015 €/req, voie principale). **YouTube (Data API v3)** et **Twitch (Helix)** en complément gratuit. Coût cible ≈ 61 €/mois à 2000 comptes (blend Tier A/B), ~20-25 € en phase test (100 comptes). Proxy/DIY-scraping = plan B théorique seulement.

## Démarrage

```bash
npm install
cp .env.example .env   # ajuster PIN/secret/clés
npm run dev            # http://localhost:3040
```

## État (avancement par phases)

- [x] **Phase 0** — scaffold (Express + SQLite + EJS + auth) + install BMAD
- [x] **Phase 1** — brainstorm BMAD → `docs/` : `brainstorming-results.md`, `product-brief.md`, `architecture-spec.md`, `premortem.md`
- [ ] **Phase 1.5** — ⚠️ pré-requis pré-mortem AVANT de coder la collecte : PoC monid.ai (5 comptes réels, mesurer couverture + coût/req réels), note RGPD 1 page, verrouiller le score (bornes absolues, par réseau)
- [ ] **Phase 2** — import RNE (référentiel de recherche) + découverte Wikidata + enrichissement Regards Citoyens
- [ ] **Phase 3** — TRONC : watchlist CRUD + collecteur monid.ai + moteur de scoring + scheduler étagé
- [ ] **Phase 4** — branches : Classement → Fiche élu → Comparateur → Radar nouveaux posts
- [ ] **Phase 5** — collecteurs gratuits YouTube/Twitch + déploiement

## Structure

```
src/
  server.js            # Express + auth PIN/HMAC + routes + API
  db.js                # schéma SQLite (WAL) + migrations addColumn() + seeds
  util.js              # normalisation dédup + poids des mandats
  collectors/          # base.js (interface) + registry.js ; monid.ai (principal) + youtube/twitch (gratuits) à venir
  importers/           # rne.js, wikidata.js, regardscitoyens.js à venir
views/  public/  data/
```

## Notes RGPD / légal

Profiler des personnes (dont date de naissance issue du RNE) relève du RGPD : finalité d'intérêt public/journalistique à documenter, mentions légales, droit d'opposition, minimisation des données. Les collecteurs contre-ToS restent désactivés par défaut.
