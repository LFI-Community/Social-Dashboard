// Seed POC — jeu de démonstration data-driven.
//   - Handles : Wikidata (source autoritaire, cf. scripts/wikidata-dump.js).
//   - Abonnés : ESTIMATIONS de démo calculées (base d'audience × part du réseau) — PAS des chiffres live.
//     Les vrais chiffres + vrais permaliens viendront de la collecte monid.ai (Phase 3).
// Usage : node scripts/seed-poc.js
import { db } from '../src/db.js';
import { recomputeAll } from '../src/scoring.js';
import { slugify, mandateWeight } from '../src/util.js';

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
  ['Place publique', 'PP', '#e0245e'],
];

// Handles Wikidata (généré par scripts/wikidata-dump.js). { réseau: handle }
const HANDLES = {
  'Jean-Luc Mélenchon': { x: 'JLMelenchon', instagram: 'jlmelenchon', tiktok: 'melenchonjl', youtube: 'UCk-_PEY3iC6DIGJKuoEe9bw', facebook: 'JLMelenchon' },
  'Mathilde Panot': { x: 'MathildePanot', instagram: 'mathildepanot', tiktok: 'mathildepanot', youtube: 'UCilxiEGEQHVZ25GU_cnyCzg', facebook: 'MathildePanotFI' },
  'Manuel Bompard': { x: 'mbompard', instagram: 'manuelbompard', tiktok: 'manuelbompard', youtube: 'UCr7r7gh9N45WVwYAmHQ3m3w', facebook: 'mbompard' },
  'Antoine Léaument': { x: 'ALeaument', instagram: 'aleaument', youtube: 'UC3q3FLPQtuWWv1uTkTfpEtw', facebook: 'aleaument' },
  'Louis Boyard': { x: 'l_boyard', instagram: 'boyardlouis', tiktok: 'louisboyard' },
  'Rima Hassan': { x: 'RimaHas', instagram: 'rimamobarak' },
  'Éric Coquerel': { x: 'ericcoquerel', facebook: 'EricCoquerelPG' },
  'Clémence Guetté': { x: 'Clemence_Guette', instagram: 'clemence_guette', youtube: 'UCpU9riAixpc1Xn9Q4i7AkOw', facebook: 'GuetteClemence' },
  'Thomas Portes': { x: 'Portes_Thomas', instagram: 'thomas_portes' },
  'Danièle Obono': { x: 'Deputee_Obono', instagram: 'camaradobono', youtube: 'UCpQ4STl8j62KeiApns4FndA', facebook: 'dan.obono.5' },
  'Aurélie Trouvé': { x: 'trouveaurelie', instagram: 'trouveaurelie93', youtube: 'UCBmDLidbbwRUiZeCKWrlPMg', facebook: 'Trouveaurelie' },
  'Sophia Chikirou': { x: 'SoChik75', instagram: 'sophia.chikirou', tiktok: 'sophiachikirou', youtube: 'UC0Uk2pyZI6-FxL8MbtKD27w', facebook: 'SophiaChikirouParis' },
  'Manon Aubry': { x: 'ManonAubryFr', instagram: 'manonaubryfr', youtube: 'UCyX-_BipdNpdFgeZEQBNstA', facebook: 'ManonAubryFR' },
  'Olivier Faure': { x: 'faureolivier', facebook: 'olivierfaure77' },
  'Marine Tondelier': { x: 'marinetondelier', instagram: 'marinetondelier', tiktok: 'marinetondelier', facebook: 'marinetondelierfr' },
  'Fabien Roussel': { x: 'fabien_roussel', instagram: 'fabien_roussel', tiktok: 'fabien_roussel' },
  'François Ruffin': { x: 'Francois_Ruffin', instagram: 'francois_ruffin', youtube: 'UCIQGSp79vVch0vO3Efqif_w', facebook: 'FrancoisRuffin80' },
  'Raphaël Glucksmann': { x: 'rglucks1', instagram: 'raphaelglucksmann', facebook: 'raphael.glucksmann' },
  'Sandrine Rousseau': { x: 'sandrousseau', instagram: 'sandrousseau' },
  'François Hollande': { x: 'fhollande', instagram: 'fhollande', facebook: 'francoishollande.fr' },
  'Boris Vallaud': { x: 'BorisVallaud', facebook: 'BorisVallaud2017' },
  'Marine Le Pen': { x: 'MLP_officiel', instagram: 'marine_lepen', tiktok: 'mlp.officiel', youtube: 'UCU3z3px1_RCqYBwrs8LJVWg', facebook: 'MarineLePen' },
  'Jordan Bardella': { x: 'J_Bardella', instagram: 'jordanbardella', tiktok: 'jordanbardella', youtube: 'UC9EIPcg_HHCWemt6JCJ5JEg', facebook: 'JordanBardella' },
  'Gabriel Attal': { x: 'GabrielAttal', instagram: 'gabrielattal', tiktok: 'gabriel_attal', youtube: 'UCOcDPuYTuxoRBtfmTBXtqBA', facebook: 'GabrielAttal' },
  'Gérald Darmanin': { x: 'GDarmanin', instagram: 'gerald_darmanin', facebook: 'gerald.darmanin' },
  'Bruno Retailleau': { x: 'BrunoRetailleau', instagram: 'bruno_retailleau', youtube: 'UCRkuLQabW1hsihpZuHJSbEA', facebook: 'BrunoRetailleau' },
  'Éric Ciotti': { x: 'ECiotti', instagram: 'eciotti', tiktok: 'eciotti', youtube: 'UCyHieXWJ4oewUR3ZTHdyzDw', facebook: 'ECIOTTI' },
  'Édouard Philippe': { x: 'EPhilippePM', instagram: 'edouardphilippepm', facebook: 'edouard.philippe.77' },
  'Éric Zemmour': { x: 'ZemmourEric', instagram: 'ericzemmour_', tiktok: 'zemmour_eric', youtube: 'UCjTbZBXEw-gplUAnMXLYHpg', facebook: 'ZemmourEric' },
  'Marion Maréchal': { x: 'MarionMarechal', instagram: 'marion_m_le_pen', tiktok: 'marion_marechal', youtube: 'UCwupzUX-SYyt3y4yx8cYdpg', facebook: 'MMLPen.officiel' },
  'Sarah Knafo': { x: 'knafo_sarah', instagram: 'sarahknafo1', tiktok: 'sarah_knafo', youtube: 'UC8ba7bn2fuU_lsVweb4YM4Q' },
  'Sébastien Chenu': { x: 'sebchenu' },
};

