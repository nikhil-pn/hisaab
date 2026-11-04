// Invoices that travel inside encrypted memos.
// code "HSB-XXXXXX" (Crockford base32, crypto random) → memo "HSB-XXXXXX | <description>"
// → ZIP 321 URI → matched against ledger rows read with the viewing key.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { zecToZats, zatsToZec } from './amount.js';
import { network, networkOfPrefix } from './network.js';

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const MEMO_MAX_BYTES = 512;
export const CODE_RE = /HSB-[0-9A-HJKMNP-TV-Z]{6}/;

/** @returns {string} "HSB-" + 6 Crockford base32 chars (32 | 256, so `& 31` is unbiased) */
export function newCode() {
  const b = randomBytes(6);
  let s = '';
  for (const x of b) s += CROCKFORD[x & 31];
  return 'HSB-' + s;
}

/**
 * Truncate a string to at most `max` UTF-8 bytes without splitting a code point.
 * @param {string} s @param {number} [max]
 */
export function truncateUtf8(s, max = MEMO_MAX_BYTES) {
  if (Buffer.byteLength(s, 'utf8') <= max) return s;
  let out = '';
  let used = 0;
  for (const ch of s) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (used + n > max) break;
    out += ch;
    used += n;
  }
  return out;
}

/** @param {string} code @param {string} description */
export function memoText(code, description) {
  const desc = String(description ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return truncateUtf8(desc ? `${code} | ${desc}` : code, MEMO_MAX_BYTES).trim();
}

/** @param {string|Buffer} s → base64url without padding (ZIP 321 memo encoding) */
export function base64url(s) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} s */
export function fromBase64url(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/**
 * Shielded addresses of the configured network only:
 * - test: unified `utest1…` or Sapling `ztestsapling1…`
 * - main: unified `u1…` or Sapling `zs1…`
 * Transparent addresses (t1/t3/tm/t2/tex) are always rejected: a memo needs a shielded receiver.
 * An address of the other network is rejected (never mix networks).
 * @param {string} addr
 * @param {'test'|'main'} [net]
 * @returns {{ok:true, kind:'unified'|'sapling'} | {ok:false, reason:string}}
 */
export function validateAddress(addr, net = 'test') {
  const a = String(addr ?? '').trim();
  const n = network(net);
  if (!a) return { ok: false, reason: 'empty address' };
  if (/^(uview|uivk)/.test(a)) return { ok: false, reason: 'that is a viewing key, not an address' };
  if (/^(t1|t3|tm|t2|tex)/.test(a)) return { ok: false, reason: 'transparent address rejected (memos need a shielded receiver)' };
  const other = networkOfPrefix(a.toLowerCase());
  if (other && other !== n.id) return { ok: false, reason: `${network(other).label.toLowerCase()} address rejected (HISAAB_NETWORK=${n.id})` };
  if (a !== a.toLowerCase()) return { ok: false, reason: 'address must be lowercase bech32' };
  // Test the longer prefix first: on testnet `utest1` vs nothing; on mainnet `u1`/`zs1`.
  const { unified, sapling } = n.addresses;
  if (a.startsWith(sapling)) {
    if (!new RegExp(`^${sapling}[02-9ac-hj-np-z]{60,}$`).test(a)) return { ok: false, reason: `malformed ${sapling} address` };
    return { ok: true, kind: 'sapling' };
  }
  if (a.startsWith(unified)) {
    if (!new RegExp(`^${unified}[02-9ac-hj-np-z]{100,}$`).test(a)) return { ok: false, reason: `malformed ${unified} address` };
    return { ok: true, kind: 'unified' };
  }
  return { ok: false, reason: `unknown address type (expected ${unified}… or ${sapling}…)` };
}

/**
 * ZIP 321 payment URI.
 * @param {{address:string, amountZats:number, memo?:string, message?:string, network?:'test'|'main'}} p
 */
export function zip321Uri({ address, amountZats, memo, message, network: net = 'test' }) {
  const v = validateAddress(address, net);
  if (!v.ok) throw new Error(`Invalid address: ${v.reason}`);
  if (!Number.isSafeInteger(amountZats) || amountZats <= 0) throw new Error('amount must be > 0');
  const q = [`amount=${zatsToZec(amountZats)}`];
  if (memo) {
    if (Buffer.byteLength(memo, 'utf8') > MEMO_MAX_BYTES) throw new Error('memo exceeds 512 bytes');
    q.push(`memo=${base64url(memo)}`);
  }
  if (message) q.push(`message=${encodeURIComponent(message)}`);
  return `zcash:${address}?${q.join('&')}`;
}

/**
 * @typedef {object} Invoice
 * @property {string} code
 * @property {number} amountZats
 * @property {string} amountZec
 * @property {string} description
 * @property {string} memo
 * @property {string} address
 * @property {string} uri
 * @property {string} createdAt
 * @property {'unpaid'|'seen'|'paid'|'underpaid'|'overpaid'} status
 * @property {'none'|'seen'|'mined'|'confirmed'} paymentState
 * @property {string|null} txid
 * @property {number|null} height
 * @property {number} receivedZats
 * @property {string|null} explorer
 * @property {string|null} matchedAt
 */

/**
 * @param {{amount:string|number, description:string, address:string, now?: Date, code?: string, network?: 'test'|'main'}} p
 * @returns {Invoice}
 */
export function createInvoice({ amount, description, address, now = new Date(), code = newCode(), network: net = 'test' }) {
  const amountZats = zecToZats(amount);
  if (amountZats <= 0) throw new Error('amount must be > 0');
  const desc = String(description ?? '').trim();
  if (!desc) throw new Error('description is required');
  const memo = memoText(code, desc);
  const uri = zip321Uri({ address, amountZats, memo, message: truncateUtf8(`${code} ${desc}`, 200), network: net });
  return {
    code, amountZats, amountZec: zatsToZec(amountZats), description: desc, memo, address, uri,
    network: net, createdAt: now.toISOString(), status: 'unpaid', paymentState: 'none', txid: null, height: null,
    receivedZats: 0, explorer: null, matchedAt: null,
  };
}

/**
 * Match invoices against ledger rows. Pure and idempotent:
 * - a row "pays" an invoice if its memo contains the invoice code (case-insensitive);
 *   all scope-0 notes of one txid carrying the code are summed;
 * - each txid satisfies at most one invoice; an invoice keeps the txid it was first matched to;
 * - status: exact amount + confirmed → paid; exact + seen/mined → seen; less → underpaid; more → overpaid.
 * @param {Invoice[]} invoices
 * @param {import('./ledger.js').LedgerRow[]} rows incoming rows (kind 'in'), incl. mempool rows
 * @param {{now?: Date}} [opts]
 * @returns {Invoice[]} new array (inputs are not mutated)
 */
export function matchInvoices(invoices, rows, { now = new Date() } = {}) {
  /** @type {Map<string, {txid:string, height:number|null, status:string, explorer:string, codes:Map<string, number>}>} */
  const byTx = new Map();
  for (const r of rows) {
    if (r.kind !== 'in') continue;
    const m = String(r.memo ?? '').toUpperCase().match(new RegExp(CODE_RE.source, 'g'));
    if (!m) continue;
    let t = byTx.get(r.txid);
    if (!t) {
      t = { txid: r.txid, height: r.height, status: r.status, explorer: r.explorer, codes: new Map() };
      byTx.set(r.txid, t);
    }
    // A mined view of the tx wins over a mempool view of the same txid.
    if (r.height && (!t.height || rank(r.status) > rank(t.status))) { t.height = r.height; t.status = r.status; }
    for (const code of new Set(m)) t.codes.set(code, (t.codes.get(code) || 0) + r.amountZats);
  }
  const out = invoices.map((i) => ({ ...i }));
  const claimed = new Set(out.filter((i) => i.txid).map((i) => /** @type {string} */ (i.txid)));
  // Oldest invoice first, so a later invoice can't steal an earlier one's payment.
  const order = [...out].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const inv of order) {
    let tx = inv.txid ? byTx.get(inv.txid) : undefined;
    if (inv.txid && (!tx || !tx.codes.has(inv.code))) continue; // keep the existing lock as-is
    if (!tx) {
      const candidates = [...byTx.values()]
        .filter((t) => t.codes.has(inv.code) && !claimed.has(t.txid))
        .sort((a, b) => (a.height ?? Infinity) - (b.height ?? Infinity) || a.txid.localeCompare(b.txid));
      tx = candidates[0];
      if (!tx) continue;
      claimed.add(tx.txid);
      inv.matchedAt = now.toISOString();
    }
    const received = /** @type {number} */ (tx.codes.get(inv.code));
    inv.txid = tx.txid;
    inv.height = tx.height ?? null;
    inv.explorer = tx.explorer;
    inv.receivedZats = received;
    inv.paymentState = /** @type {Invoice['paymentState']} */ (tx.status);
    if (received < inv.amountZats) inv.status = 'underpaid';
    else if (received > inv.amountZats) inv.status = 'overpaid';
    else inv.status = tx.status === 'confirmed' ? 'paid' : 'seen';
  }
  return out;
}

