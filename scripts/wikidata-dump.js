// Dump des handles Wikidata pour un roster de personnalités (source autoritaire).
// Sortie JSON : { "Nom": { x, instagram, tiktok, youtube, facebook } }
//   node scripts/wikidata-dump.js
const PROP = { x: 'P2002', instagram: 'P2003', tiktok: 'P7085', youtube: 'P2397', facebook: 'P2013' };
const UA = { 'User-Agent': 'veille-elus-wd/1.0 (contact@bhconsulting.dev)' };

const NAMES = [
  // Insoumis / gauche
  'Jean-Luc Mélenchon', 'Mathilde Panot', 'Manuel Bompard', 'Antoine Léaument', 'Louis Boyard',
  'Rima Hassan', 'Éric Coquerel', 'Clémence Guetté', 'Thomas Portes', 'Danièle Obono',
  'Aurélie Trouvé', 'Sophia Chikirou', 'Manon Aubry',
  'Olivier Faure', 'Marine Tondelier', 'Fabien Roussel', 'François Ruffin',
  'Raphaël Glucksmann', 'Sandrine Rousseau', 'François Hollande', 'Boris Vallaud',
  // Droite / centre / RN / Reconquête
  'Marine Le Pen', 'Jordan Bardella', 'Gabriel Attal', 'Gérald Darmanin', 'Bruno Retailleau',
  'Éric Ciotti', 'Édouard Philippe', 'Éric Zemmour', 'Marion Maréchal', 'Sarah Knafo',
  'Sébastien Chenu', 'Yaël Braun-Pivot',
];

const norm = (s) => String(s || '').replace(/\/$/, '').trim();
async function j(url) { const r = await fetch(url, { headers: UA }); return r.json(); }
async function entity(qid) { return (await j(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`)).entities[qid]; }
function claim(ent, p) { return ent?.claims?.[p]?.[0]?.mainsnak?.datavalue?.value ?? null; }

const out = {};
for (const name of NAMES) {
  process.stderr.write(`… ${name}\n`);
  try {
    const s = await j(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=fr&format=json&limit=5&origin=*`);
    let picked = null;
    for (const h of s.search || []) {
      const e = await entity(h.id);
      const p31 = (e?.claims?.P31 || []).map(v => v?.mainsnak?.datavalue?.value?.id);
      const hasSocial = Object.values(PROP).some(p => claim(e, p));
      if (p31.includes('Q5') && hasSocial) { picked = e; break; }
      if (p31.includes('Q5') && !picked) picked = e;
    }
    if (!picked) { out[name] = { _err: 'introuvable' }; continue; }
    const rec = {};
    for (const [net, p] of Object.entries(PROP)) { const v = claim(picked, p); if (v) rec[net] = norm(v); }
    out[name] = rec;
  } catch (e) { out[name] = { _err: e.message }; }
}
console.log(JSON.stringify(out, null, 2));
