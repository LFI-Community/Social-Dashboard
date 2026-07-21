# Veille Élus — Spécification technique / Architecture

> Document d'architecture issu du brainstorm BMAD (facilitateur, session 2026-07-21).
> Décisions actées : voir `_bmad-output/brainstorming/brainstorm-veille-elus-arch-2026-07-21/.memlog.md`.
> Cible : produit intégré unique, collecte étagée budget-aware, cap 2000 comptes surveillés.

---

## 1. Vue d'ensemble & principes

### 1.1 Objet

Outil de veille des comptes réseaux sociaux d'élu·es et personnalités politiques françaises. Utilisateur n°1 = **élus et militants de La France Insoumise** ; l'outil est orienté LFI (seeds + tags de camp) mais le **moteur reste agnostique** : il sait surveiller n'importe quel compte de n'importe quel réseau cible.

« Surveiller » un compte signifie :
- détecter les nouveaux posts,
- remonter les données du post (hot posts : vues, likes, engagement),
- suivre le **nombre de followers** par réseau (chiffre-roi affiché par élu),
- calculer un **score de pertinence** (« qui surveiller »).

### 1.2 Cinq capacités, un seul produit

Les cinq capacités sont **toutes core**, aucune n'est jetable en v1 :

| # | Capacité | Rôle |
|---|----------|------|
| — | **Watchlist CRUD** | Tronc : ajouter/supprimer/modifier librement les comptes surveillés |
| 1 | **Classement** | Écran-thèse « qui surveiller » (tri par `watch_score`) |
| 2 | **Fiche élu** | Vue 360° d'une personne (mandats, comptes, followers, hot posts) |
| 3 | **Comparateur** | Benchmarking pur de 2 à 4 élus côte à côte |
| 4 | **Radar nouveaux posts** | Flux des posts récents détectés sur la watchlist |

Ordre de build : **TRONC** (watchlist CRUD + collecteur monid.ai + moteur scoring) → **1. Classement** → **2. Fiche** → **3. Comparateur** → **4. Radar**.

### 1.3 Principes architecturaux

- **Moteur unique** : un seul pipeline `collecteur → rollups → scoring → stats`, partagé par les cinq écrans. Les collecteurs sont interchangeables derrière une interface commune (`resolve` / `fetchPosts`).
- **Référentiel large, collecte étroite** : le RNE (~500k élus) est importé comme **référentiel de recherche léger** (nom / mandat / territoire / parti) pour piocher et ajouter à la watchlist. La **collecte sociale ne porte QUE sur les ≤ 2000 comptes surveillés**, jamais sur les 500k.
- **Cap réaliste = 2000 comptes surveillés**. L'architecture n'est plus contrainte par l'échelle, seulement par la **fréquence** de rafraîchissement choisie.
- **Collecte étagée Tier A / B / C** (voir §3.4) : la fréquence, pas le volume, pilote le coût.
- **Budget-aware** : voie principale = API managée **monid.ai** à 0,0015 €/requête, avec garde-fous (cap requêtes/jour + mode cache/dry-run). Compléments gratuits : YouTube Data API + Twitch Helix.
- **Orientation LFI = couche de tags** (camp : insoumis / allié / adversaire) + seeds par défaut, posée par-dessus un moteur neutre.
- **RGPD** : profilage de personnes (dont date de naissance RNE) → finalité d'intérêt public à documenter, minimisation, droit d'opposition (voir README §légal).

### 1.4 Stack (scaffold Phase 0 fait)

Node ESM + Express + better-sqlite3 (WAL) + EJS + auth PIN/cookie HMAC. Port **3040**. Déploiement local d'abord (`node src/server.js`), cible VPS/NAS à décider. Pas de Docker en local.

### 1.5 Budget de référence (rappel des décisions)

