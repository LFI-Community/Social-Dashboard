# Pre-mortem — Veille Élus

**Date :** 2026-07-21
**Statut :** v1 (issu du brainstorm BMAD du 2026-07-21)
**Méthode :** pre-mortem adversarial — on se projette 12 mois plus tard, **le projet a échoué**. Ce document remonte les modes de défaillance les plus probables, leurs signaux d'alerte précoces et des mitigations concrètes.

> Un pre-mortem n'est pas un audit de conformité : c'est une simulation d'échec. Chaque section répond à « comment, concrètement, ce risque a-t-il tué le projet ? » puis « qu'aurait-il fallu faire ? ».

---

## Cadre de lecture

Pour chaque risque : **gravité** (haute / moyenne / basse), **signal d'alerte précoce** (ce qu'on aurait dû voir venir), **mitigation** (action concrète). Les risques sont classés du plus structurant au moins structurant. Le [TOP 3 à valider avant de coder la collecte](#top-3--à-valider-avant-décrire-du-code-de-collecte) clôt le document.

Synthèse des gravités :

| # | Risque | Gravité |
|---|--------|---------|
| 1 | Dépendance monid.ai (couverture + coût réel + fournisseur unique) | **Haute** |
| 2 | Légal / RGPD (profilage + orientation partisane) | **Haute** |
| 3 | Qualité des données (faux comptes, homonymes, handles) | Moyenne |
| 4 | Score gamable / trompeur / instable à faible N | Moyenne |
| 5 | Produit / scope creep / adoption | Moyenne |

---

## 1. Risque monid.ai — le fournisseur unique

**Gravité : HAUTE.** C'est le risque le plus probable de tuer le projet, parce que **toute la thèse produit** (« surveiller les 6 réseaux dont 4 fermés ») repose sur une hypothèse **non vérifiée** : que monid.ai couvre réellement X, Instagram, Facebook et TikTok, à un coût par requête estimé de mémoire.

### 1.1 Scénarios d'échec

- **Couverture partielle.** monid.ai couvre X et Facebook, mais pas Instagram (login-wall renforcé) ou pas TikTok (anti-bot le plus agressif du marché). Résultat : le tableau de bord affiche des trous ; 2 des 6 réseaux cibles restent vides ; l'écran-thèse « qui surveiller » est faussé car il n'agrège qu'une partie de l'activité réelle. Les militants perdent confiance dès la première fiche incomplète.
- **Coût réel par « requête » mal estimé.** Le brainstorm a raisonné « 1 appel `resolve` ou `fetchPosts` = 1 requête à 0,0015 €ﾠ». Or une « requête » côté fournisseur peut être facturée **par page de résultats**, **par post retourné**, **par crédit** avec un plancher, ou avec un tarif différent selon le réseau (TikTok/Instagram coûtant plus cher que X). Si `fetchPosts` sur un compte actif retourne 3 pages de 20 posts, c'est peut-être 3 à 60 requêtes facturées, pas 1. Le blend « ~61 €/mois » devient 300-600 €/mois. Le projet est coupé pour dépassement budgétaire.
- **Dépendance à un fournisseur unique.** monid.ai augmente ses prix, change son schéma de réponse sans préavis, impose un engagement minimum, subit une panne prolongée, ferme, ou se fait couper l'accès aux réseaux (les plateformes attaquent régulièrement les revendeurs de données). Comme **aucune alternative n'est branchée** (le plan B proxy est écarté et non implémenté), la collecte des 4 réseaux fermés s'arrête net. Le produit devient un afficheur YouTube + Twitch.
- **Latence / fiabilité.** L'API répond en 10-30 s par compte ou avec un fort taux d'erreur. Le scheduler Tier B (1700 comptes) ne termine jamais sa fenêtre hebdo ; les données sont périmées ; le radar « nouveaux posts » arrive trop tard pour être utile.

### 1.2 Signal d'alerte précoce

- La ligne budgétaire de `collection_runs.cost_eur` **diverge** dès la phase test 100 comptes : le coût réel du snapshot dépasse nettement les ~0,15 € estimés.
- Le mapping par réseau dans `monid.js` a des branches `// TODO: Instagram non supporté` ou renvoie systématiquement `followers: 0` / `[]` pour un réseau.
- Le ratio `requests_count / comptes traités` est > 1 (chaque compte coûte plusieurs requêtes), signe que le modèle de facturation n'est pas « 1 compte = 1 requête ».
- Taux d'erreur `collection_runs.status='error'` non négligeable sur un réseau donné.

### 1.3 Mitigation

- **VÉRIFICATION AVANT TOUT CODE DE COLLECTE (bloquant) :** ouvrir un compte monid.ai, prendre **5 comptes réels et représentatifs** (idéalement 1 par réseau : un X, un Instagram, un Facebook, un TikTok, + comparaison YouTube/Twitch en gratuit) et mesurer, sur pièces :
  1. **Couverture réelle** : les 4 réseaux fermés renvoient-ils vraiment followers + liste de posts + stats par post (vues, likes) ? Documenter réseau par réseau ce qui est disponible et ce qui manque.
  2. **Unité de facturation réelle** : combien de requêtes/crédits sont débitées pour 1 `resolve` et pour 1 `fetchPosts` sur un compte actif (avec pagination) ? Recalculer le coût mensuel du blend avec le chiffre **mesuré**, pas estimé.
  3. **Schéma de réponse** : champs exacts renvoyés (le contrat `fetchPosts` attend `external_id, posted_at, url, like_count, view_count, comment_count, share_count`) — lesquels sont réellement présents par réseau ?
  4. **Latence et fiabilité** : temps de réponse moyen, taux d'erreur, limites de débit (rate limit) du fournisseur.
- **Consigner le résultat** dans un `docs/monid-poc.md` (fiche de recette) : c'est cette fiche qui autorise (ou non) le passage au dev de la collecte.
- **Garde-fous coût déjà prévus** (§3.5 archi) : rendre `dry_run=1` le défaut absolu en dev, et **plafonner `daily_request_cap` très bas** (ex. 200) pendant tout le PoC pour qu'un bug de boucle ne facture pas 10 000 requêtes.
- **Découpler le fournisseur** : garder le contrat collecteur `resolve/fetchPosts` strict et générique (c'est déjà le cas) pour qu'un `monid.js` puisse être remplacé par un autre agrégateur sans toucher au scoring ni à l'UI. Lister dès maintenant **1 à 2 fournisseurs alternatifs** (autres API managées de social data) comme plan de repli documenté — même non implémentés.
- **Dégradation gracieuse** : l'UI doit afficher explicitement « réseau non collecté / donnée indisponible » plutôt qu'un `0` trompeur, pour qu'un réseau manquant ne fausse pas silencieusement le classement.
- **Définition du score robuste aux trous** : le `watch_score` ne doit pas pénaliser un compte simplement parce qu'un réseau n'est pas couvert (voir §4).

---

## 2. Risque légal / RGPD — profilage + orientation partisane

**Gravité : HAUTE.** L'outil traite des **données personnelles** de personnes physiques (nom, date de naissance issue du RNE, identifiants sociaux, activité en ligne) et les **profile** (scoring, classement). Il est de surcroît **partisan** : il tague des personnes comme « adversaire » selon un axe politique LFI. Deux régimes se cumulent : RGPD (données personnelles) **et** données à caractère politique / d'opinion, considérées comme **sensibles** (art. 9 RGPD).

### 2.1 Scénarios d'échec

- **Aucune base légale documentée.** Le projet part en prod sans finalité écrite ni base légale identifiée. Une personne fichée demande sur quel fondement elle est profilée ; il n'y a pas de réponse. Signalement CNIL, mise en demeure, retrait forcé.
- **Le tag « adversaire » requalifie le fichier.** Classer nommément des personnes selon leur position sur un axe partisan revient à traiter des **opinions politiques inférées** (données sensibles art. 9). Le fait que l'outil soit explicitement partisan **aggrave** le risque : il ne peut pas se réclamer d'une neutralité journalistique/documentaire pure, et un « fichier d'adversaires politiques » est précisément le cas d'usage que la CNIL surveille de près (cf. contentieux récurrents sur les fichiers de personnalités).
- **Date de naissance conservée sans nécessité affichée.** La date de naissance RNE sert de clé de dédup — usage légitime — mais si elle est **stockée et exposée** au-delà de ce besoin, la minimisation (art. 5) n'est pas respectée.
- **Pas de mention ni de droit d'opposition.** Les personnes fichées ne sont pas informées, ne peuvent pas s'opposer ni demander l'effacement. Non-respect des art. 12-21.
- **Fuite / diffusion.** L'outil (auth PIN unique, cookie HMAC) est exposé publiquement, ou la base `veille.db` fuite. Un fichier partisan nominatif de personnalités devient public → dommage réputationnel majeur pour LFI et pour le porteur, au-delà du risque juridique.

### 2.2 Signal d'alerte précoce

- Le README mentionne le RGPD en note mais **aucun document de finalité / base légale** n'existe avant la mise en ligne.
- La question « qui est responsable de traitement ? » (le porteur ? une structure LFI ? une association ?) n'a pas de réponse claire.
- Des données sensibles (camp politique, date de naissance) sont affichées dans l'UI sans motif de nécessité.
- L'outil devient accessible hors du cercle strict prévu (partage de l'URL, déploiement VPS public sans restriction forte).

### 2.3 Mitigation

- **Rédiger, avant mise en ligne, une note de traitement** (peut tenir en 1 page dans `docs/`) : finalité précise (veille politique documentaire à partir de **sources publiques**), responsable de traitement identifié, base légale (intérêt légitime documenté + test de mise en balance ; noter que pour les données d'opinion l'intérêt légitime seul est fragile), catégories de données, durée de conservation, mesures de sécurité.
- **Minimisation stricte** : la date de naissance reste **clé technique de dédup**, **jamais affichée** ni exportée (déjà noté en annexe archi — le transformer en règle testée). Idéalement, stocker un **hash** de la date dans `dedup_key` plutôt que la date en clair partout.
- **Requalifier le tag `camp`** : documenter qu'il exprime le **positionnement public déclaré ou notoire** de l'acteur (allié/adversaire au sens du débat public), issu de sources publiques, et non une opinion inférée par l'outil. Envisager un vocabulaire moins frontal côté données (`relation` plutôt que `camp` « adversaire ») — le sens produit reste, l'étiquette juridique est moins inflammable.
- **Ne fonder l'outil que sur des données publiques** (comptes publics, followers publics, posts publics, RNE ouvert) : c'est la ligne de défense principale. Ne jamais collecter de données non publiques (DM, comptes privés, contournement de restriction).
- **Droit d'opposition opérationnel** : prévoir un mécanisme simple de **retrait d'une personne / d'un compte** (déjà couvert par le CRUD watchlist + `ON DELETE CASCADE`) et une adresse de contact. Documenter que toute demande = retrait.
- **Sécurité de l'accès** : ne pas exposer l'outil publiquement ; auth renforcée au-delà du simple PIN si déploiement VPS ; base chiffrée au repos si possible ; pas d'indexation moteur. Traiter la base comme **confidentielle par nature**.
- **Périmètre partisan assumé mais borné** : l'outil est un **instrument interne de veille**, pas une publication. Ne pas en faire un site public affichant un « fichier d'adversaires » — c'est la version qui déclenche le contentieux.
- **En cas de doute sérieux : faire relire la note par une personne compétente RGPD** avant toute mise en ligne dépassant le cercle strict de test.

> Le caractère partisan **aggrave** bien le risque : il retire la couverture « neutralité documentaire » et attire l'attention sur un usage (fichage d'opposants) historiquement sanctionné. La mitigation n'est pas de nier l'orientation — elle est assumée — mais de la cantonner à un **usage interne, sur données publiques, avec finalité et droits documentés**.

