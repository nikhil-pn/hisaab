// Pure-function tests (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zecToZats, zatsToZec } from '../src/amount.js';
import { fyBounds, fyOf, inFy, filterFy, buildRows, totals, csvCell, toCsv, ledgerCsv, parseZkoolTime, formatIst, paymentState, coingeckoDate, fetchInrRate, INR_HEADER } from '../src/ledger.js';
import { newCode, memoText, truncateUtf8, base64url, fromBase64url, validateAddress, zip321Uri, createInvoice, matchInvoices, CODE_RE } from '../src/invoices.js';
import { buildReceipt, receiptHash, canonicalJson } from '../src/receipt.js';
import { validateUfvk, validateViewingKey } from '../src/service.js';
import { EXPLORER_TX, explorerTx, parseNetwork } from '../src/network.js';
import { createZkool } from '../src/zkool.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fx = JSON.parse(readFileSync(new URL('./fixtures/mock-zkool-fixture.json', import.meta.url), 'utf8'));
const ADDR = fx.watch.address;

test('zat conversion: decimal ZEC strings ↔ integer zatoshis', () => {
  assert.equal(zecToZats('0.01000000'), 1_000_000);
  assert.equal(zecToZats('-0.00010000'), -10_000);
  assert.equal(zecToZats('1'), 100_000_000);
  assert.equal(zecToZats('.5'), 50_000_000);
  assert.equal(zecToZats('0.1'), 10_000_000);
  assert.equal(zecToZats(0.1 + 0.2), 30_000_000); // float noise does not leak in
  assert.equal(zecToZats('21000000'), 2_100_000_000_000_000);
  assert.equal(zecToZats('0.0100000000'), 1_000_000);
  assert.throws(() => zecToZats('0.000000001'));
  assert.throws(() => zecToZats('abc'));
  assert.throws(() => zecToZats(''));
  assert.throws(() => zecToZats('1e-3'));
  assert.equal(zatsToZec(1_000_000), '0.01');
  assert.equal(zatsToZec(-10_000), '-0.0001');
  assert.equal(zatsToZec(100_000_000), '1');
  assert.equal(zatsToZec(1), '0.00000001');
  assert.equal(zatsToZec(1_000_000, { fixed: true }), '0.01000000');
  assert.equal(zatsToZec(0), '0');
});

test('Indian FY boundaries are in IST', () => {
  const { start, end } = fyBounds('2026-27');
  assert.equal(start.toISOString(), '2026-03-31T18:30:00.000Z'); // 2026-04-01 00:00 IST
  assert.equal(end.toISOString(), '2027-03-31T18:29:59.999Z'); // 2027-03-31 23:59:59.999 IST
  assert.equal(fyOf(new Date('2026-03-31T18:29:59Z')), '2025-26');
  assert.equal(fyOf(new Date('2026-03-31T18:30:00Z')), '2026-27');
  assert.equal(fyOf(new Date('2027-03-31T18:29:59Z')), '2026-27');
  assert.equal(fyOf(new Date('2027-03-31T18:30:00Z')), '2027-28');
  assert.ok(inFy(new Date('2026-03-31T18:30:00Z'), '2026-27'));
  assert.ok(!inFy(new Date('2026-03-31T18:29:59Z'), '2026-27'));
  assert.ok(!inFy(null, '2026-27'));
  assert.throws(() => fyBounds('2026-28'));
  assert.throws(() => fyBounds('2026'));
  assert.equal(fyBounds('2099-00').fy, '2099-00');
  assert.equal(formatIst(new Date('2026-03-31T18:30:00Z')), '2026-04-01 00:00:00 IST');
});

test('zkool time parsing (NaiveDateTime, UTC, any of the plausible encodings)', () => {
  const want = '2026-10-20T10:00:00.000Z';
  assert.equal(parseZkoolTime('2026-10-20T10:00:00').toISOString(), want);
  assert.equal(parseZkoolTime('2026-10-20 10:00:00').toISOString(), want);
  assert.equal(parseZkoolTime('2026-10-20T10:00:00Z').toISOString(), want);
  assert.equal(parseZkoolTime(Date.parse(want) / 1000).toISOString(), want);
  assert.equal(parseZkoolTime(String(Date.parse(want) / 1000)).toISOString(), want);
  assert.equal(parseZkoolTime(null), null);
  assert.equal(parseZkoolTime('garbage'), null);
});

