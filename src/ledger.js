// Pure ledger builder: zkool transactions → rows, Indian FY filter, totals, CSV.
// The only impure helper is `fetchInrRate` (network + cache file), kept at the bottom.
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { zecToZats, zatsToZec } from './amount.js';
import { explorerTx } from './network.js';

export const POOLS = /** @type {const} */ (['transparent', 'sapling', 'orchard', 'ironwood']);
/** @deprecated testnet prefix only; use explorerLink(txid, network) / EXPLORER_TX in network.js */
export const EXPLORER = 'https://testnet.zcashexplorer.app/transactions/';
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

/** @param {string} txid @param {'test'|'main'} [net] */
export const explorerLink = (txid, net = 'test') => explorerTx(txid, net);

/** @param {number} pool */
export const poolName = (pool) => POOLS[pool] ?? `pool-${pool}`;

/**
 * Parse zkool's `time` (chrono NaiveDateTime = UTC without zone). Accepts
 * "YYYY-MM-DDTHH:MM:SS[.fff]", the same with a space, with/without "Z", or
 * a number of unix seconds (ms if > 1e12).
 * @param {string|number|null|undefined} t
 * @returns {Date|null}
 */
export function parseZkoolTime(t) {
  if (t === null || t === undefined || t === '') return null;
  if (typeof t === 'number') return new Date(t > 1e12 ? t : t * 1000);
  let s = String(t).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseZkoolTime(Number(s));
  s = s.replace(' ', 'T');
  if (!/(Z|[+-]\d\d:?\d\d)$/.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** @param {Date} d → "2026-11-04 20:30:00 IST" */
export function formatIst(d) {
  const x = new Date(d.getTime() + IST_OFFSET_MS).toISOString();
  return `${x.slice(0, 10)} ${x.slice(11, 19)} IST`;
}

/**
 * Indian financial year bounds. "2026-27" = 2026-04-01T00:00:00+05:30 to 2027-03-31T23:59:59+05:30.
 * @param {string} fy
 * @returns {{fy:string, start:Date, end:Date}}
 */
export function fyBounds(fy) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(fy || '').trim());
  if (!m) throw new Error(`FY must look like "2026-27", got "${fy}"`);
  const y = Number(m[1]);
  if (Number(m[2]) !== (y + 1) % 100) throw new Error(`FY "${fy}": second year must be ${String((y + 1) % 100).padStart(2, '0')}`);
  return {
    fy: `${y}-${m[2]}`,
    start: new Date(Date.UTC(y, 3, 1, 0, 0, 0) - IST_OFFSET_MS),
    end: new Date(Date.UTC(y + 1, 2, 31, 23, 59, 59, 999) - IST_OFFSET_MS),
  };
}