---

## 3. Risque qualité des données — faux comptes, homonymes, handles

**Gravité : MOYENNE.** Le classement « qui surveiller » ne vaut que ce que valent les rattachements compte↔personne. Des données sales produisent un outil crédible en apparence mais faux — pire qu'un outil visiblement vide.

### 3.1 Scénarios d'échec

- **Comptes parodiques / usurpateurs dans la watchlist.** Un compte `@vrai_elu_parody` ou un fan-account non officiel est ajouté, non vérifié, et remonte dans le classement. La fiche affiche l'activité d'un imposteur comme si c'était l'élu. Décrédibilise l'outil entier au premier repérage par un militant.
- **Homonymes RNE sans identifiant unique.** Le RNE n'a **pas d'ID stable** ; la dédup repose sur `normalize(nom+prénom+date_naissance)`. Deux « Jean Martin » nés le même jour, ou une date de naissance absente (`''`), fusionnent deux personnes distinctes — ou au contraire une variation d'accent/tiret scinde une même personne en deux. Les mandats (donc le poids) sont mal attribués.
- **Handles qui changent.** X/Instagram permettent de changer de `@handle`. Si `account_ref` a été stocké comme le handle plutôt que comme l'ID numérique stable, le compte devient introuvable ou pointe vers un autre compte ayant récupéré le handle libéré. Collecte silencieusement fausse.
- **Comptes non vérifiés entrant en masse via Wikidata.** L'import Wikidata crée des comptes `added_by='wikidata'` avec `source_confidence < 1`. Si rien ne force la **résolution/vérification** avant activation, la watchlist se remplit de handles jamais confirmés (périmés, erronés, homonymes Wikidata).
- **Comptes abandonnés.** Un compte réel mais inactif depuis 2 ans reste dans le classement avec ses followers historiques, gonflant artificiellement le `reach` d'une personne qui ne poste plus.

