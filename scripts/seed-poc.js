// Seed POC — jeu de démonstration : personnalités politiques FR réelles (handles publics),
// répartis par camp (insoumis / allié / adversaire), avec mandats, 90 j d'activité et hot posts.
//
// ⚠ Les nombres d'abonnés sont un SNAPSHOT APPROXIMATIF de démonstration (ordre de grandeur public),
//   PAS des chiffres live. Les vrais chiffres viendront de la collecte monid.ai (Phase 3).
//
// Usage : node scripts/seed-poc.js
import { db } from '../src/db.js';
import { recomputeAll } from '../src/scoring.js';
import { slugify, mandateWeight } from '../src/util.js';

// --- Partis (sigle, couleur) ---
const PARTIES = [
  ['La France insoumise', 'LFI', '#e2001a'],
  ['Rassemblement National', 'RN', '#0d378a'],
  ['Renaissance', 'RE', '#ffab2e'],
  ['Parti socialiste', 'PS', '#ff8080'],
  ['Les Républicains', 'LR', '#0066cc'],
  ['Les Écologistes', 'EELV', '#00c000'],
  ['Parti communiste français', 'PCF', '#cc0000'],
  ['Horizons', 'HOR', '#0aa2c0'],
  ['Reconquête', 'REC', '#5b2a86'],
];

// --- Personnalités : {nom, camp, parti, mandat, publicFigure, comptes[{réseau,handle,url,followers,niveau}]} ---
// niveau = posts/jour moyen (sert à générer l'activité & l'engagement).
const PEOPLE = [
  // ---------- INSOUMIS ----------
  ['Jean-Luc Mélenchon', 'insoumis', 'LFI', null, true, [
    ['x', 'JLMelenchon', 2600000, 6], ['tiktok', 'jlmelenchon', 2100000, 2],
    ['instagram', 'jlmelenchon', 1000000, 1.5], ['youtube', 'JLMelenchon', 820000, 0.4]]],
  ['Mathilde Panot', 'insoumis', 'LFI', ['depute', 'Députée', 'Val-de-Marne'], false, [
    ['x', 'MathildePanot', 430000, 5], ['instagram', 'mathildepanot', 210000, 1]]],
  ['Manuel Bompard', 'insoumis', 'LFI', ['depute', 'Député', 'Bouches-du-Rhône'], false, [
    ['x', 'mbompard', 205000, 4]]],
  ['Antoine Léaument', 'insoumis', 'LFI', ['depute', 'Député', 'Essonne'], false, [
    ['x', 'LeaumentAntoine', 155000, 5], ['tiktok', 'antoineleaument', 260000, 1.5],
    ['youtube', 'AntoineLeaument', 90000, 0.3]]],
  ['Louis Boyard', 'insoumis', 'LFI', ['depute', 'Député', 'Val-de-Marne'], false, [
    ['x', 'LouisBoyard', 320000, 4], ['tiktok', 'louisboyard', 1100000, 2.5],
    ['instagram', 'boyardlouis', 380000, 1]]],
  ['Rima Hassan', 'insoumis', 'LFI', ['mep', 'Députée européenne', 'France'], false, [
    ['x', 'RimaHas', 520000, 6], ['instagram', 'rimahassan.rh', 450000, 1.5]]],
  ['Éric Coquerel', 'insoumis', 'LFI', ['depute', 'Député', 'Seine-Saint-Denis'], false, [
    ['x', 'ericcoquerel', 120000, 3]]],
  ['Clémence Guetté', 'insoumis', 'LFI', ['depute', 'Députée', 'Val-de-Marne'], false, [
    ['x', 'ClemenceGuette', 110000, 3]]],
  ['Thomas Portes', 'insoumis', 'LFI', ['depute', 'Député', 'Seine-Saint-Denis'], false, [
    ['x', 'ThomasPortes', 130000, 4], ['tiktok', 'thomasportes93', 150000, 1]]],
  ['Danièle Obono', 'insoumis', 'LFI', ['depute', 'Députée', 'Paris'], false, [
    ['x', 'Deputee_Obono', 145000, 3]]],
  ['Aurélie Trouvé', 'insoumis', 'LFI', ['depute', 'Députée', 'Seine-Saint-Denis'], false, [
    ['x', 'AurelieTrouve', 60000, 2]]],
  ['Sophia Chikirou', 'insoumis', 'LFI', ['depute', 'Députée', 'Paris'], false, [
    ['x', 'Sophia_Chikirou', 95000, 3]]],

  // ---------- ALLIÉS (gauche / NFP) ----------
  ['Olivier Faure', 'allie', 'PS', ['depute', 'Député', 'Seine-et-Marne'], false, [
    ['x', 'faureolivier', 175000, 3]]],
  ['Marine Tondelier', 'allie', 'EELV', null, true, [
    ['x', 'marinetondelier', 210000, 3], ['instagram', 'marinetondelier', 90000, 0.8]]],
  ['Fabien Roussel', 'allie', 'PCF', null, true, [
    ['x', 'Fabien_Roussel', 160000, 2.5]]],
  ['François Ruffin', 'allie', 'PS', ['depute', 'Député', 'Somme'], false, [
    ['x', 'Francois_Ruffin', 410000, 2], ['instagram', 'francois.ruffin', 180000, 0.7]]],

  // ---------- ADVERSAIRES ----------
  ['Marine Le Pen', 'adversaire', 'RN', ['depute', 'Députée', 'Pas-de-Calais'], false, [
    ['x', 'MLP_officiel', 1800000, 2], ['tiktok', 'marine_lepen_officiel', 700000, 0.8]]],
  ['Jordan Bardella', 'adversaire', 'RN', ['mep', 'Député européen', 'France'], false, [
    ['x', 'J_Bardella', 1250000, 3], ['tiktok', 'jordanbardella_officiel', 1600000, 1.5],
    ['instagram', 'jordanbardella', 980000, 1.2]]],
  ['Gabriel Attal', 'adversaire', 'RE', ['depute', 'Député', 'Hauts-de-Seine'], false, [
    ['x', 'GabrielAttal', 1050000, 2.5], ['instagram', 'gabrielattal', 320000, 0.8]]],
  ['Gérald Darmanin', 'adversaire', 'RE', ['depute', 'Député', 'Nord'], false, [
    ['x', 'GDarmanin', 820000, 3]]],
  ['Bruno Retailleau', 'adversaire', 'LR', ['senateur', 'Sénateur', 'Vendée'], false, [
    ['x', 'BrunoRetailleau', 160000, 2.5]]],
  ['Éric Ciotti', 'adversaire', 'LR', ['depute', 'Député', 'Alpes-Maritimes'], false, [
    ['x', 'ECiotti', 210000, 3]]],
  ['Édouard Philippe', 'adversaire', 'HOR', null, true, [
    ['x', 'EPhilippePM', 700000, 1]]],
  ['Éric Zemmour', 'adversaire', 'REC', null, true, [
    ['x', 'ZemmourEric', 1400000, 3], ['tiktok', 'ericzemmour', 600000, 1]]],
];