/** @param {Date} d @returns {string} the FY ("2026-27") containing d, in IST */
export function fyOf(d) {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/** @param {Date|null} d @param {string} fy */
export function inFy(d, fy) {
  if (!d) return false;
  const { start, end } = fyBounds(fy);
  return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
}

/**
 * @param {number|null|undefined} height
 * @param {number|null|undefined} tip
 * @param {number} threshold
 * @returns {{status:'seen'|'mined'|'confirmed', confirmations:number}}
 */
export function paymentState(height, tip, threshold = 1) {
  if (!height || height <= 0) return { status: 'seen', confirmations: 0 };
  const confirmations = tip && tip >= height ? tip - height + 1 : 1;
  return { status: confirmations >= threshold ? 'confirmed' : 'mined', confirmations };
}

/**
 * @typedef {object} LedgerRow
 * @property {'in'|'out'|'self'} kind  in = received note (scope 0) of an incoming tx; out = net spend; self = scope-0 note inside our own spend
 * @property {string} txid
 * @property {number} txRowId zkool per-account row id (for memosByTransaction)
 * @property {number|null} height
 * @property {string|null} timeUtc ISO 8601 Z
 * @property {string|null} timeIst
 * @property {number} amountZats received (in/self) or net value incl. fee (out, negative)
 * @property {string} amountZec
 * @property {number} feeZats
 * @property {string} feeZec
 * @property {string} memo
 * @property {string} pool
 * @property {string} address
 * @property {string} explorer
 * @property {'seen'|'mined'|'confirmed'} status
 * @property {number} confirmations
 */

/**
 * Build ledger rows from zkool `transactionsByAccount` (+ optional `unconfirmedByAccount`).
 * - Incoming tx (net value ≥ 0): one row per note with scope 0. scope 1 = change, skipped.
 * - Outgoing tx (net value < 0): one `out` row with the net value (incl. fee) and fee;
 *   scope-0 notes inside it are our own self-transfers → `self` rows, never counted as income.
 * - Mempool txs not yet in `transactions` (or with height 0) → rows with status `seen`.
 * @param {import('./zkool.js').ZkTx[]} txs
 * @param {{tip?: number|null, threshold?: number, unconfirmed?: import('./zkool.js').ZkUnconfirmed[], network?: 'test'|'main'}} [opts]
 * @returns {LedgerRow[]}
 */
export function buildRows(txs, { tip = null, threshold = 1, unconfirmed = [], network = 'test' } = {}) {
  /** @type {LedgerRow[]} */
  const rows = [];
  const minedTxids = new Set();
  for (const tx of txs || []) {
    const when = parseZkoolTime(tx.time);
    const height = tx.height > 0 ? tx.height : null;
    if (height) minedTxids.add(tx.txid);
    const st = paymentState(height, tip, threshold);
    const net = zecToZats(tx.value);
    const fee = zecToZats(tx.fee ?? '0');
    const base = {
      txid: tx.txid,
      txRowId: tx.id,
      height,
      timeUtc: when ? when.toISOString() : null,
      timeIst: when ? formatIst(when) : null,
      explorer: explorerLink(tx.txid, network),
      ...st,
    };
    const ours = (tx.notes || []).filter((n) => Number(n.scope) === 0);
    if (net < 0) {
      rows.push({
        ...base,
        kind: 'out',
        amountZats: net,
        amountZec: zatsToZec(net),
        feeZats: fee,
        feeZec: zatsToZec(fee),
        memo: (tx.notes || []).map((n) => n.memo).filter(Boolean).join(' / '),
        pool: [...new Set((tx.notes || []).map((n) => poolName(n.pool)))].join('+'),
        address: '',
      });
      for (const n of ours) rows.push(noteRow(base, n, 'self'));
    } else {
      for (const n of ours) rows.push(noteRow(base, n, 'in'));
    }
  }
  for (const u of unconfirmed || []) {
    if (minedTxids.has(u.txid)) continue;
    const net = zecToZats(u.value);
    const base = {
      txid: u.txid,
      txRowId: -1,
      height: null,
      timeUtc: null,
      timeIst: null,
      explorer: explorerLink(u.txid, network),
      status: /** @type {'seen'} */ ('seen'),
      confirmations: 0,
    };
    if (net < 0) continue; // our own pending spend; it shows up once mined
    for (const n of (u.notes || []).filter((x) => Number(x.scope) === 0)) rows.push(noteRow(base, n, 'in'));
  }
  return rows;
}

/** @returns {LedgerRow} */
function noteRow(base, n, kind) {
  const v = zecToZats(n.value);
  return {
    ...base,
    kind,
    amountZats: v,
    amountZec: zatsToZec(v),
    feeZats: 0,
    feeZec: '0',
    memo: n.memo ?? '',
    pool: poolName(Number(n.pool)),
    address: n.address ?? '',
  };
}

/**
 * @param {LedgerRow[]} rows
 * @param {string} fy
 * @returns {LedgerRow[]} mined rows whose block time falls in the FY (IST)
 */
export function filterFy(rows, fy) {
  fyBounds(fy); // validate
  return rows.filter((r) => r.timeUtc && inFy(new Date(r.timeUtc), fy));
}

/**
 * @param {LedgerRow[]} rows
 * @returns {{receivedZats:number, sentZats:number, feesZats:number, netZats:number, count:number, countIn:number, countOut:number, received:string, sent:string, fees:string, net:string}}
 */
export function totals(rows) {
  let receivedZats = 0, sentZats = 0, feesZats = 0, countOut = 0;
  const inTx = new Set();
  for (const r of rows) {
    if (r.kind === 'in') {
      receivedZats += r.amountZats;
      inTx.add(r.txid);
    } else if (r.kind === 'out') {
      feesZats += r.feeZats;
      sentZats += -r.amountZats - r.feeZats;
      countOut++;
    }
  }
  const netZats = receivedZats - sentZats - feesZats;
  const countIn = inTx.size; // payments (txids), not notes: one payment can arrive as several notes
  return {
    receivedZats, sentZats, feesZats, netZats,
    count: countIn + countOut, countIn, countOut,
    received: zatsToZec(receivedZats), sent: zatsToZec(sentZats), fees: zatsToZec(feesZats), net: zatsToZec(netZats),
  };
}

// ---------- CSV ----------

/**
 * RFC 4180 cell escaping + spreadsheet formula-injection guard: a cell that
 * starts with = + - @ (or tab / CR) gets a leading apostrophe.
 * @param {unknown} v
 */
export function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** @param {unknown[][]} table @returns {string} CRLF-terminated CSV */
export function toCsv(table) {
  return table.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export const INR_HEADER = 'inr_reference_rate (mainnet ZEC/INR on tx date, CoinGecko; testnet TAZ has no value)';
export const INR_VALUE_HEADER = 'inr_reference_value (amount x mainnet rate; testnet TAZ has no value)';
export const INR_HEADERS_MAIN = ['inr_reference_rate (ZEC/INR on tx date, CoinGecko reference)', 'inr_reference_value (amount x reference rate)'];

/**
 * Ledger CSV. All amount columns are non-negative (direction is in `type`),
 * so the injection guard never has to touch a number.
 * @param {LedgerRow[]} rows
 * @param {{invoiceByTxid?: Record<string,string>, inr?: Record<string, number|null>, network?: 'test'|'main'}} [opts] inr keyed by txid
 */
export function ledgerCsv(rows, { invoiceByTxid = {}, inr, network = 'test' } = {}) {
  const header = ['date_ist', 'date_utc', 'type', 'txid', 'block_height', 'received_zec', 'sent_zec', 'fee_zec', 'memo', 'invoice', 'pool', 'status', 'confirmations', 'explorer'];
  if (inr) header.push(...(network === 'main' ? INR_HEADERS_MAIN : [INR_HEADER, INR_VALUE_HEADER]));
  const table = [header];
  for (const r of rows) {
    const received = r.kind === 'in' || r.kind === 'self' ? zatsToZec(r.amountZats) : '';
    const sent = r.kind === 'out' ? zatsToZec(-r.amountZats - r.feeZats) : '';
    const line = [
      r.timeIst ?? '', r.timeUtc ?? '', r.kind === 'self' ? 'self-transfer' : r.kind === 'in' ? 'received' : 'sent',
      r.txid, r.height ?? '', received, sent, r.kind === 'out' ? r.feeZec : '', r.memo, invoiceByTxid[r.txid] ?? '',
      r.pool, r.status, r.confirmations, r.explorer,
    ];
    if (inr) {
      const rate = inr[r.txid];
      const zats = r.kind === 'out' ? -r.amountZats : r.amountZats;
      line.push(rate ?? '', rate ? ((zats / 1e8) * rate).toFixed(2) : '');
    }
    table.push(line);
  }
  return toCsv(table);
}

// ---------- INR reference rate (impure) ----------

/** @param {Date} d → "DD-MM-YYYY" (UTC date, as CoinGecko /history expects) */
export function coingeckoDate(d) {
  const x = d.toISOString();
  return `${x.slice(8, 10)}-${x.slice(5, 7)}-${x.slice(0, 4)}`;
}

/**
 * Mainnet ZEC/INR reference rate for a date, cached per date in `<dataDir>/inr-cache.json`.
 * Returns null on any failure (offline, rate limit, timeout 5 s). Failures are not cached.
 * @param {Date} date
 * @param {{dataDir?: string, fetchImpl?: typeof fetch, timeoutMs?: number}} [opts]
 * @returns {Promise<number|null>}
 */
export async function fetchInrRate(date, { dataDir = 'data', fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const key = coingeckoDate(date);
  const file = join(dataDir, 'inr-cache.json');
  /** @type {Record<string, number>} */
  let cache = {};
  try {
    cache = JSON.parse(readFileSync(file, 'utf8'));
  } catch { /* empty */ }
  if (typeof cache[key] === 'number') return cache[key];
  try {
    const url = `https://api.coingecko.com/api/v3/coins/zcash/history?date=${key}&localization=false`;
    const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = await res.json();
    const rate = body?.market_data?.current_price?.inr;
    if (typeof rate !== 'number' || !Number.isFinite(rate)) return null;
    cache[key] = rate;
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const tmp = file + '.tmp';
    writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
    chmodSync(file, 0o600);
    return rate;
  } catch {
    return null;
  }
}

/**
 * @param {LedgerRow[]} rows
 * @param {Parameters<typeof fetchInrRate>[1]} [opts]
 * @returns {Promise<Record<string, number|null>>} rate per txid
 */
export async function inrRatesForRows(rows, opts) {
  /** @type {Record<string, number|null>} */
  const out = {};
  /** @type {Map<string, Promise<number|null>>} */
  const byDate = new Map();
  for (const r of rows) {
    if (!r.timeUtc) { out[r.txid] = null; continue; }
    const d = new Date(r.timeUtc);
    const k = coingeckoDate(d);
    if (!byDate.has(k)) byDate.set(k, fetchInrRate(d, opts));
    out[r.txid] = await byDate.get(k);
  }
  return out;
}
