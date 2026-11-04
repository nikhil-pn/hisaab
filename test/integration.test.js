// End-to-end against the MOCK zkool GraphQL server (test/mock-zkool.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { startMockZkool } from './mock-zkool.js';
import { createZkool, ZkoolError } from '../src/zkool.js';
import { createHisaab } from '../src/service.js';
import { startServer } from '../src/server.js';
import { verifyReceipt } from '../src/receipt.js';
import { loadInvoices } from '../src/invoices.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/mock-zkool-fixture.json', import.meta.url), 'utf8'));

/** @type {Awaited<ReturnType<typeof startMockZkool>>} */
let mock;
/** @type {ReturnType<typeof createHisaab>} */
let h;
let dir;

before(async () => {
  mock = await startMockZkool();
  dir = mkdtempSync(join(tmpdir(), 'hisaab-it-'));
  h = createHisaab({ zkoolUrl: mock.url, accountName: 'hisaab-watch', confirmations: 1, dataDir: join(dir, 'data'), outDir: join(dir, 'out') });
});
after(async () => { await mock.close(); });

test('zkool client: queries, MOCK identification, GraphQL errors surfaced', async () => {
  const z = createZkool({ url: mock.url });
  assert.equal(await z.apiVersion(), 'mock-1.0');
  assert.equal(typeof (await z.currentHeight()), 'number');
  const accts = await z.listAccounts();
  assert.ok(accts.every((a) => !('seed' in a)), 'listAccounts never requests seeds');
  assert.equal(await z.hasSeed(1), true);
  await assert.rejects(z.transactionById(1, 'ff'.repeat(32)), (e) => e instanceof ZkoolError && e.message === 'Unknown txid');
  const dead = createZkool({ url: 'http://127.0.0.1:1/graphql', timeoutMs: 2000 });
  await assert.rejects(dead.currentHeight(), /zkool unreachable/);
});