### 3.2 Signal d'alerte précoce

- Des `account_ref` qui ressemblent à des `@pseudo` plutôt qu'à des IDs numériques stables.
- Un taux élevé de personnes avec `birth_date=''` (dédup dégradée).
- Des comptes `active=1` avec `source_confidence < 1` et `last_checked_at` NULL (jamais résolus).
- Un même `display_name` de personne apparaissant deux fois (fusion ratée) ou deux personnes réelles pointant vers le même compte.

### 3.3 Mitigation

- **`account_ref` = identifiant stable, jamais le handle.** Imposer que `resolve()` retourne l'ID numérique/canonique de la plateforme (channel id YouTube, user id X/Instagram, etc.) et que ce soit lui la clé `UNIQUE(network, account_ref)`. Le `handle` reste un attribut d'affichage réactualisable.
- **Vérification obligatoire avant activation** : un compte ne passe `active=1` (donc collecté) qu'après un `resolve()` réussi qui confirme existence + followers + idéalement `verified`. Route `POST /api/accounts/:id/resolve` déjà prévue — en faire un **prérequis** du passage en watchlist, pas une option.
- **Signaler visuellement** dans l'UI : badge « non vérifié » tant que `source_confidence < 1` ou `verified=0` ; badge « parodie/officiel ? » à trancher manuellement. Ne pas laisser un compte non vérifié peser dans l'écran-thèse sans avertissement.
- **Dédup RNE défensive** : quand `birth_date=''`, **ne pas fusionner automatiquement** sur nom+prénom seuls (trop de collisions) — marquer en doublon potentiel à arbitrer plutôt que fusionner à l'aveugle. Loguer les collisions de `dedup_key`.
- **Détection de compte dormant** : le score/affichage doit distinguer « beaucoup de followers mais 0 post sur la fenêtre » (compte dormant) d'un compte réellement actif — le `last_post_at` et la composante quantité (§4) le permettent, à condition de les afficher.
- **Confiance graduée Wikidata** : les comptes issus de Wikidata entrent en `active=0` par défaut ; c'est une action humaine (recherche → ajout) qui les active après vérification, conforme au flux « piocher dans le référentiel puis ajouter ».

