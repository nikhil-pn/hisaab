// Verifiable receipt for one payment (one txid), and its verifier.
import { createHash } from 'node:crypto';
import { zatsToZec } from './amount.js';
import { buildRows, explorerLink } from './ledger.js';
import { network as netInfo } from './network.js';
import { CODE_RE } from './invoices.js';

/** Canonical JSON: object keys sorted recursively, no whitespace. @param {unknown} v */
export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const o = /** @type {Record<string, unknown>} */ (v);
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') + '}';
}

/** sha256 over the canonical JSON of the receipt without its `sha256` field. @param {Record<string, unknown>} r */
export function receiptHash(r) {
  const { sha256: _ignored, ...rest } = r;
  return createHash('sha256').update(canonicalJson(rest)).digest('hex');
}

export const EXPLORER_PROVES = [
  'the transaction exists on the Zcash chain named in `network`',
  'its block height and block time',
  'its fee (and that its outputs are shielded)',
];
export const VIEWING_KEY_PROVES = [
  'the amount received by this wallet',
  'the memo text (it is encrypted on-chain)',
  'which of this wallet\'s addresses received it',
];

/**
 * Summarise one txid from ledger rows (incoming notes summed).
 * @param {import('./ledger.js').LedgerRow[]} rows
 * @param {string} txid
 */
export function summariseTx(rows, txid) {
  const mine = rows.filter((r) => r.txid === txid && (r.kind === 'in' || r.kind === 'self'));
  const out = rows.find((r) => r.txid === txid && r.kind === 'out');
  if (!mine.length && !out) return null;
  const first = mine[0] || out;
  const amountZats = mine.reduce((s, r) => s + r.amountZats, 0);
  const memos = [...new Set(mine.map((r) => r.memo).filter(Boolean))];
  return {
    txid,
    height: first.height,
    timeUtc: first.timeUtc,
    amountZats,
    memo: memos.join(' / '),
    pools: [...new Set(mine.map((r) => r.pool))].join('+'),
    feeZats: out ? out.feeZats : 0,
    status: first.status,
  };
}

/**
 * @param {import('./ledger.js').LedgerRow[]} rows
 * @param {string} txid
 * @param {{invoiceCode?: string|null, accountName?: string, generatedAt?: Date, mode?: string}} [opts]
 */
export function buildReceipt(rows, txid, { invoiceCode = null, accountName = '', generatedAt = new Date(), mode = 'REAL', network = 'test', keyKind = 'full' } = {}) {
  const s = summariseTx(rows, txid);
  if (!s) throw new Error(`txid ${txid} not found in this wallet's ledger`);
  const code = invoiceCode ?? (String(s.memo).toUpperCase().match(CODE_RE)?.[0] || null);
  /** @type {Record<string, any>} */
  const r = {
    type: 'hisaab-receipt',
    version: 1,
    network: netInfo(network).chain,
    network_label: netInfo(network).label,
    data_source: mode,
    viewing_key_kind: keyKind,
    txid: s.txid,
    block_height: s.height,
    block_time_utc: s.timeUtc,
    amount_zec: zatsToZec(s.amountZats),
    amount_zats: s.amountZats,
    memo: s.memo,
    invoice_code: code,
    pools: s.pools,
    status_at_generation: s.status,
    explorer: explorerLink(s.txid, network),
    account_name: accountName,
    explorer_proves: EXPLORER_PROVES,
    only_viewing_key_holder_can_check: VIEWING_KEY_PROVES,
    how_to_verify: 'Import the wallet\'s viewing key (UIVK uivk… or UFVK uview…) into zkool or Zingo with the birth height, sync, and find this txid; or run `hisaab verify <receipt.json>` against a watch-only zkool account.',
    generated_at: generatedAt.toISOString(),
  };
  r.sha256 = receiptHash(r);
  return r;
}

/**
 * Re-read the tx from a watch-only zkool account and compare field by field.
 * @param {Record<string, any>} receipt
 * @param {import('./zkool.js').Zkool} zkool
 * @param {number} accountId
 */
export async function verifyReceipt(receipt, zkool, accountId) {
  const hashOk = typeof receipt.sha256 === 'string' && receiptHash(receipt) === receipt.sha256;
  /** @type {{field:string, expected:any, actual:any, match:boolean}[]} */
  const fields = [];
  let tx = null;
  let error = null;
  try {
    tx = await zkool.transactionById(accountId, receipt.txid);
  } catch (e) {
    error = /** @type {Error} */ (e).message;
  }
  if (tx) {
    const rows = buildRows([tx], { network: receipt.network === 'zcash-mainnet' ? 'main' : 'test' });
    const s = summariseTx(rows, receipt.txid);
    const cmp = (/** @type {string} */ field, /** @type {any} */ expected, /** @type {any} */ actual) =>
      fields.push({ field, expected, actual, match: expected === actual });
    cmp('txid', receipt.txid, tx.txid);
    cmp('block_height', receipt.block_height, s?.height ?? null);
    cmp('block_time_utc', receipt.block_time_utc, s?.timeUtc ?? null);
    cmp('amount_zats', receipt.amount_zats, s?.amountZats ?? null);
    cmp('memo', receipt.memo, s?.memo ?? null);
  }
  const ok = hashOk && !!tx && fields.every((f) => f.match);
  return { ok, hashOk, found: !!tx, error, fields, checkedAt: new Date().toISOString(), accountId };
}