/** @param {string} s */
const rank = (s) => ({ seen: 0, mined: 1, confirmed: 2 })[s] ?? -1;

// ---------- storage (data/invoices.json, dir 700, file 600) ----------

/** @param {string} dataDir */
export function invoicesPath(dataDir) {
  return join(dataDir, 'invoices.json');
}

/** @param {string} dataDir @returns {Invoice[]} */
export function loadInvoices(dataDir) {
  const f = invoicesPath(dataDir);
  if (!existsSync(f)) return [];
  const j = JSON.parse(readFileSync(f, 'utf8'));
  return Array.isArray(j.invoices) ? j.invoices : [];
}

/** @param {string} dataDir @param {Invoice[]} invoices */
export function saveInvoices(dataDir, invoices) {
  writeJsonPrivate(invoicesPath(dataDir), { version: 1, invoices });
}

/** Atomic write, dir 0700, file 0600. @param {string} file @param {unknown} obj */
export function writeJsonPrivate(file, obj) {
  const dir = join(file, '..');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

/** @param {Invoice[]} invoices @returns {string} CSV */
export function invoicesTable(invoices) {
  return [
    ['code', 'created_at_utc', 'description', 'amount_zec', 'status', 'payment_state', 'received_zec', 'txid', 'block_height', 'explorer', 'memo'],
    ...invoices.map((i) => [i.code, i.createdAt, i.description, i.amountZec, i.status, i.paymentState, zatsToZec(i.receivedZats || 0), i.txid ?? '', i.height ?? '', i.explorer ?? '', i.memo]),
  ];
}
