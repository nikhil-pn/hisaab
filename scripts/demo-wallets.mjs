#!/usr/bin/env node
// One-time demo wallet setup on the local zkool "wallets" server (127.0.0.1:8001).
// Creates two SEED accounts — "demo-payer" (the client) and "demo-freelancer" (the Hisaab user) —
// and writes only PUBLIC material to data/demo-wallets.json: addresses, the freelancer's viewing keys
// and birth height. Seeds stay inside zkool's local database and are never read or printed here.
// Usage: node scripts/demo-wallets.mjs [--faucet]
import { mkdirSync, writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';

const URL_ = process.env.ZKOOL_WALLETS_URL || 'http://127.0.0.1:8001/graphql';
const OUT = new URL('../data/demo-wallets.json', import.meta.url);

async function gql(query, variables = {}) {
  const res = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data;
}

async function ensureAccount(name, birth) {
  const { accounts } = await gql('{ accounts { id name } }');
  const found = accounts.find((a) => a.name === name);
  if (found) return found.id;
  const d = await gql('mutation($a: NewAccount!) { createAccount(newAccount: $a) }', { a: { name, key: '', aindex: 0, useInternal: true, birth } });
  return d.createAccount;
}

async function main() {
  const { currentHeight } = await gql('{ currentHeight }');
  const payer = await ensureAccount('demo-payer', currentHeight);
  const freelancer = await ensureAccount('demo-freelancer', currentHeight);
  const ua = async (id) => (await gql('query($id: Int!) { addressByAccount(idAccount: $id) { ua } }', { id })).addressByAccount.ua;
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
  const info = {
    network: 'testnet',
    created_at_height: prev.created_at_height ?? currentHeight,
    payer: { account: payer, ua: await ua(payer) },
    freelancer: {
      account: freelancer,
      ua: await ua(freelancer),
      birth: prev.freelancer?.birth ?? currentHeight,
      ufvk: (await gql('query($id: Int!) { unifiedFullViewingKey(idAccount: $id) }', { id: freelancer })).unifiedFullViewingKey,
      uivk: (await gql('query($id: Int!) { unifiedFullViewingKey(idAccount: $id, incoming: true) }', { id: freelancer })).unifiedFullViewingKey,
    },
  };
  mkdirSync(new URL('../data/', import.meta.url), { recursive: true, mode: 0o700 });
  writeFileSync(OUT, JSON.stringify(info, null, 2));
  chmodSync(OUT, 0o600);
  console.log(JSON.stringify({ height: currentHeight, payer: info.payer, freelancer: { ua: info.freelancer.ua, birth: info.freelancer.birth, uivk: info.freelancer.uivk.slice(0, 24) + '…' } }, null, 2));

  if (process.argv.includes('--faucet')) {
    // Fauzec: 1 TAZ per address per 24 h, API has no captcha.
    const r = await fetch('https://fauzec.com/api/v1/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ network: 'testnet', address: info.payer.ua }) });
    console.log('fauzec', r.status, await r.text());
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