// Méta : [nom, camp, parti, mandat(type|null), publicFigure, baseAudience(total est.), activité(0..1)]
const META = [
  ['Jean-Luc Mélenchon', 'insoumis', 'LFI', null, true, 6500000, 0.95],
  ['Mathilde Panot', 'insoumis', 'LFI', 'depute', false, 900000, 0.9],
  ['Manuel Bompard', 'insoumis', 'LFI', 'depute', false, 350000, 0.75],
  ['Antoine Léaument', 'insoumis', 'LFI', 'depute', false, 650000, 0.9],
  ['Louis Boyard', 'insoumis', 'LFI', 'depute', false, 2200000, 0.85],
  ['Rima Hassan', 'insoumis', 'LFI', 'mep', false, 1200000, 0.95],
  ['Éric Coquerel', 'insoumis', 'LFI', 'depute', false, 200000, 0.6],
  ['Clémence Guetté', 'insoumis', 'LFI', 'depute', false, 250000, 0.65],
  ['Thomas Portes', 'insoumis', 'LFI', 'depute', false, 350000, 0.75],
  ['Danièle Obono', 'insoumis', 'LFI', 'depute', false, 250000, 0.6],
  ['Aurélie Trouvé', 'insoumis', 'LFI', 'depute', false, 130000, 0.5],
  ['Sophia Chikirou', 'insoumis', 'LFI', 'depute', false, 200000, 0.6],
  ['Manon Aubry', 'insoumis', 'LFI', 'mep', false, 450000, 0.75],
  ['Olivier Faure', 'allie', 'PS', 'depute', false, 300000, 0.6],
  ['Marine Tondelier', 'allie', 'EELV', null, true, 400000, 0.7],
  ['Fabien Roussel', 'allie', 'PCF', null, true, 350000, 0.6],
  ['François Ruffin', 'allie', 'PS', 'depute', false, 700000, 0.7],
  ['Raphaël Glucksmann', 'allie', 'PP', 'mep', false, 550000, 0.6],
  ['Sandrine Rousseau', 'allie', 'EELV', 'depute', false, 400000, 0.7],
  ['François Hollande', 'allie', 'PS', 'depute', false, 3000000, 0.4],
  ['Boris Vallaud', 'allie', 'PS', 'depute', false, 90000, 0.4],
  ['Marine Le Pen', 'adversaire', 'RN', 'depute', false, 5000000, 0.55],
  ['Jordan Bardella', 'adversaire', 'RN', 'mep', false, 4000000, 0.85],
  ['Gabriel Attal', 'adversaire', 'RE', 'depute', false, 1500000, 0.6],
  ['Gérald Darmanin', 'adversaire', 'RE', 'depute', false, 900000, 0.65],
  ['Bruno Retailleau', 'adversaire', 'LR', 'senateur', false, 260000, 0.6],
  ['Éric Ciotti', 'adversaire', 'LR', 'depute', false, 350000, 0.65],
  ['Édouard Philippe', 'adversaire', 'HOR', null, true, 800000, 0.4],
  ['Éric Zemmour', 'adversaire', 'REC', null, true, 2000000, 0.7],
  ['Marion Maréchal', 'adversaire', 'REC', 'mep', false, 900000, 0.55],
  ['Sarah Knafo', 'adversaire', 'REC', 'mep', false, 500000, 0.7],
  ['Sébastien Chenu', 'adversaire', 'RN', 'depute', false, 200000, 0.6],
];