| Scénario | Comptes | Fréquence | Coût monid.ai |
|----------|---------|-----------|---------------|
| Phase test (dev) | 100 | ad hoc + re-runs | ~20-25 €/mois de dev |
| Hebdo léger | 2000 | followers hebdo | ~12 €/mois |
| Quotidien plein | 2000 | quotidien | ~90 €/mois |
| **Blend cible** | 300 Tier A quotidien hot-posts + 1700 Tier B hebdo | mixte | **~61 €/mois** |

---

## 2. Modèle de données SQLite

Le schéma **existe déjà** dans `src/db.js` (WAL, `foreign_keys = ON`, migrations idempotentes via `addColumn()`). Cette section décrit le modèle **cible** : ce qui existe et ce qu'il faut **ajouter** (colonnes marquées ➕).

### 2.1 `persons` — personnes (élus RNE + personnalités hors mandat)

*Existe.* Colonnes clés :

| Colonne | Type | Note |
|---------|------|------|
| `id` | INTEGER PK | |
| `slug` | TEXT UNIQUE | `slugify(display_name)` |
| `display_name` | TEXT NOT NULL | |
| `first_name` / `last_name` | TEXT | |
| `birth_date` | TEXT | `YYYY-MM-DD` (RNE) ou `''` |
| `gender` | TEXT | `F` / `M` / `''` |
| `wikidata_qid` | TEXT UNIQUE | `Q...` si connu |
| `is_public_figure` | INTEGER | 1 = hors mandat |
| `dedup_key` | TEXT | `normalize(last+first+birth)` — clé d'upsert RNE |
| `created_at` / `updated_at` | TEXT | |

**Dédup RNE (le RNE n'a pas d'identifiant unique)** : clé = `dedupKey({last_name, first_name, birth_date})` (`src/util.js`) = `normalize(last) | normalize(first) | birth_date`. `normalizeName()` retire accents, minuscule, réduit aux `[a-z0-9 ]`. Index `ix_persons_dedup`. L'import RNE fait un **upsert** sur cette clé : une personne cumulant plusieurs mandats = 1 ligne `persons` + N lignes `mandates`.

### 2.2 `mandates` — mandats (1 ligne RNE = 1 mandat)

*Existe.* Une personne peut en cumuler plusieurs.

| Colonne | Type | Note |
|---------|------|------|
| `id` | INTEGER PK | |
| `person_id` | FK → persons ON DELETE CASCADE | |
| `mandate_type` | TEXT NOT NULL | `maire`,`depute`,`senateur`,`cm`,`epci`,`cd`,`cr`,`mep`,`arrondissement`,`afe`,`autre` |
| `level` | TEXT | national / régional / départemental / communal / intercommunal / européen |
| `function_label` | TEXT | ex. « Maire », « Adjoint au maire » |
| `territory_code` / `territory_label` | TEXT | |
| `start_date` | TEXT | |
| `mandate_weight` | REAL | poids institutionnel (voir §4.3) |
| `source` | TEXT | ex. `rne:elus-maires` |
| `source_row_hash` | TEXT | **idempotence import** (hash de la ligne source) |

Index `ix_mandates_person`.

### 2.3 `parties` + `person_parties`

*Existe.* `parties(id, name, short, color, wikidata_qid UNIQUE)`. Relation N-N `person_parties(person_id, party_id, role, is_current, PK(person_id, party_id))`. Seed depuis `data/partis-data.json` (Phase 2).

### 2.4 `accounts` — comptes sociaux surveillés

*Existe, à compléter.* Rattaché à une personne **ou** standalone (`person_id NULL`).

| Colonne | Type | Note |
|---------|------|------|
| `id` | INTEGER PK | |
| `person_id` | FK → persons ON DELETE SET NULL | NULL = compte standalone |
| `network` | TEXT NOT NULL | `x`,`instagram`,`facebook`,`tiktok`,`youtube`,`twitch` |
| `handle` | TEXT | @pseudo |
| `account_ref` | TEXT NOT NULL | **clé stable** : channel id / user id / URL canonique |
| `display_name` / `url` | TEXT | |
| `followers` | INTEGER | **chiffre-roi** (dernier snapshot) |
| `verified` | INTEGER | |
| `is_standalone` | INTEGER | 1 = pas de personne rattachée |
| `active` | INTEGER | 1 = dans la watchlist active |
| `added_by` | TEXT | `wikidata` / `regardscitoyens` / `manual` |
| `source_confidence` | REAL | |
| `last_checked_at` | TEXT | |
| ➕ `tier` | TEXT DEFAULT 'B' | **`A` / `B` / `C`** — étage de collecte (§3.4) |
| ➕ `camp` | TEXT DEFAULT '' | **tag orientation : `insoumis` / `allie` / `adversaire` / `''`** |