test('ledger rows: scope-0 notes in, change skipped, outgoing net + fee, mempool seen', () => {
  const rows = buildRows(fx.watchTransactions, { tip: 3700200, threshold: 1, unconfirmed: fx.watchUnconfirmed });
  const ins = rows.filter((r) => r.kind === 'in');
  const out = rows.filter((r) => r.kind === 'out');
  assert.equal(out.length, 1);
  assert.equal(out[0].amountZats, -2_010_000);
  assert.equal(out[0].feeZats, 10_000);
  assert.ok(!rows.some((r) => r.amountZats === 990_000), 'change note (scope 1) must not appear');
  assert.equal(ins.filter((r) => r.status === 'seen').length, 1);
  const logo = ins.find((r) => r.memo.includes('HSB-7K2M9Q'));
  assert.equal(logo.pool, 'ironwood');
  assert.equal(logo.explorer, `https://testnet.zcashexplorer.app/transactions/${logo.txid}`);
  assert.equal(logo.timeIst, '2026-10-20 15:30:00 IST');
  assert.equal(logo.confirmations, 101);
  const t = totals(filterFy(rows, '2026-27'));
  assert.equal(t.receivedZats, 700_000 + 1_000_000 + 400_000 + 5_000_000);
  assert.equal(t.sentZats, 2_000_000);
  assert.equal(t.feesZats, 10_000);
  assert.equal(t.countIn, 4); // the overpaid payment arrived as 2 notes in 1 tx
  assert.equal(t.countOut, 1);
  assert.equal(filterFy(rows, '2025-26').length, 1);
  // mempool rows have no block time → never in an FY
  assert.ok(!filterFy(rows, '2026-27').some((r) => r.status === 'seen'));
});

test('self-send: scope-0 note inside our own spend is not income', () => {
  const tx = { id: 9, txid: 'ab'.repeat(32), height: 10, time: '2026-05-01T00:00:00', value: '-0.00010000', fee: '0.00010000', notes: [{ pool: 3, value: '0.01000000', address: ADDR, scope: 0, memo: 'HSB-7K2M9Q' }] };
  const rows = buildRows([tx], { tip: 10 });
  assert.deepEqual(rows.map((r) => r.kind), ['out', 'self']);
  const t = totals(rows);
  assert.equal(t.receivedZats, 0);
  assert.equal(t.sentZats, 0);
  assert.equal(t.feesZats, 10_000);
  assert.equal(matchInvoices([createInvoice({ amount: '0.01', description: 'x', address: ADDR, code: 'HSB-7K2M9Q', now: new Date(0) })], rows)[0].status, 'unpaid');
});

test('payment state: seen → mined → confirmed by threshold', () => {
  assert.deepEqual(paymentState(0, 100, 1), { status: 'seen', confirmations: 0 });
  assert.deepEqual(paymentState(100, 100, 1), { status: 'confirmed', confirmations: 1 });
  assert.deepEqual(paymentState(100, 100, 3), { status: 'mined', confirmations: 1 });
  assert.deepEqual(paymentState(100, 102, 3), { status: 'confirmed', confirmations: 3 });
});