const MANDATE_LABEL = { depute: 'Député·e', senateur: 'Sénateur·rice', mep: 'Député·e européen·ne' };
const MANDATE_LEVEL = { depute: 'national', senateur: 'national', mep: 'europeen' };
// Part de l'audience et intensité de post par réseau.
const NET_SHARE = { x: 0.34, instagram: 0.24, tiktok: 0.26, facebook: 0.10, youtube: 0.06 };
const NET_ACT = { x: 5, instagram: 1.5, tiktok: 2, facebook: 1, youtube: 0.3 };

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

let _s = 20260722;
const rand = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
const iso = (d) => d.toISOString().slice(0, 10);
const urlFor = (net, h) => ({
  x: `https://x.com/${h}`, instagram: `https://instagram.com/${h}`, tiktok: `https://tiktok.com/@${h}`,
  youtube: h.startsWith('UC') ? `https://youtube.com/channel/${h}` : `https://youtube.com/@${h}`,
  facebook: `https://facebook.com/${h}`, twitch: `https://twitch.tv/${h}`,
}[net] || '');

function wipe() {
  const tables = ['account_stats', 'posts', 'activity_daily', 'accounts', 'person_parties', 'mandates', 'persons', 'parties', 'person_stats'];
  for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
  for (const t of tables) db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(t);
}