test('connect → sync → ledger → invoices → pack → verify (MOCK)', async () => {
  const c = await h.connect({ ufvk: fx.watch.exampleUfvk, birth: 3600000 });
  assert.equal(c.created, true);
  assert.equal(c.mode, 'MOCK');
  const again = await h.connect({ ufvk: fx.watch.exampleUfvk, birth: 3600000 });
  assert.equal(again.created, false, 'dedupe by name/ufvk');
  assert.equal(again.accountId, c.accountId);
  assert.equal(statSync(join(dir, 'data')).mode & 0o777, 0o700);
  assert.equal(statSync(join(dir, 'data', 'config.json')).mode & 0o777, 0o600);

  await h.sync();
  const l = await h.ledger('2026-27');
  assert.equal(l.mode, 'MOCK');
  assert.equal(l.totals.received, '0.071');
  assert.equal(l.pending.length, 1);

  const inv = await h.newInvoice({ amount: '0.015', description: 'Logo design' });
  assert.match(inv.code, /^HSB-[0-9A-HJKMNP-TV-Z]{6}$/);
  assert.ok(inv.uri.startsWith(`zcash:${fx.watch.address}?amount=0.015&memo=`));
  assert.equal(statSync(join(dir, 'data', 'invoices.json')).mode & 0o777, 0o600);
  assert.equal((await h.listInvoices()).invoices[0].status, 'unpaid');

  // Mock payer (seed account #1) pays the invoice → mempool → mined on next sync.
  const z = createZkool({ url: mock.url });
  const txid = await z.pay(1, { recipients: [{ address: inv.uri.slice(6, inv.uri.indexOf('?')), amount: '0.015', memo: inv.memo }] });
  let [i1] = (await h.listInvoices()).invoices;
  assert.equal(i1.status, 'seen');
  assert.equal(i1.txid, txid);
  assert.equal(i1.height, null);
  await h.sync();
  [i1] = (await h.listInvoices()).invoices;
  assert.equal(i1.status, 'paid');
  assert.equal(i1.txid, txid);
  assert.ok(i1.height > fx.tip);
  assert.equal(loadInvoices(join(dir, 'data'))[0].status, 'paid', 'persisted');

  const p = await h.pack({ fy: '2026-27' });
  assert.match(p.dir, /hisaab-FY2026-27-\d{8}-\d{4}$/);
  for (const f of ['ledger.csv', 'ledger.json', 'invoices.csv', 'readonly-proof.txt', 'README-for-CA.md', 'MANIFEST.sha256']) assert.ok(existsSync(join(p.dir, f)), f);
  const receipts = readdirSync(join(p.dir, 'receipts'));
  assert.ok(receipts.includes(`${txid}.json`));
  // Manifest: sha256sum-compatible and correct for every file except itself.
  const manifest = readFileSync(join(p.dir, 'MANIFEST.sha256'), 'utf8');
  const lines = manifest.trim().split('\n');
  assert.equal(lines.length, p.files.length - 1);
  for (const line of lines) {
    const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
    assert.ok(m, line);
    assert.equal(createHash('sha256').update(readFileSync(join(p.dir, m[2]))).digest('hex'), m[1], m[2]);
  }
  assert.ok(!manifest.includes('MANIFEST.sha256'));
  assert.equal(p.manifestSha256, createHash('sha256').update(manifest).digest('hex'));
  const proof = readFileSync(join(p.dir, 'readonly-proof.txt'), 'utf8');
  assert.match(proof, /Exact error text: No Signing Key/);
  assert.match(proof, /MOCK/);
  assert.equal(p.readonlyProof.result, 'refused');
  const csv = readFileSync(join(p.dir, 'ledger.csv'), 'utf8');
  assert.ok(csv.includes(inv.code), 'invoice code in ledger');
  const readme = readFileSync(join(p.dir, 'README-for-CA.md'), 'utf8');
  assert.match(readme, /can spend/);
  assert.match(readme, /Network: TESTNET/);
  assert.match(readme, /Key kind: full/);
  assert.match(readme, /narrowest key: the incoming viewing key/);
  const lj = JSON.parse(readFileSync(join(p.dir, 'ledger.json'), 'utf8'));
  assert.equal(lj.network, 'zcash-testnet');
  assert.equal(lj.key_kind, 'full');
  assert.equal(statSync(join(p.dir, 'ledger.csv')).mode & 0o777, 0o600);

  // Verify a receipt from the pack against the watch-only account.
  const receipt = JSON.parse(readFileSync(join(p.dir, 'receipts', `${txid}.json`), 'utf8'));
  assert.equal(receipt.invoice_code, inv.code);
  const good = await verifyReceipt(receipt, z, c.accountId);
  assert.equal(good.ok, true, JSON.stringify(good));
  // Tampered amount, hash recomputed by the forger: hash OK, wallet mismatch.
  const { receiptHash } = await import('../src/receipt.js');
  const forged = { ...receipt, amount_zats: 99_000_000, amount_zec: '0.99' };
  forged.sha256 = receiptHash(forged);
  const bad = await verifyReceipt(forged, z, c.accountId);
  assert.equal(bad.ok, false);
  assert.equal(bad.hashOk, true);
  assert.deepEqual(bad.fields.filter((f) => !f.match).map((f) => f.field), ['amount_zats']);
  // Edited without recomputing the hash.
  const edited = await verifyReceipt({ ...receipt, memo: 'changed' }, z, c.accountId);
  assert.equal(edited.hashOk, false);
  assert.equal(edited.ok, false);
  // Unknown txid.
  const missing = await verifyReceipt({ ...receipt, txid: 'ee'.repeat(32) }, z, c.accountId);
  assert.equal(missing.found, false);
});

test('read-only proof refuses to run on an account that has a seed', async () => {
  const { readonlyProof } = await import('../src/pack.js');
  const z = createZkool({ url: mock.url });
  const before = mock.state.calls.filter((c) => c === 'pay').length;
  const r = await readonlyProof(z, 1);
  assert.equal(r.attempted, false);
  assert.equal(r.result, 'skipped');
  assert.equal(mock.state.calls.filter((c) => c === 'pay').length, before, 'pay never called on a seed account');
});

/** raw HTTP helper so we can set Origin / Host freely */
function http(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data, json: () => JSON.parse(data) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.end(typeof body === 'string' ? body : JSON.stringify(body));
    else req.end();
  });
}