Contrainte `UNIQUE (network, account_ref)`. Index `ix_accounts_person`, `ix_accounts_network`. ➕ Ajouter `ix_accounts_tier ON accounts(tier, active)` pour la sélection du scheduler.

> **À ajouter** via `addColumn('accounts','tier',"tier TEXT NOT NULL DEFAULT 'B'")` et `addColumn('accounts','camp',"camp TEXT NOT NULL DEFAULT ''")`.

### 2.5 `posts` — hot posts détaillés

*Existe, à compléter.* Stocké seulement pour les comptes réellement surveillés (Tier A surtout).

| Colonne | Type | Note |
|---------|------|------|
| `id` | INTEGER PK | |
| `account_id` | FK → accounts ON DELETE CASCADE | |
| `external_id` | TEXT NOT NULL | id du post chez le réseau |
| `posted_at` | TEXT NOT NULL | ISO |
| `url` | TEXT | |
| `like_count` | INTEGER | |
| ➕ `view_count` | INTEGER DEFAULT 0 | **vues** (hot posts) |
| ➕ `comment_count` | INTEGER DEFAULT 0 | commentaires (si dispo) |
| ➕ `share_count` | INTEGER DEFAULT 0 | partages/retweets (si dispo) |
| ➕ `engagement` | REAL DEFAULT 0 | **score d'engagement calculé** (§4.2) |
| `collected_at` | TEXT | |

Contrainte `UNIQUE (account_id, external_id)` (dédup naturelle des posts au refresh). Index `ix_posts_acc(account_id, posted_at)`.

> **À ajouter** : `view_count`, `comment_count`, `share_count`, `engagement` via `addColumn()`.

### 2.6 `activity_daily` — rollup journalier

*Existe.* 1 ligne / compte / jour, évite de stocker chaque post à l'échelle du référentiel.

`activity_daily(account_id, day 'YYYY-MM-DD', posts_count, PK(account_id, day))`. Alimenté par le collecteur (comptage des posts du jour). ➕ Optionnel : `sum_engagement REAL DEFAULT 0` pour agréger la qualité sans relire `posts`.

### 2.7 `account_stats` — stats calculées par fenêtre

*Existe, à compléter.* Une ligne par `(account_id, window_days)` (fenêtres 30 / 90 j).

| Colonne | Type | Note |
|---------|------|------|
| `account_id` | FK → accounts ON DELETE CASCADE | |
| `window_days` | INTEGER | 30 / 90 |
| `posts_count` | INTEGER | posts sur la fenêtre |
| `posts_per_week` | REAL | **quantité** |
| `last_post_at` | TEXT | |
| `active_days` | INTEGER | jours avec ≥ 1 post |
| ➕ `quality` | REAL DEFAULT 0 | **engagement moyen normalisé** (§4.2) |
| ➕ `reach` | REAL DEFAULT 0 | **followers normalisés** (§4.2) |
| `activity_score` | REAL | quantité + qualité + reach (§4.1) |
| `watch_score` | REAL | `activity_score × poids_mandat` |
| `computed_at` | TEXT | |

PK `(account_id, window_days)`. Index `ix_stats_watch(window_days, watch_score)` pour le classement.

> **À ajouter** : `quality`, `reach` via `addColumn()`.

### 2.8 `collectors` — registre des collecteurs

*Existe.* `collectors(id, network UNIQUE, name, kind 'free'|'paid', enabled, config JSON)`.