// Légendes de démonstration pour les hot posts (contenu affiché en entier).
const CAPTIONS = [
  'Mobilisation ce week-end dans tout le pays, on ne lâche rien ✊',
  "Face à l'inflation, voici nos propositions concrètes pour le pouvoir d'achat ⬇️",
  "Mon intervention à l'Assemblée sur la réforme, à revoir en entier 👇",
  'Merci pour votre accueil chaleureux sur le terrain aujourd’hui. La détermination est intacte.',
  'Le débat de ce soir en replay — partagez largement autour de vous.',
  'Nous exigeons des comptes. La transparence n’est pas une option. #Transparence',
  'Reportage exclusif à ne pas manquer : ce que le gouvernement ne veut pas que vous voyiez.',
  'Rendez-vous demain 18h pour le grand meeting. On compte sur vous !',
  'Ma tribune dans la presse ce matin : il est temps de changer de cap.',
  'Question au gouvernement : où est passé le budget promis aux collectivités ?',
  'Solidarité totale avec les grévistes. Leurs revendications sont légitimes.',
  'Fier·e de porter ce combat avec vous. Ensemble, rien ne nous arrête.',
];

// --- PRNG déterministe (reproductible) ---
let _s = 20260721;
const rand = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
const iso = (d) => d.toISOString().slice(0, 10);

function wipe() {
  const tables = ['account_stats', 'posts', 'activity_daily', 'accounts', 'person_parties', 'mandates', 'persons', 'parties'];
  for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
  // Réinitialise les AUTOINCREMENT pour des ids déterministes (1..N).
  for (const t of tables) db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(t);
}

