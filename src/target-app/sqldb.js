/**
 * Real SQL injection target — backed by an actual in-memory SQLite engine
 * (node:sqlite, built into Node 22+/24). The vulnerable path concatenates user
 * input straight into the SQL string, so the SQLite parser itself decides what
 * the injected query does. This is genuine SQL injection, not pattern matching.
 */

import { DatabaseSync } from 'node:sqlite';

let db = null;

function getDb() {
  if (db) return db;
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      email TEXT,
      role TEXT,
      password_hash TEXT
    );
    CREATE TABLE secrets (
      id INTEGER PRIMARY KEY,
      name TEXT,
      value TEXT
    );
    INSERT INTO users (id, username, email, role, password_hash) VALUES
      (1, 'admin',  'admin@acme.com', 'admin', '5f4dcc3b5aa765d61d8327deb882cf99'),
      (2, 'jdoe',   'jdoe@acme.com',  'user',  'e10adc3949ba59abbe56e057f20f883e'),
      (3, 'svc_bot','bot@acme.com',   'service','0acf4539a14b3aa27deeb4cbdf6e989f');
    INSERT INTO secrets (id, name, value) VALUES
      (1, 'DATABASE_PASSWORD', 'sup3r_s3cret_db_pw'),
      (2, 'STRIPE_KEY',        'sk_live_51H8xQa9fJ2k'),
      (3, 'JWT_SIGNING_KEY',   'hs256-9f2b-prod-rotate-me');
  `);
  return db;
}

/**
 * Run a username lookup.
 * @param {string} username  attacker-controlled input
 * @param {boolean} parameterized  true once blue deploys PARAMETERIZED_QUERY
 */
export function lookupUser(username, parameterized = false) {
  const database = getDb();

  if (parameterized) {
    // Safe path: the input can never break out of the bound parameter.
    const stmt = database.prepare(
      'SELECT id, username, email, role FROM users WHERE username = ?'
    );
    const rows = stmt.all(username);
    return {
      query: 'SELECT id, username, email, role FROM users WHERE username = ?  -- bound param',
      rows,
      leaked: false,
      parameterized: true,
    };
  }

  // VULNERABLE path: raw string concatenation. SQLite parses whatever results.
  const query = `SELECT id, username, email, role FROM users WHERE username = '${username}'`;
  let rows = [];
  let error = null;
  try {
    rows = database.prepare(query).all();
  } catch (e) {
    // A malformed injection (syntax error) is itself a signal of an attack.
    error = e.message;
  }

  // It "leaked" if the attacker pulled back rows they shouldn't have: more than
  // the single matching user, or the admin/service rows, or anything via UNION.
  const exactMatch = database
    .prepare('SELECT count(*) AS c FROM users WHERE username = ?')
    .get(username).c;
  const leaked = !error && (rows.length > Math.max(exactMatch, 1) || rows.length > 1);

  // If the attacker successfully injected, also try to surface the secrets
  // table the way a real UNION-based exfiltration would.
  let secrets = null;
  if (leaked && /union/i.test(username)) {
    try {
      secrets = database.prepare('SELECT name, value FROM secrets').all();
    } catch { /* ignore */ }
  }

  return { query, rows, error, leaked, secrets, parameterized: false };
}