function seed() {
  wipe();
  const partyId = {};
  const insParty = db.prepare('INSERT INTO parties (name, short, color) VALUES (?,?,?)');
  for (const [name, short, color] of PARTIES) partyId[short] = insParty.run(name, short, color).lastInsertRowid;

  const insPerson = db.prepare('INSERT INTO persons (slug, display_name, first_name, last_name, is_public_figure, camp) VALUES (?,?,?,?,?,?)');
  const insMandate = db.prepare(`INSERT INTO mandates (person_id, mandate_type, level, function_label, mandate_weight, source) VALUES (?,?,?,?,?, 'seed:poc')`);
  const insPP = db.prepare('INSERT INTO person_parties (person_id, party_id, is_current) VALUES (?,?,1)');
  const insAcc = db.prepare(`INSERT INTO accounts (person_id, network, handle, account_ref, url, followers, verified, tier, added_by, last_checked_at)
     VALUES (?,?,?,?,?,?,1,?, 'seed:wikidata', datetime('now'))`);
  const insDaily = db.prepare('INSERT INTO activity_daily (account_id, day, posts_count) VALUES (?,?,?)');
  const insPost = db.prepare(`INSERT INTO posts (account_id, external_id, posted_at, url, like_count, view_count, engagement, content) VALUES (?,?,?,?,?,?,?,?)`);

  let nP = 0, nA = 0;
  const tx = db.transaction(() => {
    for (const [name, camp, party, mandate, publicFigure, base, activity] of META) {
      const nets = HANDLES[name]; if (!nets) continue;
      const parts = name.split(' ');
      const pid = insPerson.run(slugify(name), name, parts[0], parts.slice(1).join(' '), publicFigure ? 1 : 0, camp).lastInsertRowid;
      nP++;
      if (partyId[party]) insPP.run(pid, partyId[party]);
      if (mandate) insMandate.run(pid, mandate, MANDATE_LEVEL[mandate] || '', MANDATE_LABEL[mandate] || mandate, mandateWeight(mandate));

      const today = new Date('2026-07-22T00:00:00Z');
      for (const [net, handle] of Object.entries(nets)) {
        const followers = Math.max(1000, Math.round(base * (NET_SHARE[net] || 0.1) * (0.8 + rand() * 0.4)));
        const niveau = Math.max(0.15, activity * (NET_ACT[net] || 1));
        const tier = followers > 500000 ? 'A' : 'B';
        const aid = insAcc.run(pid, net, handle, `${net}:${handle}`, urlFor(net, handle), followers, tier).lastInsertRowid;
        nA++;
        for (let d = 89; d >= 0; d--) {
          const day = new Date(today); day.setUTCDate(day.getUTCDate() - d);
          const posts = Math.max(0, Math.round(niveau * (0.5 + rand()) - (rand() < 0.25 ? niveau * 0.7 : 0)));
          if (posts > 0) insDaily.run(aid, iso(day), posts);
        }
        const nHot = 6 + Math.floor(rand() * 5);
        for (let k = 0; k < nHot; k++) {
          const dt = new Date(today); dt.setUTCDate(dt.getUTCDate() - Math.floor(rand() * 55));
          dt.setUTCHours(8 + Math.floor(rand() * 12));
          const engagement = Math.round(followers * (0.004 + rand() * 0.03) * (0.6 + niveau / 6));
          const views = ['x', 'tiktok', 'youtube'].includes(net) ? Math.round(engagement * (12 + rand() * 28)) : 0;
          // Démo : lien vers le profil (fonctionnel). Vrais permaliens = collecte réelle.
          insPost.run(aid, `${net}-${handle}-${k}`, dt.toISOString(), urlFor(net, handle),
            Math.round(engagement * 0.8), views, engagement, CAPTIONS[Math.floor(rand() * CAPTIONS.length)]);
        }
      }
    }
  });
  tx();

  db.prepare("INSERT INTO settings (key,value) VALUES ('demo_mode','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
  db.prepare("INSERT INTO settings (key,value) VALUES ('dataset_note',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run('Jeu de démonstration — handles vérifiés via Wikidata, abonnés = estimations (non-live). Collecte réelle via monid.ai à venir.');

  const n = recomputeAll(90);
  console.log(`[seed-poc] ${nP} personnalités, ${nA} comptes (handles Wikidata) · ${n} comptes scorés.`);
}

seed();
