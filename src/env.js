// Tiny .env loader (no dependency). KEY=VALUE lines, `#` comments,
// optional single/double quotes. Never overrides variables already set.
import { readFileSync } from 'node:fs';

/**
 * @param {string} path
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string,string>} the pairs that were applied
 */
export function loadEnv(path, env = process.env) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  /** @type {Record<string,string>} */
  const applied = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    if (env[m[1]] === undefined) {
      env[m[1]] = value;
      applied[m[1]] = value;
    }
  }
  return applied;
}

/** Hisaab settings from the environment, with defaults. */
export function settings(env = process.env) {
  const confirmations = Number.parseInt(env.HISAAB_CONFIRMATIONS ?? '1', 10);
  return {
    // "test" (default, scored path) | "main" (watch-only). Validated by parseNetwork in createHisaab.
    network: /** @type {any} */ (env.HISAAB_NETWORK || 'test'),
    zkoolUrl: env.ZKOOL_URL || 'http://127.0.0.1:8002/graphql',
    accountName: env.HISAAB_ACCOUNT_NAME || 'hisaab-watch',
    confirmations: Number.isFinite(confirmations) && confirmations > 0 ? confirmations : 1,
    port: Number.parseInt(env.HISAAB_PORT ?? '4040', 10) || 4040,
    dataDir: env.HISAAB_DATA_DIR || 'data',
    outDir: env.HISAAB_OUT_DIR || 'out',
  };
}
