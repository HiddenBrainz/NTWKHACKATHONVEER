/**
 * Real path-traversal target — backed by a sandboxed in-memory virtual
 * filesystem. The vulnerable path uses genuine path resolution
 * (path.posix.resolve) on attacker input, so "../../../etc/passwd" actually
 * walks up and out of the web root and resolves to a sensitive virtual file.
 *
 * This NEVER touches the real disk — all files live in the map below — so it is
 * safe to run while still exercising real traversal logic.
 */

import path from 'node:path';

const WEB_ROOT = '/srv/www/public';

// The virtual disk. Keys are absolute POSIX paths.
const VFS = {
  '/srv/www/public/index.html': '<!doctype html><h1>ACME Corp</h1>',
  '/srv/www/public/style.css': 'body{font-family:sans-serif}',
  '/srv/www/public/robots.txt': 'User-agent: *\nDisallow:',
  // --- sensitive files OUTSIDE the web root (the prize) ---
  '/etc/passwd':
    'root:x:0:0:root:/root:/bin/bash\nsvc_bot:x:1000:1000::/home/svc_bot:/bin/bash',
  '/srv/www/.env':
    'DATABASE_PASSWORD=sup3r_s3cret_db_pw\nJWT_SIGNING_KEY=hs256-9f2b-prod-rotate-me',
  '/srv/app/config/credentials.json':
    '{"aws_access_key":"AKIA9EXAMPLE","aws_secret":"wJalrXUtnFEMI/EXAMPLEKEY"}',
};

const isSensitive = (abs) => !abs.startsWith(WEB_ROOT + '/') && abs !== WEB_ROOT;

/**
 * Read a file by request path.
 * @param {string} reqPath  attacker-controlled path
 * @param {boolean} normalized  true once blue deploys PATH_NORMALIZATION
 */
export function readFile(reqPath, normalized = false) {
  if (normalized) {
    // Safe path: strip any traversal, then confine strictly to the web root.
    const safeRel = path.posix
      .normalize('/' + String(reqPath))
      .replace(/^(\.\.(\/|$))+/, '');
    const abs = path.posix.join(WEB_ROOT, safeRel);
    if (!abs.startsWith(WEB_ROOT)) {
      return { path: reqPath, resolved: abs, leaked: false, blocked: true, contents: null };
    }
    return {
      path: reqPath,
      resolved: abs,
      leaked: false,
      contents: VFS[abs] ?? 'Not Found',
    };
  }

  // VULNERABLE path: resolve attacker input against the web root with no
  // confinement. "../" sequences genuinely escape the jail.
  const abs = path.posix.resolve(WEB_ROOT, String(reqPath));
  const contents = VFS[abs];
  const escaped = isSensitive(abs);

  return {
    path: reqPath,
    resolved: abs,
    leaked: escaped && contents != null,
    escaped,
    contents: contents ?? 'Not Found',
  };
}
