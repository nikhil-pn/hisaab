// CA (chartered accountant) pack: one folder per FY with ledger, receipts,
// invoices, a read-only proof and a sha256 manifest.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { join, relative } from 'node:path';
import { filterFy, fyBounds, totals, ledgerCsv, inrRatesForRows, formatIst, toCsv } from './ledger.js';
import { buildReceipt } from './receipt.js';
import { invoicesTable } from './invoices.js';
import { network as netInfo } from './network.js';

/** @param {Date} d → "YYYYMMDD-HHMM" in IST */
export function packStamp(d) {
  const x = new Date(d.getTime() + 5.5 * 3600e3).toISOString();
  return `${x.slice(0, 4)}${x.slice(5, 7)}${x.slice(8, 10)}-${x.slice(11, 13)}${x.slice(14, 16)}`;
}

/** @param {string|Buffer} data */
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/**
 * Attempt `pay` on the watch-only account and record the exact outcome.
 * Refuses to try if zkool holds a seed for the account (that would be a real spend).
 * @param {import('./zkool.js').Zkool} zkool
 * @param {number} accountId
 * @param {Date} [now]
 * @param {{network?: 'test'|'main'}} [opts] on mainnet `pay` is NEVER called: only the seed check is recorded.
 */
export async function readonlyProof(zkool, accountId, now = new Date(), { network = 'test' } = {}) {
  const attemptedAt = now.toISOString();
  let hasSeed = null;
  try {
    hasSeed = await zkool.hasSeed(accountId);
  } catch (e) {
    return { attempted: false, attemptedAt, result: 'error', error: `could not inspect account: ${/** @type {Error} */ (e).message}` };
  }
  if (hasSeed) {
    return { attempted: false, attemptedAt, result: 'skipped', error: 'account has a seed in zkool: NOT watch-only, proof refused (a pay would be a real spend)' };
  }
  if (network !== 'test') {
    return {
      attempted: false, attemptedAt, result: 'skipped-mainnet', network,
      error: 'pay not attempted: Hisaab never calls pay on mainnet (watch-only mode). zkool reports NO seed for this account, and a viewing key (uivk…/uview…) contains no spending key.',
    };
  }
  let recipient = null;
  try {
    recipient = (await zkool.address(accountId))?.ua;
  } catch { /* fall through */ }
  const request = { recipients: [{ address: recipient || '', amount: '0.00001', memo: 'hisaab read-only proof' }], confirmations: 1 };
  try {
    const txid = await zkool.pay(accountId, request);
    return { attempted: true, attemptedAt, result: 'UNEXPECTED_SUCCESS', txid, error: null, request };
  } catch (e) {
    return { attempted: true, attemptedAt, result: 'refused', error: /** @type {Error} */ (e).message, request };
  }
}

/** @param {Awaited<ReturnType<typeof readonlyProof>>} p @param {{accountId:number, accountName:string, zkoolUrl:string, mode:string, network?:'test'|'main'}} ctx */
export function readonlyProofText(p, ctx) {
  const n = netInfo(ctx.network ?? 'test');
  const lines = [
    'Hisaab read-only proof',
    '======================',
    `Network: ${n.label} (${n.chain})`,
    `Data source: ${ctx.mode}${ctx.mode === 'MOCK' ? ' (test mock server, NOT a real wallet)' : ' (zkool_graphql)'}`,
    `zkool endpoint: ${ctx.zkoolUrl}`,
    `Account: #${ctx.accountId} "${ctx.accountName}" (created from a viewing key: ${n.viewingKeys.incoming}… or ${n.viewingKeys.full}…)`,
    `Attempted at (UTC): ${p.attemptedAt}`,
    `Attempted at (IST): ${formatIst(new Date(p.attemptedAt))}`,
    '',
  ];
  if (p.attempted) {
    lines.push(`Action: GraphQL mutation pay(idAccount, payment) — send 0.00001 ${n.coin} to the account's own address.`);
    if (p.result === 'refused') {
      lines.push('Result: REFUSED by the wallet server.', `Exact error text: ${p.error}`, '');
      lines.push('Meaning: this account holds no spending key. Whoever has this pack (or the viewing key)', 'can read the history but cannot move funds.');
    } else {
      lines.push(`Result: ${p.result} txid=${p.txid}`, 'WARNING: the account was able to spend. It is NOT watch-only. Do not share this pack.');
    }
  } else {
    lines.push(`Result: not attempted (${p.result}): ${p.error}`);
  }
  return lines.join('\n') + '\n';
}