> **Évolution décidée** : la voie principale des réseaux fermés (X/Insta/FB/TikTok) devient **monid.ai** (API managée), et non plus Apify (relégué en plan B théorique). Le seed courant (`apify_x`…, `kind='paid'`, `enabled=0`) doit être **re-seedé** pour pointer sur le collecteur monid.ai (voir §3.2). Garde le double garde-fou : payant activé uniquement si `enabled=1` **et** `ENABLE_PAID=1`.

### 2.9 `collection_runs` — journal des collectes (audit / quotas)

*Existe, à compléter.* Sert au débug quotas et au suivi de coût.

| Colonne | Type | Note |
|---------|------|------|
| `id` | INTEGER PK | |
| `account_id` | FK → accounts ON DELETE SET NULL | |
| `collector` | TEXT | réseau/collecteur |
| `started_at` / `finished_at` | TEXT | |
| `status` | TEXT | `running` / `ok` / `error` |
| `posts_found` | INTEGER | |
| `error` | TEXT | |
| ➕ `requests_count` | INTEGER DEFAULT 0 | **nb de requêtes facturées** (monid.ai) |
| ➕ `cost_eur` | REAL DEFAULT 0 | `requests_count × 0.0015` |
| ➕ `dry_run` | INTEGER DEFAULT 0 | 1 = exécution sans requête réelle |

> **À ajouter** : `requests_count`, `cost_eur`, `dry_run`. Ces colonnes alimentent le compteur quotidien (§3.5).

### 2.10 `settings`

*Existe.* `settings(key PRIMARY KEY, value)`. Seeds actuels : `watchlist_size=300`, `default_window=90`. ➕ À seeder : `daily_request_cap`, `dry_run` (0/1), `monid_rate_eur=0.0015`, `tier_a_freq=daily`, `tier_b_freq=weekly`.

### 2.11 Résumé des deltas vs `src/db.js`

| Table | À ajouter |
|-------|-----------|
| `accounts` | `tier`, `camp` + index `ix_accounts_tier` |
| `posts` | `view_count`, `comment_count`, `share_count`, `engagement` |
| `activity_daily` | `sum_engagement` (optionnel) |
| `account_stats` | `quality`, `reach` |
| `collection_runs` | `requests_count`, `cost_eur`, `dry_run` |
| `collectors` | re-seed monid.ai (remplace apify_* comme voie principale) |
| `settings` | `daily_request_cap`, `dry_run`, `monid_rate_eur`, `tier_a_freq`, `tier_b_freq` |

Tous via `addColumn()` (idempotent) — aucune destruction de données.

---

## 3. Collecte

### 3.1 Interface collecteur

Contrat commun (`src/collectors/base.js`, déjà défini). Chaque collecteur exporte par défaut un objet :

```js
{
  network: 'x' | 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'twitch',
  kind:    'free' | 'paid',
  // Résout un compte depuis un handle/ref
  // -> { account_ref, display_name, url, followers, verified } | null
  async resolve(handleOrRef) {},
  // Récupère les posts depuis sinceDate (ISO)
  // -> [{ external_id, posted_at, url, like_count, view_count, comment_count, share_count }]
  async fetchPosts(account, sinceDate) {},
}
```

`assertCollector()` valide la présence de `network`, `kind`, `resolve`, `fetchPosts`. La `registry.js` charge en **import paresseux** uniquement les collecteurs implémentés, et n'expose un collecteur payant que si `enabled=1` **et** `ENABLE_PAID=1`.

> **Extension du contrat** : `fetchPosts` doit désormais renvoyer aussi `view_count` / `comment_count` / `share_count` quand la source les fournit (hot posts). Champs absents → 0.

### 3.2 Collecteur monid.ai (principal, requêtes comptées)

`src/collectors/monid.js` — voie **principale** pour les réseaux fermés (X, Instagram, Facebook, TikTok). API managée qui résout le login-wall / anti-bot que le proxy DIY ne résout pas.

