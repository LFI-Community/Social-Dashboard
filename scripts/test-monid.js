#!/usr/bin/env node
// PoC monid.ai — valide AVANT de coder la collecte (garde pré-mortem #1).
//
// Mesure, sur 5 comptes réels (1 par réseau fermé) :
//   - couverture réelle (le réseau est-il servi ? followers + posts présents ?)
//   - COÛT RÉEL par appel (lu dans billing.actualCost de la réponse, pas une hypothèse)
//   - résultats par appel (resultCount) + latence + sync/async
// puis extrapole le coût mensuel à 2000 comptes.
//
// Usage :
//   MONID_API_KEY=monid_live_xxx node scripts/test-monid.js            # recon seule (discover/inspect, ~gratuit)
//   MONID_API_KEY=monid_live_xxx node scripts/test-monid.js --run      # + exécute les 5 runs PAYANTS
//   (option) MONID_WORKSPACE_ID=ws_xxx  si l'auto-détection échoue.
//
// Le flag --run est le garde-fou : rien de payant ne part sans lui.

const BASE = 'https://api.monid.ai';
const KEY = process.env.MONID_API_KEY;
const DO_RUN = process.argv.includes('--run');
const EUR_PER_USD = 0.92; // approx, pour l'estimation

if (!KEY) {
  console.error('❌ MONID_API_KEY manquant. Crée un compte sur https://app.monid.ai/access/api-keys puis :');
  console.error('   MONID_API_KEY=monid_live_xxx node scripts/test-monid.js');
  process.exit(1);
}

let WORKSPACE = process.env.MONID_WORKSPACE_ID || null;

// 5 cibles : même personnalité (Mélenchon, comptes publics) sur chaque réseau fermé → test de couverture propre.
const TARGETS = [
  { network: 'x',         query: 'twitter user profile scraper',  handle: 'JLMelenchon' },
  { network: 'instagram', query: 'instagram profile scraper',     handle: 'jlmelenchon' },
  { network: 'tiktok',    query: 'tiktok profile scraper',        handle: 'jlmelenchon' },
  { network: 'facebook',  query: 'facebook page scraper',         handle: 'JLMelenchon' },
  { network: 'youtube',   query: 'youtube channel scraper',       handle: '@JLMelenchon' },
];