/** @param {{fy:string, accountName:string, birth:number|null, ufvkHint:string, keyKind?:string, network?:'test'|'main', mode:string, threshold:number, t:ReturnType<typeof totals>, generatedAt:Date}} c */
export function caReadme(c) {
  const { start, end } = fyBounds(c.fy);
  const incoming = c.keyKind === 'incoming-only';
  const n = netInfo(c.network ?? 'test');
  const main = n.id === 'main';
  const keyLine = incoming
    ? `an **incoming-only viewing key** (UIVK, \`${n.viewingKeys.incoming}…\`): it shows payments received and nothing else`
    : `a **full viewing key** (UFVK, \`${n.viewingKeys.full}…\`): it shows payments received and sent`;
  return `# Hisaab books — FY ${c.fy}

${c.mode === 'MOCK' ? '> **MOCK DATA.** This pack was built from a test mock server, not a real wallet.\n\n' : ''}**Network: ${n.label}** (${n.chain}, ${n.coin}).${main ? ' This is a WATCH-ONLY mainnet ledger: Hisaab never spends or calls pay on mainnet.' : ''}

This folder is the shielded-ZEC (Zcash **${main ? 'mainnet' : 'testnet'}**, ${n.coin}) bookkeeping for the wallet
"${c.accountName}" for the Indian financial year **${c.fy}**
(${formatIst(start)} to ${formatIst(end)}). It was produced by Hisaab from ${keyLine},
not from the wallet itself.

**Key kind: ${incoming ? 'incoming-only' : 'full'}.**${incoming ? ' Spends, change and fees paid are NOT visible with this key, so "sent" and "fees" below are not known (shown as 0); the ledger lists income only.' : ''}

## What is in here

| File | What it is |
|---|---|
| \`ledger.csv\` | One row per payment received (and per payment sent), dates in IST and UTC, amounts in ZEC, memo, invoice code, explorer link. Opens in Excel / Google Sheets. |
| \`ledger.json\` | The same rows plus totals, machine-readable. |
| \`receipts/<txid>.json\` | One receipt per received payment, each with its own sha256. |
| \`invoices.csv\` | Invoices issued with Hisaab and whether each was paid. |
| \`readonly-proof.txt\` | ${main ? 'Mainnet: no spend attempted (Hisaab never calls pay on mainnet); records that zkool holds no seed for this account.' : 'Hisaab tried to spend from this account and the wallet refused: proof the key is view-only.'} |
| \`MANIFEST.sha256\` | sha256 of every file. Check with \`sha256sum -c MANIFEST.sha256\`. |

## Totals for FY ${c.fy}

- Received: **${c.t.received} ZEC** in ${c.t.countIn} payment(s)
${incoming ? '- Sent / fees: not visible (incoming-only key: spends not visible)' : `- Sent: ${c.t.sent} ZEC in ${c.t.countOut} transaction(s), fees ${c.t.fees} ZEC`}
- A payment counts as confirmed after ${c.threshold} block(s).

${main ? 'Any INR column is the CoinGecko ZEC/INR reference rate on the transaction date (a reference, not a realised price).' : 'Testnet TAZ has no monetary value. Any INR column is a mainnet ZEC reference rate (CoinGecko)\nshown only to illustrate how a mainnet ledger would look.'}

## How to check it yourself

1. **Integrity:** \`sha256sum -c MANIFEST.sha256\` — every line must say OK.
2. **Existence:** open the explorer link in any row (zexplorer.app). It proves the transaction
   exists, its block height, block time and fee. It does **not** show amount or memo — those are encrypted.
3. **Amount and memo:** ask your client for the **viewing key** (\`${n.viewingKeys.incoming}…\` or \`${n.viewingKeys.full}…\`${c.birth ? `, birth height ${c.birth}` : ''}).
   ${c.ufvkHint ? `(This pack was made from the key ${c.ufvkHint}.) ` : ''}Import it as a watch-only account in any
   zkool or Zingo wallet (${main ? 'mainnet' : 'testnet'}), sync, and compare. Or run \`hisaab verify receipts/<txid>.json\`
   against a watch-only zkool account.

## What a viewing key reveals (and what it can't do)

- **Ask for the narrowest key: the incoming viewing key (UIVK, \`${n.viewingKeys.incoming}…\`).** It reveals only payments
  *received* (amounts, memos, times) — enough to check income. A full viewing key (UFVK, \`${n.viewingKeys.full}…\`) also
  reveals every spend, change output and fee. Request the UFVK only if you must also audit what was paid out.
- Either key reveals the **whole history of that wallet** from its birth height onward (for the UIVK: all income) —
  not just this financial year. Treat it like a bank statement.
- Neither key **can spend**. See \`readonly-proof.txt\`.
- Hisaab's own server holds only this viewing key, invoice codes and txids.

## Indian tax context (not advice)

Income from virtual digital assets is taxed under section 115BBH (30%), with TDS under 194S, and is
reported in Schedule VDA of the ITR. Use this ledger as supporting evidence; the classification is yours.
`;
}

