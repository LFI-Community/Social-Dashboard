# Synthèse du brainstorming — Architecture et périmètre de veille-elus

- **Date** : 2026-07-21
- **Participants** : Boris (porteur du projet) et le facilitateur BMAD (mode facilitator)
- **Sujet** : Architecture et périmètre de l'outil `veille-elus` — monitoring des comptes réseaux sociaux d'élus et de personnalités politiques françaises
- **Objectif de la session** : optimiser la connaissance globale du projet avant de coder — figer le périmètre MVP, le modèle de collecte étagée, le score de pertinence et l'extensibilité (ajouter n'importe quel compte/réseau, comparer des élus)

## Contexte et objectif

Le scaffold Phase 0 est déjà en place (Node ESM + Express + better-sqlite3 en WAL + EJS + auth PIN/cookie HMAC, port 3040). La session visait à cadrer le projet en amont du développement : à qui l'outil s'adresse, ce que « surveiller » signifie concrètement, comment collecter les données malgré les murs des réseaux fermés, à quel coût, et comment articuler l'ambition « tous les élus » avec une contrainte budgétaire réaliste.

## Techniques utilisées

- **Question Storming** — faire émerger les questions structurantes (utilisateur cible, définition de « surveiller », modèle de coût de la collecte) avant de chercher des réponses.
- **One Feature Only** — pression pour réduire le produit à une seule fonctionnalité ; a confirmé au contraire que les cinq capacités forment un produit intégré, aucune n'étant jetable en v1.

## Décisions clés

### Utilisateur et finalité

- **Utilisateur n°1 = élus et militants de La France Insoumise.** L'outil est orienté LFI, pas grand public neutre.
- **« Surveiller » =** détecter un nouveau post + remonter les données + le nombre de followers + les *hot posts* (statistiques détaillées par post : vues, likes).
- **Comparer 2 élus =** outil de benchmarking pur, pas destiné à prouver quoi que ce soit.
- **Chiffre-roi affiché par élu =** le nombre de followers, par réseau.

### Collecte et coût

- **Voie principale de collecte = API managée monid.ai**, à 0,0015 EUR/requête (1,50 EUR les 1000 requêtes).
- **Proxy / DIY-scraping = plan B théorique seulement.** Un proxy résout l'IP mais pas le login-wall X/Insta/FB, ni l'anti-bot TikTok, ni la maintenance ; plus cher et plus fragile à l'échelle de 2000 comptes.
- **Compléments gratuits** : YouTube Data API v3 et Twitch Helix.
- **Modèle de coût** : coût = comptes × refresh/mois × requêtes/refresh. Un élu sur 4 réseaux = 4 comptes. À l'échelle 500k comptes en mensuel = ~750 EUR/mois → la **collecte étagée est obligatoire**. À 2000 comptes : de 12 EUR/mois (followers hebdo) à 90 EUR/mois (quotidien). L'architecture n'est plus contrainte par l'échelle, seulement par la fréquence choisie.
- **Blend étagé retenu** : Tier A = 300 VIP en quotidien avec hot-posts + Tier B = 1700 comptes en hebdo léger = ~61 EUR/mois.
- **Phase de test = 100 comptes max** ; coût monid.ai négligeable (~0,15 EUR le snapshot, ~22 EUR sur le mois de dev avec ~50 re-runs).
- **Garde-fous coût** : cap de requêtes par jour + mode cache / dry-run pour ne pas cramer de requêtes en debug.

### Périmètre et cap

- **Cap réaliste = 2000 comptes surveillés au maximum**, PAS les 500k. CRUD libre (ajouter / supprimer / modifier). La surveillance active est plafonnée à 2000.
- **RNE importé comme référentiel de recherche léger** (nom / mandat / territoire / parti) pour piocher et ajouter à la watchlist. La collecte sociale porte UNIQUEMENT sur les ≤2000 comptes surveillés, jamais sur les 500k. Réconcilie l'ambition « tous les élus » avec le cap 2000.
- **Découverte des handles via Wikidata (SPARQL)** pour le national et les notables, afin de pré-remplir la fiche avant l'ajout à la watchlist.
- **Réseaux cibles** : X, Instagram, Facebook, TikTok, YouTube, Twitch.

### Score de pertinence

- **Le score est un MIX** de qualité (vues, likes, engagement) ET de quantité (nombre de posts).
- **Formule** :
  - `activity_score = quantité (posts/semaine) + qualité (engagement moyen likes/vues normalisés) + reach (followers)`
  - `watch_score = activity_score × poids_mandat` (poids tunable)
- **Chiffre-roi affiché = followers par réseau.**

### Ordre de build (branches à partir d'un tronc)

- **Les 5 capacités sont toutes core** — Classement, Fiche élu, Comparateur, Radar nouveaux posts, Gestion watchlist — un produit intégré, aucune n'est jetable en v1.
- **Séquence** :
  1. **TRONC** : watchlist CRUD + collecteur monid.ai + moteur de scoring
  2. **Classement** (écran-thèse « qui surveiller »)
  3. **Fiche élu**
  4. **Comparateur**
  5. **Radar nouveaux posts**

### Orientation LFI

- **Couche de tags** (camp : insoumis / allié / adversaire) + seeds par défaut.
- **Le moteur reste agnostique** : n'importe quel compte de n'importe quel réseau peut être suivi et scoré.

## Questions encore ouvertes / à trancher plus tard

- **Fréquence de refresh définitive** par tier (le coût mensuel varie de 12 à 90 EUR selon le choix) — à arbitrer une fois le volume réel connu.
- **Cible de déploiement** : local d'abord (`node src/server.js`) ; VPS ou NAS à décider plus tard (Docker absent en local).
- **Réglage des poids** : `poids_mandat` et la pondération relative activité / qualité / reach dans `activity_score` restent à calibrer.
- **Cadre RGPD / légal** : finalité d'intérêt public/journalistique à documenter, mentions légales, droit d'opposition, minimisation des données (profilage de personnes incluant la date de naissance issue du RNE).

## Prochaines étapes (Phase 2)

- Import du RNE comme référentiel de recherche léger + découverte Wikidata (SPARQL) pour pré-remplir les handles.
- Construire le tronc : watchlist CRUD, collecteur monid.ai (avec cap requêtes/jour + mode cache/dry-run), moteur de scoring.
- Démarrer la phase de test sur ≤100 comptes pour valider la chaîne de collecte et de scoring avant de monter en volume.
</content>
</invoke>