test('server: 127.0.0.1 only, same-origin POSTs only, refuses seeds', async () => {
  const s = await startServer(h, { port: 0 });
  try {
    const addr = s.server.address();
    assert.equal(addr.address, '127.0.0.1');
    await assert.rejects(startServer(h, { port: 0, host: '0.0.0.0' }), /127\.0\.0\.1/);
    const port = s.port;
    const json = { 'content-type': 'application/json' };

    const page = await http(port);
    assert.equal(page.status, 200);
    assert.match(page.body, /<h1>Hisaab <small>— private books for shielded ZEC<\/small><\/h1>/);
    assert.match(page.headers['content-security-policy'], /default-src 'none'/);

    const st = (await http(port, { path: '/api/status' })).json();
    assert.equal(st.mode, 'MOCK');
    assert.equal(st.network, 'test');
    assert.equal(st.networkLabel, 'TESTNET');
    assert.equal(st.account.keyKind, 'full');
    const mixed = await http(port, { method: 'POST', path: '/api/connect', headers: json, body: { key: fx.mainnetExamples.uivk, birth: 1 } });
    assert.equal(mixed.status, 400);
    assert.match(mixed.json().error, /never mixed/);
    assert.equal(st.connected, true);

    const cross = await http(port, { method: 'POST', path: '/api/sync', headers: { ...json, origin: 'https://evil.example' } });
    assert.equal(cross.status, 403);
    const crossSite = await http(port, { method: 'POST', path: '/api/sync', headers: { ...json, origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'cross-site' } });
    assert.equal(crossSite.status, 403);
    const rebinding = await http(port, { path: '/api/status', headers: { host: 'evil.example:4040' } });
    assert.equal(rebinding.status, 421);
    const form = await http(port, { method: 'POST', path: '/api/invoices', headers: { 'content-type': 'text/plain' }, body: '{}' });
    assert.equal(form.status, 415);

    const same = await http(port, { method: 'POST', path: '/api/sync', headers: { ...json, origin: `http://127.0.0.1:${port}` } });
    assert.equal(same.status, 200);

    const seed = await http(port, { method: 'POST', path: '/api/connect', headers: json, body: { ufvk: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', birth: 1 } });
    assert.equal(seed.status, 400);
    assert.match(seed.json().error, /seed/);
    assert.ok(!seed.body.includes('abandon'), 'input never echoed');
    const mainnet = await http(port, { method: 'POST', path: '/api/connect', headers: json, body: { ufvk: 'uview1' + 'q'.repeat(200), birth: 1 } });
    assert.equal(mainnet.status, 400);
    const spend = await http(port, { method: 'POST', path: '/api/connect', headers: json, body: { ufvk: 'secret-extended-key-test1' + 'q'.repeat(200), birth: 1 } });
    assert.equal(spend.status, 400);

    const inv = await http(port, { method: 'POST', path: '/api/invoices', headers: json, body: { amount: '0.01', description: 'Poster' } });
    assert.equal(inv.status, 200);
    assert.match(inv.json().uri, /^zcash:utest1/);
    const badAmt = await http(port, { method: 'POST', path: '/api/invoices', headers: json, body: { amount: '0.000000001', description: 'x' } });
    assert.equal(badAmt.status, 400);

    const ledger = (await http(port, { path: '/api/ledger?fy=2026-27' })).json();
    assert.equal(ledger.fy, '2026-27');
    assert.ok(ledger.rows.length > 0);

    const pk = await http(port, { method: 'POST', path: '/api/pack?fy=2026-27', headers: json });
    assert.equal(pk.status, 200);
    assert.ok(pk.json().files.includes('MANIFEST.sha256'));
    assert.match(pk.json().manifestSha256, /^[0-9a-f]{64}$/);

    const dl = await http(port, { path: '/api/pack/download?fy=2026-27' });
    assert.equal(dl.status, 200);
    assert.match(dl.headers['content-type'], /text\/csv/);
    assert.match(dl.headers['content-disposition'], /hisaab-ledger-FY2026-27\.csv/);
    assert.ok(dl.body.startsWith('date_ist,'));

    assert.equal((await http(port, { path: '/nope' })).status, 404);
  } finally {
    await s.close();
  }
});

test('UIVK (incoming-only) account: no spends, graceful totals, labelled everywhere', async () => {
  const d = mkdtempSync(join(tmpdir(), 'hisaab-uivk-'));
  const hi = createHisaab({ zkoolUrl: mock.url, accountName: 'hisaab-incoming', confirmations: 1, dataDir: join(d, 'data'), outDir: join(d, 'out') });
  // Same name as the existing FULL-key account → refused, never silently reused.
  await assert.rejects(hi.connect({ key: fx.watch.exampleUivk, birth: 3600000, name: 'hisaab-watch' }), (e) => e.status === 409 && /full key/.test(e.message));
  const c = await hi.connect({ key: fx.watch.exampleUivk, birth: 3600000 });
  assert.equal(c.keyKind, 'incoming-only');
  assert.equal(c.created, true);
  const again = await hi.connect({ ufvk: fx.watch.exampleUivk, birth: 3600000 });
  assert.equal(again.accountId, c.accountId, 'dedupe works for UIVK too');
  const st = await hi.status();
  assert.equal(st.account.keyKind, 'incoming-only');
  const l = await hi.ledger('2026-27');
  assert.equal(l.keyKind, 'incoming-only');
  assert.ok(l.rows.length > 0);
  assert.ok(l.rows.every((r) => r.kind === 'in'), 'no outgoing rows with a UIVK');
  assert.equal(l.totals.note, 'incoming-only key: spends not visible');
  assert.equal(l.totals.spendsVisible, false);
  assert.equal(l.totals.sentZats, 0);
  assert.equal(l.totals.received, '0.071');
  const p = await hi.pack({ fy: '2026-27' });
  const lj = JSON.parse(readFileSync(join(p.dir, 'ledger.json'), 'utf8'));
  assert.equal(lj.key_kind, 'incoming-only');
  assert.equal(lj.spends_visible, false);
  assert.equal(lj.note, 'incoming-only key: spends not visible');
  const readme = readFileSync(join(p.dir, 'README-for-CA.md'), 'utf8');
  assert.match(readme, /Key kind: incoming-only/);
  assert.match(readme, /spends not visible/);
  assert.match(readme, /uivktest1…/);
  const receipt = JSON.parse(readFileSync(join(p.dir, 'receipts', readdirSync(join(p.dir, 'receipts'))[0]), 'utf8'));
  assert.equal(receipt.viewing_key_kind, 'incoming-only');
  assert.equal(receipt.network, 'zcash-testnet');
  assert.equal(p.readonlyProof.result, 'refused');
  const csv = (await hi.ledgerCsvText({ fy: '2026-27' })).csv;
  assert.ok(!csv.includes(',sent,'));
});

test('mainnet pack (stub zkool): labelled MAINNET, mainnet explorer, pay never called', async () => {
  const { buildPack } = await import('../src/pack.js');
  const { buildRows } = await import('../src/ledger.js');
  let payCalls = 0;
  const stub = { url: 'http://127.0.0.1:9/graphql', network: 'main', hasSeed: async () => false, address: async () => ({ ua: fx.mainnetExamples.address }), pay: async () => { payCalls++; return 'x'; } };
  const d = mkdtempSync(join(tmpdir(), 'hisaab-main-'));
  const rows = buildRows(fx.watchTransactions, { tip: 3700200, network: 'main' });
  const p = await buildPack({ zkool: stub, accountId: 7, accountName: 'main-watch', fy: '2026-27', outDir: d, rows, threshold: 1, invoices: [], mode: 'MOCK', network: 'main', keyKind: 'incoming-only' });
  assert.equal(payCalls, 0, 'pay never called on mainnet');
  assert.equal(p.readonlyProof.result, 'skipped-mainnet');
  assert.match(p.dir, /hisaab-MAINNET-FY2026-27-/);
  const lj = JSON.parse(readFileSync(join(p.dir, 'ledger.json'), 'utf8'));
  assert.equal(lj.network, 'zcash-mainnet');
  assert.equal(lj.network_label, 'MAINNET');
  assert.ok(lj.rows.every((r) => r.explorer.startsWith('https://zexplorer.app/tx/')));
  const readme = readFileSync(join(p.dir, 'README-for-CA.md'), 'utf8');
  assert.match(readme, /Network: MAINNET/);
  assert.match(readme, /uivk1…/);
  assert.ok(!readme.includes('uivktest'));
  assert.match(readFileSync(join(p.dir, 'readonly-proof.txt'), 'utf8'), /Network: MAINNET[\s\S]*never calls pay on mainnet/);
  const r = JSON.parse(readFileSync(join(p.dir, 'receipts', readdirSync(join(p.dir, 'receipts'))[0]), 'utf8'));
  assert.equal(r.network, 'zcash-mainnet');
  assert.ok(r.explorer.startsWith('https://zexplorer.app/tx/'));
});

test('service refuses to mix networks: data dir of one network, HISAAB_NETWORK of the other', async () => {
  const hm = createHisaab({ zkoolUrl: mock.url, accountName: 'hisaab-watch', confirmations: 1, dataDir: join(dir, 'data'), outDir: join(dir, 'out'), network: 'main' });
  await assert.rejects(hm.ledger('2026-27'), (e) => e.status === 409 && /never mixed/.test(e.message));
  await assert.rejects(hm.connect({ key: fx.watch.exampleUivk, birth: 1 }), /never mixed/);
  assert.equal((await hm.status()).networkLabel, 'MAINNET');
  assert.throws(() => createHisaab({ zkoolUrl: mock.url, accountName: 'x', confirmations: 1, dataDir: dir, outDir: dir, network: 'mian' }), /HISAAB_NETWORK/);
});
