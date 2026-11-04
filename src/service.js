// Hisaab application layer shared by the CLI and the web server.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createZkool } from './zkool.js';
import { network, parseNetwork } from './network.js';
import { buildRows, filterFy, totals, fyOf, ledgerCsv, inrRatesForRows } from './ledger.js';
import { createInvoice, matchInvoices, loadInvoices, saveInvoices, writeJsonPrivate, validateAddress } from './invoices.js';
import { buildPack } from './pack.js';

export const KEY_KINDS = /** @type {const} */ ({ full: 'full', incoming: 'incoming-only' });
const BECH32 = '[02-9ac-hj-np-z]';

/**
 * Accept only a unified VIEWING key of the configured network:
 * - full (UFVK):      test `uviewtest1…`, main `uview1…` — sees payments in and out;
 * - incoming (UIVK):  test `uivktest1…`,  main `uivk1…`  — sees payments received only (narrowest).
 * Seed phrases, spending keys (`secret-extended-key…`, `usk…`), keys of the other network and anything
 * else are refused with a message that never echoes the input.
 * @param {unknown} key
 * @param {'test'|'main'} [net]
 * @returns {{key: string, kind: 'full'|'incoming-only', network: 'test'|'main'}}
 */
export function validateViewingKey(key, net = 'test') {
  const n = network(net);
  const { full, incoming } = n.viewingKeys;
  const want = `${incoming}… (incoming-only, recommended) or ${full}… (full)`;
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k) throw httpError(400, `A viewing key is required: ${want}.`);
  if (/\s/.test(k)) throw httpError(400, `That looks like a seed phrase. Hisaab never accepts seed phrases or spending keys — paste a viewing key: ${want}.`);
  if (/^(secret-extended-key|usk|xprv|tprv)/i.test(k)) throw httpError(400, `That is a SPENDING key. Hisaab never accepts spending keys — export a viewing key instead: ${want}.`);
  const keyNet = /^(uviewtest1|uivktest1)/.test(k) ? 'test' : /^(uview1|uivk1)/.test(k) ? 'main' : null;
  if (!keyNet) throw httpError(400, `Only a unified viewing key is accepted: ${want}. Seeds and spending keys are refused.`);
  if (keyNet !== n.id) {
    throw httpError(400, `That is a ${network(keyNet).label} viewing key but Hisaab is running on ${n.label} (HISAAB_NETWORK=${n.id}). Networks are never mixed.`);
  }
  const kind = k.startsWith(full) ? KEY_KINDS.full : KEY_KINDS.incoming;
  if (!new RegExp(`^(${full}|${incoming})${BECH32}{100,}$`).test(k)) throw httpError(400, 'Malformed viewing key (bech32m characters only).');
  return { key: k, kind, network: n.id };
}

/** @deprecated use validateViewingKey; kept for callers that only need the key string. @param {unknown} key */
export function validateUfvk(key, net = 'test') {
  return validateViewingKey(key, net).key;
}

/** @param {number} status @param {string} message */
export function httpError(status, message) {
  const e = /** @type {Error & {status:number}} */ (new Error(message));
  e.status = status;
  return e;
}

/**
 * @param {{zkoolUrl:string, accountName:string, confirmations:number, dataDir:string, outDir:string, network?:'test'|'main', zkool?: import('./zkool.js').Zkool, fetchImpl?: typeof fetch}} cfg
 */
