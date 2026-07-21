// Vérifie les handles du seed contre Wikidata (source autoritaire, handles vérifiés).
// Props : P2002 X · P2003 Instagram · P7085 TikTok · P2397 YouTube channel · P2013 Facebook.
// Sortie : tableau des écarts (seed ≠ wikidata) pour correction du seed.
//   node scripts/verify-handles.js

const PROP = { x: 'P2002', instagram: 'P2003', tiktok: 'P7085', youtube: 'P2397', facebook: 'P2013' };

// (nom, { réseau: handle_seed })  — miroir du seed-poc actuel
const SEED = [
  ['Jean-Luc Mélenchon', { x: 'JLMelenchon', tiktok: 'jlmelenchon', instagram: 'jlmelenchon', youtube: 'JLMelenchon' }],
  ['Mathilde Panot', { x: 'MathildePanot', instagram: 'mathildepanot' }],
  ['Manuel Bompard', { x: 'mbompard' }],
  ['Antoine Léaument', { x: 'LeaumentAntoine', tiktok: 'antoineleaument', youtube: 'AntoineLeaument' }],
  ['Louis Boyard', { x: 'LouisBoyard', tiktok: 'louisboyard', instagram: 'boyardlouis' }],
  ['Rima Hassan', { x: 'RimaHas', instagram: 'rimahassan.rh' }],
  ['Éric Coquerel', { x: 'ericcoquerel' }],
  ['Clémence Guetté', { x: 'ClemenceGuette' }],
  ['Thomas Portes', { x: 'ThomasPortes', tiktok: 'thomasportes93' }],
  ['Danièle Obono', { x: 'Deputee_Obono' }],
  ['Aurélie Trouvé', { x: 'AurelieTrouve' }],
  ['Sophia Chikirou', { x: 'Sophia_Chikirou' }],
  ['Olivier Faure', { x: 'faureolivier' }],
  ['Marine Tondelier', { x: 'marinetondelier', instagram: 'marinetondelier' }],
  ['Fabien Roussel', { x: 'Fabien_Roussel' }],
  ['François Ruffin', { x: 'Francois_Ruffin', instagram: 'francois.ruffin' }],
  ['Marine Le Pen', { x: 'MLP_officiel', tiktok: 'marine_lepen_officiel' }],
  ['Jordan Bardella', { x: 'J_Bardella', tiktok: 'jordanbardella_officiel', instagram: 'jordanbardella' }],
  ['Gabriel Attal', { x: 'GabrielAttal', instagram: 'gabrielattal' }],
  ['Gérald Darmanin', { x: 'GDarmanin' }],
  ['Bruno Retailleau', { x: 'BrunoRetailleau' }],
  ['Éric Ciotti', { x: 'ECiotti' }],
  ['Édouard Philippe', { x: 'EPhilippePM' }],
  ['Éric Zemmour', { x: 'ZemmourEric', tiktok: 'ericzemmour' }],
];

const UA = { 'User-Agent': 'veille-elus-handle-check/1.0 (contact@bhconsulting.dev)' };
const norm = (s) => String(s || '').toLowerCase().replace(/^@/, '').replace(/\/$/, '').trim();

async function qidFor(name) {
  const u = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=fr&format=json&limit=5&origin=*`;
  const r = await fetch(u, { headers: UA }); const j = await r.json();
  for (const hit of j.search || []) {
    // vérifie que c'est un humain politique FR
    const ent = await entity(hit.id);
    const p31 = claims(ent, 'P31').map(v => v?.mainsnak?.datavalue?.value?.id);
    if (p31.includes('Q5')) return { qid: hit.id, ent };
  }
  return null;
}
async function entity(qid) {
  const r = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, { headers: UA });
  const j = await r.json(); return j.entities[qid];
}
function claims(ent, p) { return (ent?.claims?.[p]) || []; }
function handleOf(ent, prop) {
  const c = claims(ent, prop)[0]; return c?.mainsnak?.datavalue?.value || null;
}

const rows = [];
for (const [name, seed] of SEED) {
  process.stderr.write(`… ${name}\n`);
  let res = null;
  try { res = await qidFor(name); } catch (e) { console.log(`ERR ${name}: ${e.message}`); continue; }
  if (!res) { console.log(`?? ${name} : QID introuvable`); continue; }
  for (const [net, seedHandle] of Object.entries(seed)) {
    const wd = handleOf(res.ent, PROP[net]);
    const ok = wd && norm(wd) === norm(seedHandle);
    if (!wd) rows.push([name, net, seedHandle, '(absent Wikidata)', '·']);
    else if (!ok) rows.push([name, net, seedHandle, wd, '❌ CORRIGER']);
  }
}

console.log('\n=== ÉCARTS seed ≠ Wikidata ===');
if (!rows.length) console.log('Aucun écart.');
for (const r of rows) console.log(`${r[4]}  ${r[0].padEnd(20)} ${r[1].padEnd(10)} seed=${String(r[2]).padEnd(24)} wikidata=${r[3]}`);