function seed() {
  wipe();

  // Partis
  const partyId = {};
  const insParty = db.prepare('INSERT INTO parties (name, short, color) VALUES (?,?,?)');
  for (const [name, short, color] of PARTIES) partyId[short] = insParty.run(name, short, color).lastInsertRowid;

  const insPerson = db.prepare(
    `INSERT INTO persons (slug, display_name, first_name, last_name, is_public_figure, camp) VALUES (?,?,?,?,?,?)`);
  const insMandate = db.prepare(
    `INSERT INTO mandates (person_id, mandate_type, level, function_label, territory_label, mandate_weight, source)
     VALUES (?,?,?,?,?,?, 'seed:poc')`);
  const insPP = db.prepare('INSERT INTO person_parties (person_id, party_id, is_current) VALUES (?,?,1)');
  const insAcc = db.prepare(
    `INSERT INTO accounts (person_id, network, handle, account_ref, url, followers, verified, tier, added_by, last_checked_at)
     VALUES (?,?,?,?,?,?,1,?, 'seed', datetime('now'))`);
  const insDaily = db.prepare('INSERT INTO activity_daily (account_id, day, posts_count) VALUES (?,?,?)');
  const insPost = db.prepare(
    `INSERT INTO posts (account_id, external_id, posted_at, url, like_count, view_count, engagement, content)
     VALUES (?,?,?,?,?,?,?,?)`);

  const urlFor = (net, h) => ({
    x: `https://x.com/${h}`, instagram: `https://instagram.com/${h}`,
    tiktok: `https://tiktok.com/@${h}`, youtube: `https://youtube.com/@${h}`,
    facebook: `https://facebook.com/${h}`, twitch: `https://twitch.tv/${h}`,
  }[net] || '');

  let nPersons = 0, nAccounts = 0;
  const tx = db.transaction(() => {
    for (const [name, camp, party, mandate, publicFigure, comptes] of PEOPLE) {
      const parts = name.split(' ');
      const pid = insPerson.run(slugify(name), name, parts[0], parts.slice(1).join(' '),
        publicFigure ? 1 : 0, camp).lastInsertRowid;
      nPersons++;
      if (partyId[party]) insPP.run(pid, partyId[party]);
      if (mandate) {
        const [mtype, label, terr] = mandate;
        insMandate.run(pid, mtype, mtype === 'mep' ? 'europeen' : 'national', label, terr, mandateWeight(mtype));
      }
      for (const [net, handle, followers, niveau] of comptes) {
        const tier = followers > 500000 ? 'A' : 'B';
        const aid = insAcc.run(pid, net, handle, `${net}:${handle}`, urlFor(net, handle), followers, tier).lastInsertRowid;
        nAccounts++;

        // 90 jours d'activité (Poisson ~ niveau, avec jours creux)
        const today = new Date('2026-07-21T00:00:00Z');
        for (let d = 89; d >= 0; d--) {
          const day = new Date(today); day.setUTCDate(day.getUTCDate() - d);
          const lambda = niveau * (0.5 + rand()); // variance quotidienne
          const posts = Math.max(0, Math.round(lambda - (rand() < 0.25 ? niveau * 0.7 : 0)));
          if (posts > 0) insDaily.run(aid, iso(day), posts);
        }

        // Hot posts : ~8 posts récents avec engagement ∝ followers × niveau
        const nHot = 6 + Math.floor(rand() * 6);
        for (let k = 0; k < nHot; k++) {
          const daysAgo = Math.floor(rand() * 60);
          const dt = new Date(today); dt.setUTCDate(dt.getUTCDate() - daysAgo);
          dt.setUTCHours(8 + Math.floor(rand() * 12));
          const base = followers * (0.004 + rand() * 0.03) * (0.6 + niveau / 6);
          const engagement = Math.round(base);
          const views = net === 'x' || net === 'tiktok' || net === 'youtube'
            ? Math.round(engagement * (12 + rand() * 30)) : 0;
          const caption = CAPTIONS[Math.floor(rand() * CAPTIONS.length)];
          insPost.run(aid, `${net}-${handle}-${k}`, dt.toISOString(),
            urlFor(net, handle), Math.round(engagement * 0.8), views, engagement, caption);
        }
      }
    }
  });
  tx();

  db.prepare("INSERT INTO settings (key,value) VALUES ('demo_mode','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
  db.prepare("INSERT INTO settings (key,value) VALUES ('dataset_note',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run('Jeu de démonstration — abonnés = snapshot approximatif (ordre de grandeur public), non-live. Collecte réelle via monid.ai en Phase 3.');

  const n = recomputeAll(90);
  console.log(`[seed-poc] ${nPersons} personnes, ${nAccounts} comptes seedés · ${n} comptes scorés (fenêtre 90 j).`);
}

seed();