---

## 4. Risque score — gamable, trompeur, instable à faible N

**Gravité : MOYENNE.** Le `watch_score` est le cœur de l'écran-thèse. S'il classe mal, l'outil ment avec assurance. Deux familles de problèmes : le score est **manipulable/trompeur** (il capte mal la réalité) et il est **instable** (il varie sans signification à faible échantillon).

### 4.1 Scénarios d'échec

- **Un post viral bat 20 posts réguliers.** La composante qualité est un **taux d'engagement moyen** : un compte qui poste 1 fois un contenu viral peut afficher un engagement moyen énorme et coiffer un compte qui poste utilement 4×/semaine. Le classement « qui surveiller » remonte des coups uniques au lieu d'acteurs à suivre durablement — l'inverse de l'intention.
- **Score gamable.** Achat de followers (gonfle `reach`), engagement acheté (gonfle `qualité`), spam de posts courts (gonfle `quantité`). Les trois composantes sont individuellement manipulables ; un acteur qui veut « paraître important » peut monter dans le classement.
- **Engagement non comparable entre réseaux.** Un like TikTok, un retweet X, un like Facebook, une vue YouTube n'ont pas la même signification ni la même échelle. Additionner ou moyenner un « taux d'engagement » cross-réseau produit un chiffre sans sens. Le `EMAX` de référence unique écrase ces différences.
- **Normalisation instable à faible N (phase test 100 comptes).** Les bornes `QMAX/EMAX/RMAX` sont fixes, mais si elles étaient calibrées sur l'échantillon, 100 comptes ne suffisent pas à fixer des références stables : ajouter un seul gros compte redistribue tout le classement. Le score « saute » à chaque ajout, personne ne lui fait confiance.
- **Fenêtre trop courte / trop longue.** 30 j capte le bruit conjoncturel ; 90 j lisse trop et rate les montées récentes. Un mauvais choix par défaut fausse l'usage « radar ».
- **Poids de mandat mal calibré.** `watch_score = activity_score × poids_mandat` : un maire hyperactif (poids 0,6) peut passer sous un député inactif (poids 0,9) — ou l'inverse selon le réglage. Sans calibrage, le multiplicateur domine ou disparaît arbitrairement.

