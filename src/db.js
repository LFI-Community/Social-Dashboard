import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || resolve(__dirname, '..', 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(resolve(DATA_DIR, 'veille.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- Personnes : élus (issus du RNE) + personnalités hors mandat
  CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE,
    display_name TEXT NOT NULL,
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    birth_date TEXT DEFAULT '',            -- 'YYYY-MM-DD' (RNE) ou '' si inconnu
    gender TEXT DEFAULT '',                -- 'F' | 'M' | ''
    wikidata_qid TEXT UNIQUE,              -- 'Q...' si connu
    is_public_figure INTEGER NOT NULL DEFAULT 0, -- 1 = hors mandat (chef de parti, ex-élu)
    dedup_key TEXT,                        -- normalize(last+first+birth) pour l'upsert RNE
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Mandats : une personne peut en cumuler plusieurs (1 ligne RNE = 1 mandat)
  CREATE TABLE IF NOT EXISTS mandates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    mandate_type TEXT NOT NULL,            -- maire|depute|senateur|cm|epci|cd|cr|mep|arrondissement|afe|autre
    level TEXT DEFAULT '',                 -- national|regional|departemental|communal|intercommunal|europeen
    function_label TEXT DEFAULT '',        -- ex 'Maire', 'Adjoint au maire'
    territory_code TEXT DEFAULT '',        -- code commune/dept/circonscription
    territory_label TEXT DEFAULT '',
    start_date TEXT DEFAULT '',
    mandate_weight REAL NOT NULL DEFAULT 0.25,
    source TEXT DEFAULT '',                -- 'rne:elus-maires' ...
    source_row_hash TEXT,                  -- idempotence import
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Partis (seed depuis partis-data.json, à venir Phase 2)
  CREATE TABLE IF NOT EXISTS parties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    short TEXT DEFAULT '',
    color TEXT DEFAULT '',
    wikidata_qid TEXT UNIQUE
  );

  CREATE TABLE IF NOT EXISTS person_parties (
    person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    role TEXT DEFAULT '',
    is_current INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (person_id, party_id)
  );

  -- Comptes sociaux : rattachés à une personne OU standalone (person_id NULL)
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
    network TEXT NOT NULL,                 -- x|instagram|facebook|tiktok|youtube|twitch
    handle TEXT DEFAULT '',
    account_ref TEXT NOT NULL,             -- channel id / user id / DID / URL canonique (clé stable)
    display_name TEXT DEFAULT '',
    url TEXT DEFAULT '',
    followers INTEGER DEFAULT 0,
    verified INTEGER NOT NULL DEFAULT 0,
    is_standalone INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    added_by TEXT DEFAULT 'manual',        -- wikidata|regardscitoyens|manual
    source_confidence REAL NOT NULL DEFAULT 1.0,
    last_checked_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE (network, account_ref)
  );

  -- Rollup journalier : 1 ligne / compte / jour (évite de stocker chaque post à l'échelle 500k)
  CREATE TABLE IF NOT EXISTS activity_daily (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    day TEXT NOT NULL,                     -- 'YYYY-MM-DD'
    posts_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, day)
  );

  -- Posts détaillés : seulement pour les comptes réellement surveillés (optionnel)
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    posted_at TEXT NOT NULL,
    url TEXT DEFAULT '',
    like_count INTEGER DEFAULT 0,
    collected_at TEXT DEFAULT (datetime('now')),
    UNIQUE (account_id, external_id)
  );

  -- Stats calculées par fenêtre (30/90 j)
  CREATE TABLE IF NOT EXISTS account_stats (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    window_days INTEGER NOT NULL,
    posts_count INTEGER NOT NULL DEFAULT 0,
    posts_per_week REAL NOT NULL DEFAULT 0,
    last_post_at TEXT,
    active_days INTEGER NOT NULL DEFAULT 0,
    activity_score REAL NOT NULL DEFAULT 0,
    watch_score REAL NOT NULL DEFAULT 0,
    computed_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (account_id, window_days)
  );

  -- Registre des collecteurs (gratuits activés, payants OFF par défaut)
  CREATE TABLE IF NOT EXISTS collectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'free',     -- free | paid
    enabled INTEGER NOT NULL DEFAULT 0,
    config TEXT DEFAULT '{}'
  );

  -- Journal des collectes (audit / debug quotas)
  CREATE TABLE IF NOT EXISTS collection_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    collector TEXT NOT NULL,
    started_at TEXT DEFAULT (datetime('now')),
    finished_at TEXT,
    status TEXT DEFAULT 'running',         -- running | ok | error
    posts_found INTEGER DEFAULT 0,
    error TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

  CREATE INDEX IF NOT EXISTS ix_accounts_person ON accounts(person_id);
  CREATE INDEX IF NOT EXISTS ix_accounts_network ON accounts(network);
  CREATE INDEX IF NOT EXISTS ix_activity_acc ON activity_daily(account_id, day);
  CREATE INDEX IF NOT EXISTS ix_posts_acc ON posts(account_id, posted_at);
  CREATE INDEX IF NOT EXISTS ix_mandates_person ON mandates(person_id);
  CREATE INDEX IF NOT EXISTS ix_persons_dedup ON persons(dedup_key);
  CREATE INDEX IF NOT EXISTS ix_stats_watch ON account_stats(window_days, watch_score);
`);

// --- Migrations idempotentes (bases antérieures) ---
function addColumn(table, name, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
export { addColumn };

// --- Seed du registre des collecteurs (idempotent) ---
// Gratuits (API publique/quota) = enabled. Payants (Apify, contre ToS) = OFF par défaut.
const COLLECTOR_SEED = [
  ['youtube', 'YouTube Data API v3', 'free', 1],
  ['twitch', 'Twitch Helix API', 'free', 1],
  ['x', 'X / Twitter (Apify)', 'paid', 0],
  ['instagram', 'Instagram (Apify)', 'paid', 0],
  ['facebook', 'Facebook (Apify)', 'paid', 0],
  ['tiktok', 'TikTok (Apify)', 'paid', 0],
];
const insCollector = db.prepare(
  'INSERT OR IGNORE INTO collectors (network, name, kind, enabled) VALUES (?,?,?,?)'
);
for (const [net, name, kind, enabled] of COLLECTOR_SEED) insCollector.run(net, name, kind, enabled);

// Réglages par défaut
db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('watchlist_size','300')").run();
db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('default_window','90')").run();

export default db;