/** @param {string} dir @returns {string[]} relative file paths, sorted */
function listFiles(dir) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Build the pack.
 * @param {object} p
 * @param {import('./zkool.js').Zkool} p.zkool
 * @param {number} p.accountId
 * @param {string} p.accountName
 * @param {number|null} [p.birth]
 * @param {string} [p.ufvk]
 * @param {'full'|'incoming-only'} [p.keyKind]
 * @param {'test'|'main'} [p.network]
 * @param {string} p.fy
 * @param {string} p.outDir
 * @param {import('./ledger.js').LedgerRow[]} p.rows all rows (filtered to FY here)
 * @param {number} p.threshold
 * @param {import('./invoices.js').Invoice[]} p.invoices
 * @param {string} p.mode 'REAL' | 'MOCK'
 * @param {Date} [p.now]
 * @param {boolean} [p.inr]
 * @param {string} [p.dataDir]
 * @param {typeof fetch} [p.fetchImpl]
 */
export async function buildPack(p) {
  const now = p.now ?? new Date();
  const net = p.network ?? 'test';
  const n = netInfo(net);
  const { fy } = fyBounds(p.fy);
  const dir = join(p.outDir, `hisaab-${net === 'main' ? 'MAINNET-' : ''}FY${fy}-${packStamp(now)}`);
  mkdirSync(join(dir, 'receipts'), { recursive: true, mode: 0o700 });

  const rows = filterFy(p.rows, fy);
  const t = totals(rows);
  /** @type {Record<string,string>} */
  const invoiceByTxid = {};
  for (const i of p.invoices) if (i.txid) invoiceByTxid[i.txid] = i.code;
  const inr = p.inr ? await inrRatesForRows(rows, { dataDir: p.dataDir, fetchImpl: p.fetchImpl }) : undefined;

  writeFileSync(join(dir, 'ledger.csv'), ledgerCsv(rows, { invoiceByTxid, inr, network: net }));
  writeFileSync(join(dir, 'ledger.json'), JSON.stringify({
    type: 'hisaab-ledger', version: 1, network: n.chain, network_label: n.label, coin: n.coin, data_source: p.mode, fy,
    account_name: p.accountName, birth: p.birth ?? null, confirmations_threshold: p.threshold,
    key_kind: p.keyKind ?? 'full', spends_visible: (p.keyKind ?? 'full') === 'full',
    ...(p.keyKind === 'incoming-only' ? { note: 'incoming-only key: spends not visible' } : {}),
    generated_at: now.toISOString(), totals: t, rows, invoice_by_txid: invoiceByTxid,
  }, null, 2) + '\n');

  const incomingTxids = [...new Set(rows.filter((r) => r.kind === 'in').map((r) => r.txid))];
  for (const txid of incomingTxids) {
    const rc = buildReceipt(rows, txid, { invoiceCode: invoiceByTxid[txid] ?? null, accountName: p.accountName, generatedAt: now, mode: p.mode, network: net, keyKind: p.keyKind ?? 'full' });
    writeFileSync(join(dir, 'receipts', `${txid}.json`), JSON.stringify(rc, null, 2) + '\n');
  }

  writeFileSync(join(dir, 'invoices.csv'), toCsv(invoicesTable(p.invoices)));

  const proof = await readonlyProof(p.zkool, p.accountId, now, { network: net });
  writeFileSync(join(dir, 'readonly-proof.txt'), readonlyProofText(proof, { accountId: p.accountId, accountName: p.accountName, zkoolUrl: p.zkool.url, mode: p.mode, network: net }));

  const ufvkHint = p.ufvk ? `${p.ufvk.slice(0, 16)}…${p.ufvk.slice(-6)}` : '';
  writeFileSync(join(dir, 'README-for-CA.md'), caReadme({ fy, accountName: p.accountName, birth: p.birth ?? null, ufvkHint, keyKind: p.keyKind ?? 'full', network: net, mode: p.mode, threshold: p.threshold, t, generatedAt: now }));

  const files = listFiles(dir).filter((f) => f !== 'MANIFEST.sha256');
  const manifest = files.map((f) => `${sha256(readFileSync(join(dir, f)))}  ${f}`).join('\n') + '\n';
  writeFileSync(join(dir, 'MANIFEST.sha256'), manifest);
  // The pack reveals the wallet's history: keep it owner-only on disk.
  for (const f of [...files, 'MANIFEST.sha256']) chmodSync(join(dir, f), 0o600);
  return {
    dir,
    files: [...files, 'MANIFEST.sha256'],
    manifestSha256: sha256(manifest),
    totals: t,
    readonlyProof: proof,
    receipts: incomingTxids.length,
  };
}
