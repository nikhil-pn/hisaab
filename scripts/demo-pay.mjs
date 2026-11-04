#!/usr/bin/env node
// Plays the CLIENT: pays a Hisaab invoice from the demo-payer wallet (local zkool :8001).
// Usage: node scripts/demo-pay.mjs 'zcash:utest1…?amount=0.01&memo=…'
// Prints the txid and the explorer link. Real shielded testnet payment; TAZ has no value.
import { readFileSync } from 'node:fs';

const URL_ = process.env.ZKOOL_WALLETS_URL || 'http://127.0.0.1:8001/graphql';

async function gql(query, variables = {}) {
  const res = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data;
}

function parseZip321(uri) {
  const m = /^zcash:([^?]+)\?(.*)$/.exec(uri.trim());
  if (!m) throw new Error('not a zcash: payment URI');
  const q = new URLSearchParams(m[2]);
  const memoB64 = q.get('memo');
  const memo = memoB64 ? Buffer.from(memoB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : undefined;
  return { address: m[1], amount: q.get('amount'), memo };
}

async function main() {
  const uri = process.argv[2];
  if (!uri) throw new Error("usage: demo-pay.mjs 'zcash:utest1…?amount=…&memo=…'");
  const { address, amount, memo } = parseZip321(uri);
  if (!/^(utest1|ztestsapling)/.test(address)) throw new Error('refusing: not a testnet shielded address');
  const wallets = JSON.parse(readFileSync(process.env.HISAAB_DEMO_WALLETS || new URL('../data/demo-wallets.json', import.meta.url), 'utf8'));
  const id = wallets.payer.account;
  // Sync first, or a second pay in a row fails with "No feasible note selection found".
  const h = await gql('mutation($ids: [Int!]!) { synchronize(idAccounts: $ids) }', { ids: [id] });
  console.error(`payer synced to ${h.synchronize}; paying ${amount} TAZ, memo "${memo}"`);
  const d = await gql('mutation($id: Int!, $p: Payment!) { pay(idAccount: $id, payment: $p) }', {
    id, p: { recipients: [{ address, amount, memo }], confirmations: 1 },
  });
  console.log(JSON.stringify({ txid: d.pay, explorer: `https://zexplorer.app/testnet/tx/${d.pay}`, amount, memo }));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
