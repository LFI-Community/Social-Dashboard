# Product Brief — Veille Élus

**Date :** 2026-07-21
**Statut :** v1 (issu du brainstorm BMAD du 2026-07-21)
**Format :** BMAD Product Brief

---

## 1. Problème & contexte

Les élu·es et militant·es de La France Insoumise doivent suivre l'activité en ligne d'un grand nombre d'acteurs politiques (allié·es à mobiliser, adversaires à surveiller), répartis sur six réseaux sociaux (X, Instagram, Facebook, TikTok, YouTube, Twitch). Aujourd'hui ce suivi est manuel, dispersé et non mesurable : impossible de savoir en un coup d'œil **qui poste, combien, avec quel impact**, ni **qui vaut la peine d'être surveillé en priorité**.

Deux réalités rendent l'exhaustivité impossible :

- Le **Répertoire National des Élus (RNE)** contient ~500 000 élu·es. Surveiller activement chaque compte de chacun est ni tenable techniquement, ni finançable.
- Les réseaux fermés (X, Instagram, Facebook, TikTok) n'exposent **pas d'API gratuite** exploitable : la collecte passe par un service payant à la requête.

**Pour qui :** utilisateur n°1 = les élu·es et militant·es LFI. L'outil est explicitement orienté LFI (tags de camp, seeds par défaut), tout en gardant un moteur agnostique capable de traiter n'importe quel compte de n'importe quel réseau.

L'outil réconcilie l'ambition « suivre le paysage politique » avec une contrainte assumée : **un référentiel large pour chercher, une surveillance active plafonnée à 2000 comptes**.

## 2. Utilisateurs cibles & jobs-to-be-done

**Utilisateur n°1 — Élu·e / militant·e LFI (chargé·e de veille, communicant·e).**

Jobs-to-be-done :

- **JTBD-1 — Prioriser** : « Sur des milliers de comptes possibles, dis-moi lesquels méritent mon attention (les plus actifs, les plus suivis, les plus engageants). »
- **JTBD-2 — Suivre un·e acteur·rice** : « Montre-moi l'activité d'un·e élu·e donné·e réseau par réseau : nombre d'abonnés, rythme de publication, posts qui percent. »
- **JTBD-3 — Comparer** : « Mets deux élu·es côte à côte pour du benchmarking factuel (pas pour prouver quelque chose). »
- **JTBD-4 — Être alerté·e** : « Préviens-moi des nouveaux posts et de ceux qui montent (hot posts). »
- **JTBD-5 — Gérer le périmètre** : « Ajoute, retire ou modifie librement les comptes que je surveille, dans la limite du budget. »

## 3. Proposition de valeur

Un **tableau de bord de veille unifié** qui, sur un périmètre maîtrisé de comptes, répond à la question centrale **« qui surveiller ? »** avec des chiffres et non des impressions.

- **Un chiffre-roi lisible** par élu·e et par réseau : le **nombre d'abonnés**.
- **Un score de pertinence** combinant quantité (rythme de publication) et qualité (engagement : vues, likes) pondéré par le poids du mandat → un **classement actionnable**.
- **Multi-réseaux** (6 réseaux) sous une seule interface.
- **Orienté LFI mais extensible** : tags de camp (insoumis / allié / adversaire) et seeds par défaut, sur un moteur qui reste agnostique.
- **Coût maîtrisé et prévisible** : collecte étagée pour tenir un budget mensuel de l'ordre de quelques dizaines d'euros.

## 4. Périmètre MVP

Les **5 capacités sont toutes core** : produit intégré, aucune n'est jetable en v1.

1. **Classement** — écran-thèse « qui surveiller » : liste triée par score de pertinence.
2. **Fiche élu** — vue par personne : abonnés par réseau, rythme, hot posts.
3. **Comparateur** — deux élu·es côte à côte, benchmarking factuel.
4. **Radar nouveaux posts** — détection des nouveaux posts et des posts qui percent.
5. **Gestion watchlist** — CRUD libre (ajouter / retirer / modifier) des comptes surveillés.

### Ordre de build : tronc → branches

- **TRONC** (fondation transverse) :
  - Watchlist CRUD (le périmètre des ≤2000 comptes surveillés).
  - Collecteur **monid.ai** (voie principale) + collecteurs gratuits **YouTube Data API v3** et **Twitch Helix**.
  - **Moteur de scoring** : `activity_score = quantité (posts/semaine) + qualité (engagement moyen likes/vues normalisés) + reach (followers)` ; `watch_score = activity_score × poids_mandat` (poids tunable).
- **Branches, dans l'ordre :**
  1. Classement (l'écran-thèse, construit en premier car il justifie l'outil)
  2. Fiche élu
  3. Comparateur
  4. Radar nouveaux posts

**Découverte & référentiel (support MVP) :**