test('CSV: RFC 4180 escaping and formula-injection guard', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('+91'), "'+91");
  assert.equal(csvCell('-2'), "'-2");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(42), '42');
  assert.equal(toCsv([['a', 'b'], ['1', '2']]), 'a,b\r\n1,2\r\n');
  const csv = ledgerCsv(buildRows(fx.watchTransactions, { tip: 3700200 }));
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"")`), 'memo formula neutralised');
  assert.ok(!/,-\d/.test(csv), 'no negative numbers in amount columns');
  assert.equal(csv.split('\r\n')[0].split(',')[0], 'date_ist');
  const withInr = ledgerCsv(buildRows(fx.watchTransactions.slice(2, 3), { tip: 3700200 }), { inr: { [fx.watchTransactions[2].txid]: 5000 } });
  assert.ok(withInr.includes('testnet TAZ has no value'));
  assert.ok(withInr.split('\r\n')[1].endsWith(',5000,50.00'));
});

test('INR reference: CoinGecko date format, cache, blank on failure', async () => {
  assert.equal(coingeckoDate(new Date('2026-10-20T10:00:00Z')), '20-10-2026');
  assert.ok(INR_HEADER.includes('mainnet'));
  const dir = mkdtempSync(join(tmpdir(), 'hisaab-inr-'));
  let calls = 0;
  const okFetch = async (url) => {
    calls++;
    assert.ok(String(url).includes('date=20-10-2026&localization=false'));
    return new Response(JSON.stringify({ market_data: { current_price: { inr: 4321.5 } } }), { status: 200 });
  };
  assert.equal(await fetchInrRate(new Date('2026-10-20T10:00:00Z'), { dataDir: dir, fetchImpl: okFetch }), 4321.5);
  assert.equal(await fetchInrRate(new Date('2026-10-20T23:00:00Z'), { dataDir: dir, fetchImpl: okFetch }), 4321.5);
  assert.equal(calls, 1, 'second call served from cache');
  const failing = async () => { throw new Error('offline'); };
  assert.equal(await fetchInrRate(new Date('2026-01-01T00:00:00Z'), { dataDir: dir, fetchImpl: failing }), null);
  const http429 = async () => new Response('{}', { status: 429 });
  assert.equal(await fetchInrRate(new Date('2026-01-02T00:00:00Z'), { dataDir: dir, fetchImpl: http429 }), null);
});

test('invoice codes: HSB- + 6 Crockford base32 chars, random', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const c = newCode();
    assert.match(c, /^HSB-[0-9A-HJKMNP-TV-Z]{6}$/);
    assert.match(c, CODE_RE);
    seen.add(c);
  }
  assert.ok(seen.size > 195);
});

test('memo ≤ 512 UTF-8 bytes, never splits a character', () => {
  const long = 'नमस्ते 🙏 '.repeat(100);
  const m = memoText('HSB-ABCDEF', long);
  assert.ok(Buffer.byteLength(m, 'utf8') <= 512);
  assert.ok(m.startsWith('HSB-ABCDEF | '));
  assert.ok(!m.includes('�'));
  assert.equal(Buffer.from(m, 'utf8').toString('utf8'), m);
  assert.equal(truncateUtf8('🙏🙏', 5), '🙏'); // 4-byte emoji, 5-byte budget
  assert.equal(memoText('HSB-ABCDEF', 'two\nlines\tand\u0000nul'), 'HSB-ABCDEF | two lines and nul');
});

test('base64url without padding (ZIP 321 memo)', () => {
  assert.equal(base64url('HSB-ABCDEF | Logo'), 'SFNCLUFCQ0RFRiB8IExvZ28');
  assert.equal(base64url(Buffer.from([0xfb, 0xff])), '-_8');
  assert.ok(!base64url('a').includes('='));
  assert.equal(fromBase64url(base64url('नमस्ते | ü')), 'नमस्ते | ü');
});

test('address validation: testnet shielded only', () => {
  assert.equal(validateAddress(ADDR).ok, true);
  assert.equal(validateAddress(fx.watch.sapling).ok, true);
  for (const bad of ['u1' + 'q'.repeat(200), 'zs1' + 'q'.repeat(70), 't1abc', 't3abc', 'tmXyz', 'textest1qqq', fx.watch.exampleUfvk, '', ADDR.toUpperCase(), 'utest1short', 'utest1' + 'b'.repeat(120)]) {
    assert.equal(validateAddress(bad).ok, false, bad.slice(0, 12));
  }
  assert.match(validateAddress('u1' + 'q'.repeat(200)).reason, /mainnet/);
  assert.match(validateAddress('tmXyz').reason, /transparent/);
});

test('ZIP 321 URI', () => {
  const uri = zip321Uri({ address: ADDR, amountZats: 1_000_000, memo: 'HSB-ABCDEF | Logo design', message: 'HSB-ABCDEF Logo design & more' });
  assert.ok(uri.startsWith(`zcash:${ADDR}?amount=0.01&memo=`));
  const u = new URL(uri);
  assert.equal(u.searchParams.get('amount'), '0.01');
  assert.equal(fromBase64url(u.searchParams.get('memo')), 'HSB-ABCDEF | Logo design');
  assert.equal(u.searchParams.get('message'), 'HSB-ABCDEF Logo design & more');
  assert.ok(!u.searchParams.get('memo').includes('='));
  assert.throws(() => zip321Uri({ address: 'u1' + 'q'.repeat(200), amountZats: 1 }), /mainnet/);
  assert.throws(() => zip321Uri({ address: ADDR, amountZats: 0 }));
  assert.throws(() => createInvoice({ amount: '0', description: 'x', address: ADDR }));
  assert.throws(() => createInvoice({ amount: '0.01', description: '  ', address: ADDR }));
});

const rowsAll = () => buildRows(fx.watchTransactions, { tip: 3700200, threshold: 1, unconfirmed: fx.watchUnconfirmed });
const inv = (code, amount, t = 0) => createInvoice({ amount, description: code, address: ADDR, code, now: new Date(Date.UTC(2026, 9, 1) + t) });

test('invoice matching: paid / seen / underpaid / overpaid / unpaid', () => {
  const list = [inv('HSB-7K2M9Q', '0.01', 1), inv('HSB-W3BS1T', '0.01', 2), inv('HSB-0VERPD', '0.03', 3), inv('HSB-SEEN01', '0.02', 4), inv('HSB-NNNNNN', '1', 5)];
  const m = matchInvoices(list, rowsAll());
  const by = Object.fromEntries(m.map((i) => [i.code, i]));
  assert.equal(by['HSB-7K2M9Q'].status, 'paid');
  assert.equal(by['HSB-7K2M9Q'].height, 3700100);
  assert.equal(by['HSB-W3BS1T'].status, 'underpaid');
  assert.equal(by['HSB-W3BS1T'].receivedZats, 400_000);
  assert.equal(by['HSB-0VERPD'].status, 'overpaid');
  assert.equal(by['HSB-0VERPD'].receivedZats, 5_000_000, 'two notes of one tx are summed');
  assert.equal(by['HSB-SEEN01'].status, 'seen');
  assert.equal(by['HSB-SEEN01'].paymentState, 'seen');
  assert.equal(by['HSB-NNNNNN'].status, 'unpaid');
  assert.equal(list[0].status, 'unpaid', 'input not mutated');
});

test('invoice matching: confirmation threshold keeps exact payment at "seen" until confirmed', () => {
  const rows = buildRows(fx.watchTransactions, { tip: 3700100, threshold: 3 });
  const [i] = matchInvoices([inv('HSB-7K2M9Q', '0.01')], rows);
  assert.equal(i.status, 'seen');
  assert.equal(i.paymentState, 'mined');
  const [j] = matchInvoices([i], buildRows(fx.watchTransactions, { tip: 3700102, threshold: 3 }));
  assert.equal(j.status, 'paid');
  assert.equal(j.txid, i.txid);
});

test('invoice matching: one txid satisfies one invoice; idempotent', () => {
  // Two invoices with the same code (should never happen, but must not double-count).
  const a = inv('HSB-7K2M9Q', '0.01', 1);
  const b = { ...inv('HSB-7K2M9Q', '0.01', 2) };
  const rows = rowsAll();
  const m1 = matchInvoices([b, a], rows);
  const paid = m1.filter((i) => i.txid);
  assert.equal(paid.length, 1);
  assert.equal(paid[0].createdAt, a.createdAt, 'oldest invoice wins');
  // A memo naming two codes pays only the older invoice.
  const two = { id: 50, txid: 'cd'.repeat(32), height: 3700180, time: '2026-10-30T00:00:00', value: '0.01000000', fee: '0', notes: [{ pool: 3, value: '0.01000000', address: ADDR, scope: 0, memo: 'HSB-AAAAAA HSB-BBBBBB' }] };
  const m2 = matchInvoices([inv('HSB-BBBBBB', '0.01', 2), inv('HSB-AAAAAA', '0.01', 1)], buildRows([two], { tip: 3700200 }));
  assert.deepEqual(m2.map((i) => i.status), ['unpaid', 'paid']);
  // Idempotent: re-running on its own output changes nothing.
  const m3 = matchInvoices(m1, rows);
  assert.deepEqual(m3.map(({ matchedAt, ...x }) => x), m1.map(({ matchedAt, ...x }) => x));
  assert.deepEqual(m3.map((i) => i.matchedAt), m1.map((i) => i.matchedAt));
  // Mempool → mined keeps the same txid.
  const seen = matchInvoices([inv('HSB-SEEN01', '0.02')], rows)[0];
  const minedTx = { id: 77, txid: fx.watchUnconfirmed[0].txid, height: 3700201, time: '2026-11-04T10:00:00', value: '0.02000000', fee: '0', notes: [{ pool: 3, value: '0.02000000', address: ADDR, scope: 0, memo: 'HSB-SEEN01 | Mempool payment' }] };
  const after = matchInvoices([seen], buildRows([minedTx], { tip: 3700201, unconfirmed: fx.watchUnconfirmed }))[0];
  assert.equal(after.status, 'paid');
  assert.equal(after.txid, seen.txid);
  assert.equal(after.height, 3700201);
});

test('receipt hash is stable and detects edits', () => {
  const rows = rowsAll();
  const txid = fx.watchTransactions[2].txid;
  const at = new Date('2026-11-04T15:00:00Z');
  const r1 = buildReceipt(rows, txid, { generatedAt: at, accountName: 'w' });
  const r2 = buildReceipt(rows, txid, { generatedAt: at, accountName: 'w' });
  assert.equal(r1.sha256, r2.sha256);
  assert.match(r1.sha256, /^[0-9a-f]{64}$/);
  assert.equal(r1.invoice_code, 'HSB-7K2M9Q');
  assert.equal(r1.amount_zec, '0.01');
  // key order does not matter
  const shuffled = Object.fromEntries(Object.entries(r1).reverse());
  assert.equal(receiptHash(shuffled), r1.sha256);
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
  assert.notEqual(receiptHash({ ...r1, amount_zec: '1' }), r1.sha256);
  assert.throws(() => buildReceipt(rows, 'ff'.repeat(32)));
});

test('viewing-key prefix matrix: UFVK + UIVK per network, never seeds/spending keys/other network', () => {
  const M = fx.mainnetExamples;
  // accepted
  assert.deepEqual(validateViewingKey(` ${fx.watch.exampleUfvk} `), { key: fx.watch.exampleUfvk, kind: 'full', network: 'test' });
  assert.deepEqual(validateViewingKey(fx.watch.exampleUivk, 'test'), { key: fx.watch.exampleUivk, kind: 'incoming-only', network: 'test' });
  assert.equal(validateViewingKey(M.ufvk, 'main').kind, 'full');
  assert.equal(validateViewingKey(M.uivk, 'main').kind, 'incoming-only');
  assert.equal(validateUfvk(fx.watch.exampleUfvk), fx.watch.exampleUfvk);
  // other network → refused, never mixed
  for (const [k, net] of [[M.ufvk, 'test'], [M.uivk, 'test'], [fx.watch.exampleUfvk, 'main'], [fx.watch.exampleUivk, 'main']]) {
    assert.throws(() => validateViewingKey(k, net), (e) => e.status === 400 && /never mixed/.test(e.message), `${k.slice(0, 10)} on ${net}`);
  }
  // seeds, spending keys, junk → refused on both networks, input never echoed
  const bad = ['abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    'secret-extended-key-test1' + 'q'.repeat(200), 'secret-extended-key-main1' + 'q'.repeat(200), 'usktest1' + 'q'.repeat(200), 'usk1' + 'q'.repeat(200),
    'zxviewtestsapling1qqq', 'uviewtest1short', 'uivktest1short', 'utest1' + 'q'.repeat(200), '', null, 42];
  for (const net of ['test', 'main']) {
    for (const k of bad) assert.throws(() => validateViewingKey(k, net), (e) => e.status === 400 && !String(e.message).includes('abandon'), `${String(k).slice(0, 12)} on ${net}`);
  }
  assert.throws(() => validateViewingKey('usktest1' + 'q'.repeat(200)), /SPENDING key/);
  assert.throws(() => validateViewingKey(bad[0]), /seed phrase/);
});

test('address prefix matrix per network (invoices)', () => {
  const M = fx.mainnetExamples;
  const cases = [
    [ADDR, 'test', true], [fx.watch.sapling, 'test', true], [M.address, 'test', false], [M.sapling, 'test', false],
    [M.address, 'main', true], [M.sapling, 'main', true], [ADDR, 'main', false], [fx.watch.sapling, 'main', false],
    ['t1' + 'a'.repeat(33), 'main', false], ['t3' + 'a'.repeat(33), 'main', false], ['tm' + 'a'.repeat(33), 'test', false], ['tex1' + 'q'.repeat(40), 'main', false],
    [M.uivk, 'main', false], [fx.watch.exampleUivk, 'test', false],
  ];
  for (const [a, net, ok] of cases) assert.equal(validateAddress(a, net).ok, ok, `${a.slice(0, 14)} on ${net}`);
  assert.match(validateAddress(ADDR, 'main').reason, /testnet address rejected/);
  assert.match(validateAddress('t1' + 'a'.repeat(33), 'main').reason, /transparent/);
  assert.ok(zip321Uri({ address: M.address, amountZats: 1, network: 'main' }).startsWith(`zcash:${M.address}?amount=0.00000001`));
  assert.throws(() => zip321Uri({ address: M.address, amountZats: 1 }), /mainnet address rejected/);
  assert.equal(createInvoice({ amount: '0.01', description: 'x', address: M.address, network: 'main' }).network, 'main');
});

test('explorer templates per network, network table', () => {
  assert.equal(EXPLORER_TX.test, 'https://testnet.zcashexplorer.app/transactions/{txid}');
  assert.equal(EXPLORER_TX.main, 'https://zexplorer.app/tx/{txid}');
  assert.equal(explorerTx('ab', 'test'), 'https://testnet.zcashexplorer.app/transactions/ab');
  assert.equal(explorerTx('ab', 'main'), 'https://zexplorer.app/tx/ab');
  const rows = buildRows(fx.watchTransactions.slice(2, 3), { tip: 3700200, network: 'main' });
  assert.equal(rows[0].explorer, `https://zexplorer.app/tx/${fx.watchTransactions[2].txid}`);
  assert.equal(parseNetwork(undefined), 'test');
  assert.equal(parseNetwork('mainnet'), 'main');
  assert.throws(() => parseNetwork('mian'));
  const r = buildReceipt(rows, fx.watchTransactions[2].txid, { network: 'main', keyKind: 'incoming-only', generatedAt: new Date(0) });
  assert.equal(r.network, 'zcash-mainnet');
  assert.equal(r.network_label, 'MAINNET');
  assert.equal(r.viewing_key_kind, 'incoming-only');
  assert.equal(r.explorer, `https://zexplorer.app/tx/${r.txid}`);
  assert.ok(ledgerCsv(rows, { inr: {}, network: 'main' }).split('\r\n')[0].includes('CoinGecko reference'));
  assert.ok(!ledgerCsv(rows, { inr: {}, network: 'main' }).includes('TAZ'));
});

test('mainnet zkool client refuses pay locally (never reaches the server)', async () => {
  let calls = 0;
  const spy = async () => { calls++; return new Response('{"data":{"pay":"x"}}'); };
  const z = createZkool({ url: 'http://127.0.0.1:9/graphql', fetchImpl: spy, network: 'main' });
  await assert.rejects(z.pay(1, { recipients: [{ address: 'u1x', amount: '0.01' }] }), /never calls pay on mainnet/);
  assert.equal(calls, 0);
});