export function createHisaab(cfg) {
  const net = parseNetwork(cfg.network);
  const netInfo = network(net);
  // On mainnet the client itself refuses `pay` (watch-only mode, defence in depth).
  const zkool = cfg.zkool ?? createZkool({ url: cfg.zkoolUrl, network: net });
  const configFile = join(cfg.dataDir, 'config.json');
  /** @type {string|null} */
  let modeCache = null;

  /** @returns {{accountId:number, name:string, birth:number|null, ufvk:string, keyKind?:'full'|'incoming-only', connectedAt:string}|null} */
  function loadConfig() {
    if (!existsSync(configFile)) return null;
    try {
      return JSON.parse(readFileSync(configFile, 'utf8'));
    } catch {
      return null;
    }
  }

  function requireAccount() {
    const c = loadConfig();
    if (!c) throw httpError(409, `No watch-only account yet. Connect a viewing key first (hisaab connect --key ${netInfo.viewingKeys.incoming}…|${netInfo.viewingKeys.full}… --birth N).`);
    const cNet = c.network ?? 'test';
    if (cNet !== net) throw httpError(409, `${cfg.dataDir}/ belongs to ${network(cNet).label} but HISAAB_NETWORK=${net}. Networks are never mixed: use a separate HISAAB_DATA_DIR.`);
    return c;
  }

  /** REAL when talking to zkool_graphql; MOCK when the server identifies as the test mock. */
  async function mode() {
    if (modeCache) return modeCache;
    const v = await zkool.apiVersion();
    modeCache = String(v).startsWith('mock') ? 'MOCK' : 'REAL';
    return modeCache;
  }

  async function status() {
    const c = loadConfig();
    /** @type {Record<string, any>} */
    const s = { network: net, networkLabel: netInfo.label, chain: netInfo.chain, coin: netInfo.coin, zkoolUrl: zkool.url, confirmations: cfg.confirmations, connected: !!c, account: c ? { id: c.accountId, name: c.name, birth: c.birth, keyKind: keyKindOf(c) } : null };
    try {
      s.mode = await mode();
      s.zkoolHeight = await zkool.currentHeight();
      if (c) {
        const acct = (await zkool.listAccounts()).find((a) => a.id === c.accountId);
        s.syncedHeight = acct ? acct.height : null;
        // zkool's own flag wins over what we stored.
        if (acct && typeof acct.incomingOnly === 'boolean') s.account.keyKind = acct.incomingOnly ? KEY_KINDS.incoming : KEY_KINDS.full;
        if (!acct) s.warning = `account #${c.accountId} no longer exists in zkool`;
      }
      s.ok = true;
    } catch (e) {
      s.ok = false;
      s.error = /** @type {Error} */ (e).message;
    }
    return s;
  }

  /** @param {{ufvk?:string, key?:string, birth:number|string, name?:string}} p  `key` and `ufvk` are synonyms */
  async function connect({ ufvk, key: keyIn, birth, name }) {
    const { key, kind } = validateViewingKey(keyIn ?? ufvk, net);
    const prevConf = loadConfig();
    if (prevConf && (prevConf.network ?? 'test') !== net) throw httpError(409, `${cfg.dataDir}/ belongs to ${network(prevConf.network ?? 'test').label}; use a separate HISAAB_DATA_DIR for ${netInfo.label}.`);
    const incoming = kind === KEY_KINDS.incoming;
    const b = Number(birth);
    if (!Number.isInteger(b) || b < 0) throw httpError(400, 'birth must be a block height (integer ≥ 0) at or below the first payment you care about');
    const accountName = String(name || cfg.accountName).trim().slice(0, 64) || cfg.accountName;
    const accounts = await zkool.listAccounts();
    let existing = null;
    for (const a of accounts) {
      if (a.name === accountName) { existing = a; break; }
      // Only reuse an account of the same key kind: a UIVK must never silently map onto a full-key account.
      if (typeof a.incomingOnly === 'boolean' && a.incomingOnly !== incoming) continue;
      try {
        if ((await zkool.ufvk(a.id, { incoming })) === key) { existing = a; break; }
      } catch { /* account without a UFVK (e.g. transparent-only) */ }
    }
    let accountId;
    let created = false;
    if (existing) {
      accountId = existing.id;
      if (typeof existing.incomingOnly === 'boolean' && existing.incomingOnly !== incoming) {
        throw httpError(409, `zkool already has an account named "${accountName}" with a ${existing.incomingOnly ? 'incoming-only' : 'full'} key. Pick another name.`);
      }
      // Same name but a different key is a conflict, not a silent reuse.
      let existingKey = null;
      try { existingKey = await zkool.ufvk(existing.id, { incoming }); } catch { /* ignore */ }
      // zkool may re-encode a UFVK on export, so a key we connected ourselves before also counts as a match.
      const prev = loadConfig();
      const ours = prev && prev.accountId === existing.id && prev.ufvk === key;
      if (existingKey && existingKey !== key && !ours) throw httpError(409, `zkool already has an account named "${accountName}" with a different viewing key. Pick another name.`);
    } else {
      accountId = await zkool.createAccount({ name: accountName, key, birth: b, aindex: 0, useInternal: false });
      created = true;
    }
    if (await zkool.hasSeed(accountId)) throw httpError(409, `account #${accountId} holds a seed in zkool — Hisaab only works with watch-only accounts.`);
    const conf = { accountId, name: accountName, birth: existing ? existing.birth : b, ufvk: key, keyKind: kind, network: net, connectedAt: new Date().toISOString() };
    writeJsonPrivate(configFile, conf);
    return { accountId, name: accountName, birth: conf.birth, keyKind: kind, network: net, networkLabel: netInfo.label, created, mode: await mode() };
  }

  async function sync() {
    const c = requireAccount();
    const height = await zkool.synchronize([c.accountId]);
    const inv = await refreshInvoices();
    return { syncedHeight: height, invoices: inv.length, mode: await mode() };
  }

  /** Current view of the account from zkool. */
  async function snapshot() {
    const c = requireAccount();
    const [tip, txs, unconfirmed] = await Promise.all([
      zkool.currentHeight(),
      zkool.transactions(c.accountId),
      zkool.unconfirmed(c.accountId).catch(() => []),
    ]);
    const rows = buildRows(txs, { tip, threshold: cfg.confirmations, unconfirmed, network: net });
    return { c, tip, rows };
  }

  async function refreshInvoices() {
    const { rows } = await snapshot();
    const before = loadInvoices(cfg.dataDir);
    const after = matchInvoices(before, rows);
    if (JSON.stringify(before) !== JSON.stringify(after)) saveInvoices(cfg.dataDir, after);
    return after;
  }

  /** @param {string} [fy] */
  async function ledger(fy) {
    const { c, tip, rows } = await snapshot();
    const year = fy || fyOf(new Date());
    const fyRows = filterFy(rows, year);
    const pending = rows.filter((r) => r.status === 'seen' && !r.height);
    const invoices = matchInvoices(loadInvoices(cfg.dataDir), rows);
    /** @type {Record<string,string>} */
    const invoiceByTxid = {};
    for (const i of invoices) if (i.txid) invoiceByTxid[i.txid] = i.code;
    const keyKind = keyKindOf(c);
    const t = { ...totals(fyRows), keyKind, spendsVisible: keyKind === KEY_KINDS.full };
    if (keyKind === KEY_KINDS.incoming) t.note = 'incoming-only key: spends not visible';
    return { mode: await mode(), network: net, networkLabel: netInfo.label, fy: year, keyKind, account: { id: c.accountId, name: c.name, birth: c.birth, keyKind }, tip, threshold: cfg.confirmations, rows: fyRows, pending, totals: t, invoiceByTxid };
  }

  /** @param {{fy?: string, inr?: boolean}} p */
  async function ledgerCsvText({ fy, inr = false } = {}) {
    const l = await ledger(fy);
    const rates = inr ? await inrRatesForRows(l.rows, { dataDir: cfg.dataDir, fetchImpl: cfg.fetchImpl }) : undefined;
    return { fy: l.fy, csv: ledgerCsv(l.rows, { invoiceByTxid: l.invoiceByTxid, inr: rates, network: net }) };
  }

  /** @param {{amount:string|number, description:string}} p */
  async function newInvoice({ amount, description }) {
    const c = requireAccount();
    const addr = await zkool.address(c.accountId);
    const address = addr?.ua || addr?.sapling || '';
    const v = validateAddress(address, net);
    if (!v.ok) throw httpError(502, `zkool returned an unusable receive address: ${v.reason}`);
    let inv;
    try {
      inv = createInvoice({ amount: String(amount ?? ''), description, address, network: net });
    } catch (e) {
      throw httpError(400, /** @type {Error} */ (e).message);
    }
    const list = loadInvoices(cfg.dataDir);
    list.push(inv);
    saveInvoices(cfg.dataDir, list);
    return { ...inv, mode: await mode(), networkLabel: netInfo.label };
  }

  async function listInvoices() {
    return { mode: await mode(), network: net, invoices: await refreshInvoices() };
  }

  /** @param {{fy?: string, inr?: boolean}} p */
  async function pack({ fy, inr = false } = {}) {
    const { c, rows } = await snapshot();
    const invoices = await refreshInvoices();
    return buildPack({
      zkool, accountId: c.accountId, accountName: c.name, birth: c.birth, ufvk: c.ufvk, keyKind: keyKindOf(c), network: net,
      fy: fy || fyOf(new Date()), outDir: cfg.outDir, rows, threshold: cfg.confirmations,
      invoices, mode: await mode(), inr, dataDir: cfg.dataDir, fetchImpl: cfg.fetchImpl,
    });
  }

  return { zkool, cfg, network: net, loadConfig, status, connect, sync, snapshot, ledger, ledgerCsvText, newInvoice, listInvoices, refreshInvoices, pack, mode };
}

/** Key kind for a stored config (older configs had only a UFVK). @param {{ufvk:string, keyKind?:string}} c @returns {'full'|'incoming-only'} */
export function keyKindOf(c) {
  if (c.keyKind === KEY_KINDS.incoming || c.keyKind === KEY_KINDS.full) return c.keyKind;
  return /^uivk/.test(String(c.ufvk || '')) ? KEY_KINDS.incoming : KEY_KINDS.full;
}

/** @typedef {ReturnType<typeof createHisaab>} Hisaab */