### 4.2 Signal d'alerte précoce

- Le Top 10 du classement contient des comptes que les militants **ne reconnaissent pas** comme « à surveiller » (validation humaine qui coince — c'est la métrique de succès du brief).
- Le classement **change fortement** à chaque ajout de compte en phase test (instabilité de normalisation).
- Un compte connu pour un seul coup viral trône en tête.
- Les scores de deux réseaux différents pour une même personne sont incohérents entre eux.

### 4.3 Mitigation

- **Bornes fixes, absolues, définies a priori** (pas calibrées sur l'échantillon) : `QMAX`, `EMAX`, `RMAX` sont des constantes « métier » (ex. 50 posts/sem, taux d'engagement de référence, 10^7 followers) rangées dans `settings`. Ainsi le score d'un compte **ne dépend pas des autres comptes** présents → stable à N=100 comme à N=2000. C'est déjà l'orientation de l'archi (normalisation log sur bornes fixes) : la **verrouiller explicitement** et ne jamais passer à une normalisation relative (min-max sur l'échantillon).
- **Distinguer régularité et pic** : introduire une composante **régularité** (ex. `active_days / window_days` ou pénalité de concentration) pour qu'un flux régulier batte un one-shot viral. Ou plafonner la contribution d'un seul post à la qualité (médiane plutôt que moyenne, ou capping des outliers). Objectif : le classement « qui surveiller » récompense l'acteur durable, pas le coup de chance.
- **Score par réseau, jamais un engagement cross-réseau additionné** : afficher followers et score **par réseau** (déjà le chiffre-roi = followers par réseau). Si un score agrégé personne est nécessaire, l'agréger par **rang/percentile intra-réseau** plutôt que par somme de taux hétérogènes.
- **Robustesse aux followers gonflés** : la normalisation log de `reach` amortit déjà les gros nombres ; garder `reach` comme une composante parmi trois (jamais dominante seule). Afficher `verified` à côté pour contextualiser un reach suspect.
- **Transparence du score** : la fiche doit montrer les **3 composantes séparément** (quantité / qualité / reach) et le poids de mandat appliqué, pour qu'un humain voie *pourquoi* un compte est classé là. Un score opaque n'est jamais adopté ; un score décomposé est débattable donc crédible.
- **Poids et fenêtre tunables sans recollecte** (déjà prévu) : permettre de re-trier en changeant `poids_mandat`, `w_q/w_e/w_r`, `window` — et **calibrer ces réglages sur la phase test** en confrontant le Top au jugement des militants (la métrique de succès du brief).
- **Fenêtre par défaut = 90 j pour le classement** (tendance de fond), **30 j pour le radar** (fraîcheur) — séparer les usages plutôt qu'un défaut unique.

---

## 5. Risque produit — scope creep, pertinence à faible N, adoption

**Gravité : MOYENNE.** Le brief acte que **les 5 capacités sont toutes core**. C'est un choix assumé, mais c'est aussi le principal risque de dispersion : construire 5 écrans avant d'avoir prouvé qu'**un seul** apporte de la valeur.

### 5.1 Scénarios d'échec

- **Scope creep / dispersion.** Les 5 capacités « toutes core » sont interprétées comme « tout en même temps ». Six mois passent en développement horizontal (un peu de chaque écran) sans qu'aucun ne soit fini ni utilisé. Le projet s'essouffle avant la première mise en usage réelle.
- **« Classement » sans objet à 100 comptes.** L'écran-thèse « qui surveiller ? » suppose qu'il y a **trop** de comptes pour les regarder tous. À 100 comptes (phase test), un humain lit la liste entière ; le classement ne répond à aucun besoin. On construit et calibre un moteur de tri sur un volume où le tri est inutile → mauvaise validation, faux signaux de calibrage.
- **Adoption nulle.** L'outil est techniquement correct mais aucun militant ne l'ouvre : pas d'intégration à leur routine, courbe d'entrée (auth PIN, ajout manuel de comptes), données perçues comme incomplètes (cf. risque 1) ou non fiables (cf. risque 3). Un outil de veille non utilisé est un échec, quelle que soit sa qualité technique.
- **Coût de maintenance du référentiel.** Importer et tenir à jour RNE + Wikidata + Regards Citoyens est un chantier en soi ; s'il n'est pas fait, la watchlist se remplit à la main, lentement, et l'outil reste vide → boucle d'abandon.
- **Le radar arrive trop tard.** Si la fréquence de collecte (hebdo pour Tier B) ne matche pas l'attente « être alerté des nouveaux posts », le radar est perçu comme périmé et ignoré.

### 5.2 Signal d'alerte précoce

- Après plusieurs semaines, **aucun écran n'est « fini »** (tous à 70 %).
- La phase test tourne sur 100 comptes mais personne n'a encore **utilisé** le classement pour prendre une décision.
- Les comptes sont ajoutés un par un à la main ; l'import référentiel est toujours « à venir ».
- Retour militant : « je ne sais pas quand l'ouvrir » / « il manque des réseaux » / « je ne suis pas sûr des chiffres ».

### 5.3 Mitigation

- **Respecter l'ordre tronc → branches à la lettre** (c'est déjà la parade actée) : livrer et **utiliser réellement** le TRONC (watchlist CRUD + 1 collecteur qui marche + scoring) et **le Classement** avant de toucher Fiche/Comparateur/Radar. « Toutes core » = destination, pas séquence.
- **Valider la valeur d'un écran avant le suivant** : un écran n'est « fait » que quand un militant s'en est servi pour une décision réelle. Critère de passage, pas juste critère de code.
- **Phase test à ~100 comptes = valider la chaîne, pas le tri.** Sur 100 comptes, l'objectif est de prouver que collecte → scoring → affichage fonctionne et que les **composantes du score sont crédibles** (confrontation au jugement humain), **pas** que le classement fait gagner du temps. Ce dernier bénéfice ne se démontre qu'à volume élevé (500-2000). Écrire cet objectif noir sur blanc évite de conclure à tort que « le classement ne sert à rien ».
- **Prioriser le référentiel dès le tronc** : l'import RNE + découverte Wikidata est parallélisable et **conditionne l'adoption** (sans lui, watchlist vide). Le traiter comme une dépendance du produit, pas une phase 2 optionnelle.
- **Aligner fréquence et promesse du radar** : si « être alerté » est un JTBD, les comptes à radar réel doivent être en **Tier A quotidien**. Ne pas promettre une fraîcheur que la fréquence ne tient pas ; l'afficher (« dernière collecte : … »).
- **Boucle d'adoption courte** : mettre l'outil entre les mains d'**un** militant de référence tôt, sur son besoin réel, et itérer — plutôt que finir 5 écrans puis chercher des utilisateurs.

---

## TOP 3 — à valider AVANT d'écrire du code de collecte

Ces trois points sont **bloquants** : tant qu'ils ne sont pas tranchés sur pièces, écrire le collecteur `monid.js`, le scheduler et le scoring, c'est bâtir sur une hypothèse.

1. **PoC monid.ai sur 5 comptes réels (1 par réseau fermé + repères YouTube/Twitch).** Mesurer, document `docs/monid-poc.md` à l'appui : (a) **couverture réelle** des 6 réseaux — Instagram et TikTok sont-ils vraiment servis ? (b) **coût réel** d'un `resolve` et d'un `fetchPosts` avec pagination — combien de requêtes/crédits facturés par compte, et recalcul du budget mensuel avec ce chiffre mesuré, pas estimé ; (c) **schéma de réponse** par réseau (followers, vues, likes présents ?). Sans ce PoC, toute l'économie du projet est une supposition.

2. **Note RGPD / base légale écrite (1 page) avant toute mise en ligne dépassant le test local.** Finalité (veille documentaire sur sources publiques), responsable de traitement, base légale et test de mise en balance pour les données d'opinion, minimisation (date de naissance = clé technique jamais affichée), droit d'opposition (retrait), sécurité d'accès. Trancher le traitement du tag `camp`/`adversaire` (vocabulaire, statut « positionnement public » vs « opinion inférée »). Le caractère partisan impose ce cadrage **avant**, pas après.

3. **Verrouiller la stabilité et la crédibilité du score avant de le brancher sur l'UI.** Fixer `QMAX/EMAX/RMAX` comme **bornes absolues a priori** (score indépendant de l'échantillon → stable à N=100), décider **score par réseau** (pas d'engagement cross-réseau additionné), et intégrer une composante **régularité** pour qu'un flux régulier batte un pic viral isolé. Définir `account_ref` = **identifiant stable de plateforme** (jamais le handle) et la **résolution obligatoire avant activation** d'un compte, pour ne pas scorer de faux comptes / homonymes.

---

*Ce pre-mortem complète le product-brief (§8 Risques) et l'architecture-spec. Il ne remet pas en cause les décisions actées : il en sécurise l'exécution. Prochaine action recommandée : le PoC monid.ai (TOP 3 nº1), qui conditionne tout le reste.*