- **Un seul module** couvrant plusieurs réseaux (paramètre `network` passé à l'appel), ou un thin wrapper par réseau réutilisant un client `monidClient.js`.
- **Tarif** : 0,0015 €/requête. Chaque appel `resolve` ou `fetchPosts` = **une requête facturée** → incrémente `requests_count` / `cost_eur` sur `collection_runs`.
- **Cache** : réponses mises en cache (TTL par tier) pour éviter de refacturer un compte déjà rafraîchi dans la fenêtre. En **dry-run**, sert le cache (ou un fixture) sans appel réseau.
- **Cap/jour** : avant tout appel, vérifier le compteur du jour (§3.5) ; au-dessus du cap → l'appel est refusé (log `error='daily_cap'`), la collecte s'arrête proprement.
- **Config** : clé API dans `.env` (`MONID_API_KEY`), `config` JSON du registre pour endpoints/mapping par réseau.

> Plan B (théorique, non implémenté v1) : proxy + DIY-scraping. Écarté : le proxy résout l'IP mais **pas** le login-wall X/Insta/FB, ni l'anti-bot TikTok, ni la maintenance ; plus cher et plus fragile à l'échelle 2000. Les stubs `apify_*` restent OFF.

### 3.3 Collecteurs gratuits — complément

- **`src/collectors/youtube.js`** — YouTube Data API v3 (clé `YOUTUBE_API_KEY`). `resolve` : `channels.list` (statistics → `followers` = subscriberCount). `fetchPosts` : `search.list`/`playlistItems` + `videos.list` (viewCount, likeCount, commentCount). Quota gratuit (10 000 unités/jour) → surveiller la consommation via `collection_runs`.
- **`src/collectors/twitch.js`** — Twitch Helix (client id/secret → token app). `resolve` : `Get Users` + `Get Channel Followers` (followers). `fetchPosts` : Twitch n'a pas de « posts » classiques → mapper sur les VODs/clips récents (`Get Videos`/`Get Clips`) comme événements d'activité.

Ces deux réseaux **ne consomment pas** de budget monid.ai (compteur de coût = 0).

### 3.4 Scheduler étagé (node-cron)

`src/scheduler.js` — trois étages, la fréquence pilote le coût :

| Tier | Cible | Fréquence | Contenu collecté |
|------|-------|-----------|------------------|
| **A** | ~300 VIP (`tier='A'`) | **quotidien** | followers + **hot posts** (vues/likes/engagement) |
| **B** | ~1700 (`tier='B'`) | **hebdo** | followers + comptage de posts (léger) |
| **C** | à la demande | **manuel** | refresh ponctuel via `POST /api/accounts/:id/refresh` |

Fréquences lues dans `settings` (`tier_a_freq`, `tier_b_freq`) → jobs node-cron. Chaque run : sélectionne les comptes actifs du tier (`WHERE active=1 AND tier=?`), appelle le collecteur du réseau, écrit `posts` + `activity_daily`, journalise `collection_runs`, puis déclenche le recalcul `account_stats` (§4). Le scheduler respecte le cap/jour : s'il atteint le plafond en cours de Tier B, il **reprend le lendemain**.

### 3.5 Garde-fous coût (obligatoires)

1. **Cap requêtes/jour** — `settings.daily_request_cap`. Compteur = `SUM(requests_count)` sur `collection_runs` où `date(started_at)=aujourd'hui`. Tout collecteur payant vérifie le compteur avant d'appeler ; dépassement → refus + log. Empêche de cramer le budget en boucle.
2. **Mode cache / dry-run** — `settings.dry_run=1` (ou flag CLI `--dry-run`, ou `DRY_RUN=1`) : aucun appel réseau facturé ; sert le cache/fixtures. Sert au débug des écrans et du scoring sans coût. `collection_runs.dry_run=1`, `cost_eur=0`.
3. **Cache par tier** — TTL aligné sur la fréquence (A : 20 h, B : 6 j) : re-run rapproché = pas de refacturation.
4. **Journal de coût** — `collection_runs.requests_count`/`cost_eur` → tableau de bord admin « dépense du mois » vs budget cible (~61 €).

---

## 4. Moteur de scoring

`src/scoring.js` — un seul moteur, recalcule `account_stats` après chaque collecte. Le **chiffre-roi affiché** reste `accounts.followers` (par réseau) ; le **score sert au classement** « qui surveiller ».

### 4.1 Formule

Pour chaque `(account, window_days)` :

```
activity_score = w_q · quantite + w_e · qualite + w_r · reach
watch_score    = activity_score × poids_mandat
```

- `quantite`, `qualite`, `reach` sont **chacun normalisés** sur [0, 1].
- Poids par défaut `w_q = w_e = w_r = 1` (tunables via `settings`).
- L'activité (quantité) utilise une **échelle logarithmique** pour éviter qu'un compte hyperactif écrase tout.

### 4.2 Les trois composantes

**Quantité** (rythme de publication) :
```
posts_per_week = posts_count / (window_days / 7)
quantite = log1p(posts_per_week) / log1p(QMAX)        // QMAX ≈ 50 posts/sem (borne haute)
```

**Qualité** (engagement moyen des posts de la fenêtre) :
```
engagement(post) = (likes + comments + shares) / max(views, 1)   // taux d'engagement
// à défaut de views (réseau sans vues) : engagement = log1p(likes + comments + shares) normalisé
quality_raw = moyenne des engagement(post) sur la fenêtre
qualite = min(quality_raw / EMAX, 1)                 // EMAX = taux d'engagement de référence
```
Stocké dans `account_stats.quality`. L'engagement par post est aussi persisté dans `posts.engagement` (tri des hot posts sur la fiche).

**Reach** (audience) :
```
reach = log1p(followers) / log1p(RMAX)               // RMAX ≈ 10^7 followers
```
Stocké dans `account_stats.reach`.

> Les bornes `QMAX`, `EMAX`, `RMAX` (et les poids `w_*`) sont des réglages dans `settings`, ajustables sans redéploiement. La normalisation log borne naturellement les composantes sur [0, 1].

### 4.3 Poids de mandat

`watch_score = activity_score × poids_mandat`. Le poids provient du mandat le plus fort de la personne (`MAX(mandate_weight)` sur ses mandats) ; un compte standalone tagué personnalité utilise `public_figure`. Table indicative (`src/util.js` → `MANDATE_WEIGHT`, déjà présente) :

| Type | Poids | Type | Poids |
|------|-------|------|-------|
| `mep`, `ministre` | 1,0 | `maire` | 0,6 |
| `depute`, `senateur` | 0,9 | `cr`, `cd` | 0,5 |
| `cr_president`, `cd_president` | 0,85 | `epci` | 0,35 |
| `maire_grande_ville` | 0,8 | `arrondissement`, `afe` | 0,3 |
| `public_figure` | 0,7 | `cm`, `autre` | 0,25 |

Poids **tunable** : le classement se re-trie sans recollecter (recalcul `watch_score` seul).

### 4.4 Persistance

À chaque recalcul : `posts_count`, `posts_per_week`, `active_days`, `last_post_at`, `quality`, `reach`, `activity_score`, `watch_score`, `computed_at` sont écrits dans `account_stats` pour les fenêtres 30 et 90 j. Le classement (`ranking()` dans `server.js`) lit déjà cette table triée par `watch_score` — aucun calcul à la requête.

---

## 5. Import RNE + Wikidata + Regards Citoyens

Trois importeurs sous `src/importers/`, tous **hors collecte sociale** (référentiel uniquement).

### 5.1 `rne.js` — référentiel de recherche léger

- Source : RNE (Répertoire National des Élus, data.gouv.fr), CSV par type de mandat (`rne:elus-maires`, `-deputes`, `-senateurs`, `-cd`, `-cr`, `-epci`, …).
- Charge **nom / prénom / date de naissance / mandat / territoire / parti** → tables `persons` + `mandates`.
- **Pas de collecte auto** : aucun compte social n'est créé. Le RNE sert à **rechercher** un élu et l'**ajouter** à la watchlist.
- **Dédup / idempotence** : upsert `persons` sur `dedup_key` (§2.1) ; upsert `mandates` sur `source_row_hash` (hash de la ligne CSV) pour rejouer un import sans doublon.
- Réalité assumée : ~500k lignes → le référentiel tient (SQLite + index), la collecte reste plafonnée à 2000.

### 5.2 `wikidata.js` — découverte des handles (SPARQL)

- Requête SPARQL sur Wikidata pour **national + notables** afin de **pré-remplir les handles avant l'ajout** à la watchlist.
- Propriétés récupérées :

| Prop | Réseau |
|------|--------|
| `P2002` | X / Twitter |
| `P2003` | Instagram |
| `P2013` | Facebook |
| `P2397` | YouTube (channel id) |
| `P7085` | TikTok |

- Rattache les comptes trouvés à la personne via `wikidata_qid` (déjà sur `persons`). Les comptes créés portent `added_by='wikidata'` et une `source_confidence` < 1 tant que non vérifiés par `resolve()`.
- Twitch : pas de propriété Wikidata dédiée fiable → ajout manuel.

### 5.3 `regardscitoyens.js` — enrichissement parlementaires

- Source : données ouvertes Regards Citoyens / NosDéputés / NosSénateurs.
- Enrichit les **parlementaires** (députés, sénateurs) : rattachement parti, groupe, identifiants, éventuels comptes sociaux officiels.
- Complète `persons` / `person_parties` / `accounts` (`added_by='regardscitoyens'`) sans déclencher de collecte.

> Aucun de ces trois importeurs n'appelle monid.ai. Ils remplissent le référentiel ; la collecte sociale démarre seulement quand un compte passe `active=1` dans la watchlist.

---

## 6. Routes / API + UI

Base existante dans `server.js` : auth PIN → cookie HMAC (`requireAdmin`), anti-bruteforce login, EJS, API JSON. Les routes marquées ➕ sont à ajouter.

### 6.1 Watchlist CRUD (tronc)

| Méthode | Route | Auth | État |
|---------|-------|------|------|
| POST | `/api/accounts` | admin | ✔ (existe) — `person_id` optionnel → standalone |
| DELETE | `/api/accounts/:id` | admin | ✔ (existe) |
| POST | `/api/accounts/:id/refresh` | admin | ⏳ 501 → Phase 3 (Tier C) |
| ➕ PATCH | `/api/accounts/:id` | admin | modifier `tier`, `camp`, `active`, rattachement `person_id` |
| ➕ POST | `/api/accounts/:id/resolve` | admin | appelle `collector.resolve()` pour valider handle → followers |

### 6.2 Classement (capacité 1)

| Méthode | Route | État |
|---------|-------|------|
| GET | `/` | ✔ dashboard, top 100 par `watch_score` |
| GET | `/api/ranking?limit=` | ✔ (cap 500) |

➕ Filtres : `?network=`, `?camp=`, `?tier=`, `?window=30|90`. Écran-thèse « qui surveiller » = tri `watch_score` DESC.

### 6.3 Fiche élu (capacité 2)

| Méthode | Route | État |
|---------|-------|------|
| GET | `/person/:id` (id ou slug) | ✔ — mandats + comptes + stats |

➕ Enrichir : **followers par réseau** (chiffre-roi), **hot posts** (top `posts` par `engagement`), sparkline `activity_daily`.

### 6.4 Comparateur (capacité 3)

| Méthode | Route | État |
|---------|-------|------|
| GET | `/compare?ids=a,b,c,d` | ✔ (2 à 4) |
| GET | `/api/compare?ids=` | ✔ |

Benchmarking pur : followers, `posts_per_week`, `watch_score` côte à côte, par réseau.

### 6.5 Radar nouveaux posts (capacité 4)

| Méthode | Route | État |
|---------|-------|------|
| ➕ GET | `/radar` | flux des posts récents détectés sur la watchlist |
| ➕ GET | `/api/radar?since=&network=&camp=` | posts triés `posted_at` DESC, jointure account/person |

### 6.6 Admin

| Route | État |
|-------|------|
| `/admin/login`, `/admin/logout`, `/admin` | ✔ |
| ➕ `/admin` — panneau collecteurs (enable/disable), **compteur coût du mois** (`collection_runs`), toggle `dry_run`, `daily_request_cap` | à enrichir |
| ➕ `/admin/search` — recherche RNE → ajout watchlist (pré-remplissage Wikidata) | Phase 2/4 |

### 6.7 Ordre de livraison

1. **Tronc** : deltas schéma (§2.11) + collecteur monid.ai + youtube/twitch + `scoring.js` + `scheduler.js` + garde-fous.
2. **Classement** : filtres + écran-thèse.
3. **Fiche élu** : followers/réseau + hot posts + sparkline.
4. **Comparateur** : finalisation benchmarking.
5. **Radar** : `/radar` + `/api/radar`.
6. Import RNE / Wikidata / Regards Citoyens (parallélisable dès le tronc).

---

## 7. Arborescence fichiers cible

```
veille-elus/
├─ src/
│  ├─ server.js            # ✔ Express + auth + routes + API
│  ├─ db.js                # ✔ schéma SQLite + migrations addColumn() + seeds (à compléter §2.11)
│  ├─ util.js              # ✔ dédup + MANDATE_WEIGHT
│  ├─ scoring.js           # ➕ moteur unique (activity_score / watch_score) → account_stats
│  ├─ scheduler.js         # ➕ node-cron étagé Tier A/B + cap quotidien + dry-run
│  ├─ collectors/
│  │  ├─ base.js           # ✔ interface resolve/fetchPosts + assertCollector
│  │  ├─ registry.js       # ✔ chargement paresseux + double garde-fou payant
│  │  ├─ monidClient.js    # ➕ client HTTP monid.ai (clé, cache, compteur requêtes)
│  │  ├─ monid.js          # ➕ collecteur principal X/Insta/FB/TikTok (voie payante)
│  │  ├─ youtube.js        # ➕ YouTube Data API v3 (gratuit)
│  │  └─ twitch.js         # ➕ Twitch Helix (gratuit)
│  └─ importers/
│     ├─ rne.js            # ➕ référentiel RNE (upsert dedup_key / source_row_hash)
│     ├─ wikidata.js       # ➕ SPARQL handles (P2002/P2003/P2013/P2397/P7085)
│     └─ regardscitoyens.js# ➕ enrichissement parlementaires
├─ views/
│  ├─ dashboard.ejs        # ✔ classement
│  ├─ person.ejs           # ✔ fiche (à enrichir : followers/réseau, hot posts)
│  ├─ compare.ejs          # ✔ comparateur
│  ├─ radar.ejs            # ➕ radar nouveaux posts
│  ├─ 404.ejs              # ✔
│  └─ admin/
│     ├─ login.ejs         # ✔
│     └─ index.ejs         # ✔ (à enrichir : coût/mois, dry-run, cap, recherche RNE)
├─ public/                 # assets statiques (?v= cache-bust via app.locals.ASSET_V)
├─ data/
│  ├─ veille.db            # SQLite (WAL)
│  └─ partis-data.json     # seed partis
└─ docs/
   └─ architecture-spec.md # ce document
```

**Légende** : ✔ existe (Phase 0) · ⏳ stub à implémenter · ➕ à créer.

---

### Annexe — points de vigilance

- **RGPD** : finalité d'intérêt public/journalistique à documenter, minimisation (date de naissance = clé de dédup, pas d'affichage public gratuit), droit d'opposition, mentions légales.
- **Coût** : ne jamais lancer une collecte payante sans vérifier `daily_request_cap` ; garder `dry_run` par défaut en développement.
- **Neutralité du moteur** : les tags `camp` et les seeds LFI sont une **couche**, jamais une condition dans le pipeline de collecte/scoring.
- **Twitch** : pas de handle Wikidata fiable ni de « posts » classiques → ajout manuel + mapping VOD/clips.
```