- Import **RNE** comme **référentiel de recherche léger** (nom / mandat / territoire / parti) pour piocher et ajouter à la watchlist — jamais de collecte sociale sur les 500k.
- Découverte des handles via **Wikidata SPARQL** (national + notables) pour pré-remplir avant ajout. Propriétés : P2002 (X), P2003 (Instagram), P2013 (Facebook), P2397 (YouTube), P7085 (TikTok).

## 5. Hors-périmètre / non-goals

- **Pas de collecte sociale sur les ~500 000 élu·es du RNE.** Le RNE est un référentiel de recherche, pas une cible de surveillance. La collecte reste bornée aux ≤2000 comptes de la watchlist.
- **Pas de proxy / scraping DIY en v1.** Le proxy résout l'IP mais pas les login-walls (X/Insta/FB), ni l'anti-bot TikTok, ni la charge de maintenance ; plus cher et plus fragile à l'échelle 2000. Conservé comme **plan B théorique** uniquement.
- **Pas de Mastodon ni Bluesky** dans les réseaux cibles (écartés).
- **Pas d'outil grand public neutre** : l'orientation LFI est assumée (le moteur reste agnostique, mais le produit est cadré LFI).
- **Le comparateur n'est pas un outil de démonstration/argumentaire** : benchmarking factuel seulement.

## 6. Contraintes

- **Cap de surveillance : 2000 comptes maximum** (CRUD libre en-dessous). Un·e élu·e sur 4 réseaux = 4 comptes.
- **Budget de collecte (monid.ai à 0,0015 €/requête, soit 1,50 € les 1000) :**
  - Phase de test = **100 comptes** → ~20-25 € sur le mois de dev (re-runs inclus).
  - À 2000 comptes : **~12 €/mois** (followers hebdo) à **~90 €/mois** (quotidien).
  - Blend étagé retenu : **Tier A 300 VIP quotidien + hot posts** + **Tier B 1700 hebdo léger** ≈ **~61 €/mois**.
  - Compléments **gratuits** : YouTube Data API v3 et Twitch Helix.
- **Garde-fous coût (obligatoires) :** cap de requêtes/jour + mode **cache / dry-run** pour ne pas cramer de requêtes en debug.
- **Réseaux fermés sans API gratuite** (X, Instagram, Facebook, TikTok) : dépendance à un tiers payant (monid.ai) → coût à l'usage et dépendance externe à assumer.
- **RGPD / légal :** profiler des personnes (dont la date de naissance issue du RNE) relève du RGPD. À documenter : finalité d'intérêt public / journalistique, mentions légales, droit d'opposition, minimisation des données.
- **Stack imposée (scaffold Phase 0 fait) :** Node ESM + Express + better-sqlite3 (WAL) + EJS + auth PIN/cookie HMAC. Port 3040. Déploiement local d'abord (`node src/server.js`), cible VPS/NAS à décider plus tard ; Docker absent en local.

## 7. Métriques de succès

- **Périmètre opérationnel :** watchlist alimentée et maintenue dans la limite des 2000 comptes, sans jamais dépasser le cap.
- **Budget tenu :** coût mensuel de collecte conforme à la cible (~61 €/mois en régime blend), garde-fous jour/dry-run effectifs (zéro dépassement accidentel en debug).
- **Pertinence du classement :** le Top de l'écran « qui surveiller » correspond aux comptes réellement les plus actifs/suivis/engageants (validation par les militant·es).
- **Fraîcheur :** Tier A rafraîchi quotidiennement, Tier B hebdomadairement, nouveaux posts détectés dans la fenêtre annoncée.
- **Adoption :** les 5 capacités utilisées (classement consulté, fiches ouvertes, comparaisons lancées, radar suivi, watchlist éditée).
- **Complétude des comptes :** taux de comptes surveillés dont les handles sont résolus (via Wikidata + ajout manuel).

## 8. Risques principaux (résumé — le pre-mortem détaillera)

- **Dépendance à monid.ai** : fournisseur tiers unique pour les 4 réseaux fermés (disponibilité, évolution des prix, qualité/complétude des données).
- **Dérapage budgétaire** : mauvaise étagement ou re-runs de debug non capés → coût qui explose ; d'où les garde-fous jour/dry-run.
- **Fiabilité des handles** : mauvais rattachement compte↔personne (homonymes, comptes parodiques, comptes abandonnés) faussant le classement.
- **Exposition RGPD / légale** : profilage de personnes physiques ; finalité et droits à cadrer avant mise en ligne.
- **Anti-bot / évolution des plateformes** : changements côté réseaux pouvant dégrader la collecte (risque reporté sur le fournisseur, mais impact produit réel).
- **Sur-périmètre** : les 5 capacités toutes core en v1 → risque de dispersion ; l'ordre tronc→branches est la parade.
- **Qualité du score** : formule de pertinence mal calibrée (poids de mandat, normalisation engagement) donnant un classement peu crédible.

---

*Ce brief fige les décisions actées lors du brainstorm BMAD du 2026-07-21. Prochaines étapes : PRD, puis Architecture.*