function headers() {
  const h = { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  if (WORKSPACE) h['x-workspace-id'] = WORKSPACE;
  return h;
}

async function api(method, path, body) {
  const t0 = Date.now();
  const res = await fetch(BASE + path, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const ms = Date.now() - t0;
  let json = null;
  const txt = await res.text();
  try { json = txt ? JSON.parse(txt) : null; } catch { json = { _raw: txt }; }
  return { status: res.status, ms, json };
}

function usd(microDollarObj) {
  if (!microDollarObj) return null;
  const v = typeof microDollarObj === 'object' ? microDollarObj.value : microDollarObj;
  if (v == null) return null;
  return v / 1_000_000; // MICRO_DOLLAR → USD
}

// Cherche récursivement une clé plausible (followers, posts…) dans un objet de réponse.
function findKey(obj, names, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return undefined;
  for (const k of Object.keys(obj)) {
    if (names.some(n => k.toLowerCase().includes(n))) return { key: k, value: obj[k] };
    const nested = findKey(obj[k], names, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

async function pollRun(runId, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 2000));
    const { json } = await api('GET', `/v1/runs/${runId}`);
    if (json && ['COMPLETED', 'FAILED', 'ERROR'].includes(json.status)) return json;
  }
  return { status: 'TIMEOUT', runId };
}

async function main() {
  console.log(`\n=== PoC monid.ai — ${DO_RUN ? 'RECON + RUNS PAYANTS' : 'RECON SEULE (ajoute --run pour exécuter)'} ===\n`);

  // 0) Auth + workspace + solde
  const who = await api('GET', '/v1/whoami');
  console.log(`whoami: HTTP ${who.status}`, who.json ? JSON.stringify(who.json).slice(0, 300) : '');
  if (!WORKSPACE) {
    const ws = who.json?.workspaces?.[0]?.id || who.json?.workspaceId || who.json?.defaultWorkspaceId;
    if (ws) { WORKSPACE = ws; console.log(`→ workspace auto-détecté : ${WORKSPACE}`); }
    else console.log('⚠ workspace non détecté — si les appels 400/403, passe MONID_WORKSPACE_ID=ws_xxx');
  }
  const wallet = await api('GET', '/v1/wallet');
  console.log(`wallet: HTTP ${wallet.status}`, wallet.json ? JSON.stringify(wallet.json).slice(0, 200) : '', '\n');

  const rows = [];

  for (const t of TARGETS) {
    console.log(`\n────────── ${t.network.toUpperCase()} (@${t.handle}) ──────────`);

    // 1) discover
    const disc = await api('POST', '/v1/discover', { query: t.query });
    const results = disc.json?.results || disc.json?.endpoints || disc.json?.data || [];
    console.log(`discover "${t.query}": HTTP ${disc.status}, ${Array.isArray(results) ? results.length : '?'} résultats`);
    if (Array.isArray(results)) {
      results.slice(0, 5).forEach((r, i) =>
        console.log(`   [${i}] slug=${r.slug || r.endpoint || '?'} provider=${r.provider || '?'} price=${JSON.stringify(r.price || r.pricing || '?')}`));
    } else {
      console.log('   réponse discover brute :', JSON.stringify(disc.json).slice(0, 300));
    }
    const pick = Array.isArray(results) ? results[0] : null;
    if (!pick) { console.log('   ❌ aucun endpoint trouvé pour ce réseau'); rows.push({ ...t, covered: false }); continue; }

    // 2) inspect (schéma + prix AVANT de payer)
    const slug = pick.slug || pick.endpoint;
    const insp = await api('POST', '/v1/inspect', { slug });
    const price = insp.json?.price || insp.json?.pricing;
    console.log(`inspect ${slug}: HTTP ${insp.status}, price=${JSON.stringify(price)}`);
    console.log('   input schema (clés) :', Object.keys(insp.json?.inputSchema?.properties || insp.json?.input?.properties || insp.json?.schema?.properties || {}).join(', ') || '(non lisible — voir brut)');

    if (!DO_RUN) { rows.push({ ...t, slug, priceInspect: price, covered: null }); continue; }

    // 3) run PAYANT — essai d'input générique (on ajustera selon le schéma réel imprimé ci-dessus)
    const provider = pick.provider || 'apify';
    const endpoint = pick.endpoint || ('/' + slug);
    const input = {
      username: t.handle, handle: t.handle, profileName: t.handle,
      usernames: [t.handle], profileUrls: [t.handle], maxItems: 10, resultsLimit: 10,
    };
    const run = await api('POST', '/v1/run', { provider, endpoint, input });
    let result = run.json;
    if (run.status === 202 && result?.runId) {
      console.log(`   run async (202), poll ${result.runId}…`);
      result = await pollRun(result.runId);
    }
    const cost = usd(result?.billing?.actualCost) ?? usd(result?.billing?.calculatedCost);
    const resultCount = result?.resultCount ?? (Array.isArray(result?.results) ? result.results.length : null);
    const followers = findKey(result, ['follower', 'subscriber', 'fans']);
    const posts = findKey(result, ['posts', 'tweets', 'videos', 'items', 'timeline']);
    console.log(`   run: HTTP ${run.status} status=${result?.status} ${run.ms}ms`);
    console.log(`   coût réel = ${cost != null ? '$' + cost.toFixed(6) : '?'}  | resultCount=${resultCount}`);
    console.log(`   followers trouvés : ${followers ? followers.key + '=' + JSON.stringify(followers.value).slice(0, 60) : 'NON'}`);
    console.log(`   posts trouvés     : ${posts ? posts.key + ' (' + (Array.isArray(posts.value) ? posts.value.length + ' items' : typeof posts.value) + ')' : 'NON'}`);
    rows.push({ ...t, slug, covered: !!(followers || posts), costUsd: cost, resultCount });
  }

  // 4) Synthèse + extrapolation
  console.log('\n\n=========== SYNTHÈSE ===========');
  console.table(rows.map(r => ({
    réseau: r.network, servi: r.covered === null ? '(recon)' : (r.covered ? '✅' : '❌'),
    slug: r.slug || '—', coût_$: r.costUsd != null ? r.costUsd.toFixed(6) : '—', résultats: r.resultCount ?? '—',
  })));

  if (DO_RUN) {
    const costs = rows.map(r => r.costUsd).filter(v => v != null);
    if (costs.length) {
      const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
      const avgEur = avg * EUR_PER_USD;
      console.log(`\nCoût moyen mesuré par appel : $${avg.toFixed(6)} ≈ ${avgEur.toFixed(6)} €`);
      // Extrapolation blend : Tier A 300 quotidien (30) + Tier B 1700 hebdo (4), 1 appel/compte/refresh
      const callsMonth = 300 * 30 + 1700 * 4;
      console.log(`Extrapolation 2000 comptes (blend A 300 quotidien + B 1700 hebdo, 1 appel/refresh) :`);
      console.log(`   ${callsMonth.toLocaleString()} appels/mois × ${avgEur.toFixed(6)} € = ${(callsMonth * avgEur).toFixed(2)} €/mois`);
      console.log(`   (vs hypothèse brainstorm ~61 €/mois à 0,0015 €/appel)`);
    } else {
      console.log('\n⚠ aucun coût mesuré (runs échoués) — voir logs ci-dessus, ajuster l\'input au schéma réel.');
    }
  } else {
    console.log('\nRecon terminée. Relance avec --run pour exécuter les 5 appels payants et mesurer le coût réel.');
  }
}

main().catch(e => { console.error('💥', e); process.exit(1); });
