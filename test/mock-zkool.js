// MOCK zkool_graphql server for tests and offline UI demos. NOT a wallet.
// It answers the handful of GraphQL fields Hisaab uses, with response shapes
// copied from zkool2/rust/src/graphql (BigDecimal → decimal-ZEC string,
// NaiveDateTime → "YYYY-MM-DDTHH:MM:SS", errors as {errors:[{message}]}).
// It identifies itself with apiVersion "mock-1.0", which Hisaab shows as MOCK.
//
// Run standalone:  node test/mock-zkool.js [port]   (default 8002)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mock-zkool-fixture.json');

const ok = (data) => ({ data });
const fail = (message, path) => ({ data: null, errors: [{ message, locations: [{ line: 1, column: 1 }], path: path ? [path] : undefined }] });

/** decimal string (scale 8) from zats */
const zec8 = (z) => {
  const neg = z < 0; const a = Math.abs(z);
  return `${neg ? '-' : ''}${Math.floor(a / 1e8)}.${String(a % 1e8).padStart(8, '0')}`;
};
const toZats = (s) => Math.round(Number(s) * 1e8);

/** @param {{fixturePath?: string}} [opts] */
export function createMockState(opts = {}) {
  const fx = JSON.parse(readFileSync(opts.fixturePath || FIXTURE, 'utf8'));
  const state = {
    fx,
    tip: fx.tip,
    nextId: 2,
    /** @type {any[]} */
    accounts: [{ id: 1, name: fx.payer.name, seed: 'MOCK SEED (not a real seed phrase)', birth: fx.payer.birth, height: fx.tip, ufvk: fx.payer.ufvk, uivk: null, incomingOnly: false, ua: fx.payer.address, txs: [], unconfirmed: [], pendingMine: [] }],
    calls: /** @type {string[]} */ ([]),
  };
  return state;
}

/** @param {ReturnType<typeof createMockState>} st @param {string} query @param {Record<string, any>} v */
export function resolveMock(st, query, v = {}) {
  const q = query.replace(/\s+/g, ' ');
  const has = (f) => new RegExp(`\\b${f}\\s*[({]|\\b${f}\\b\\s*[}\\s]`).test(q) || q.includes(`${f}(`);
  const acct = (id) => st.accounts.find((a) => a.id === Number(id));
  const pub = (a) => ({ id: a.id, name: a.name, birth: a.birth, height: a.height, balance: zec8(a.txs.reduce((s, t) => s + toZats(t.value), 0)), incomingOnly: !!a.incomingOnly, ...(q.includes('seed') ? { seed: a.seed } : {}) });

  if (has('apiVersion')) { st.calls.push('apiVersion'); return ok({ apiVersion: st.fx.apiVersion }); }
  if (has('currentHeight')) { st.calls.push('currentHeight'); return ok({ currentHeight: st.tip }); }
  if (has('createAccount')) {
    st.calls.push('createAccount');
    const na = v.na || {};
    if (typeof na.name !== 'string' || typeof na.aindex !== 'number' || typeof na.useInternal !== 'boolean') return fail('Invalid NewAccount input', 'createAccount');
    if (na.birth !== undefined && na.birth < 0) return fail('Invalid birth', 'createAccount');
    const key = String(na.key || '');
    const incomingOnly = key.startsWith('uivktest1');
    if (!key.startsWith('uviewtest1') && !incomingOnly) return fail('Unsupported key', 'createAccount');
    const birth = na.birth ?? st.tip;
    const id = st.nextId++;
    // A UIVK sees received notes only: no spends, no change (zkool: incoming_only account).
    const txs = structuredClone(st.fx.watchTransactions).filter((t) => t.height >= birth)
      .filter((t) => !incomingOnly || !t.value.startsWith('-'))
      .map((t) => (incomingOnly ? { ...t, fee: '0.00000000', notes: t.notes.filter((n) => n.scope === 0) } : t));
    st.accounts.push({
      id, name: na.name, seed: null, birth, height: birth, ufvk: incomingOnly ? null : key, uivk: incomingOnly ? key : st.fx.watch.exampleUivk,
      incomingOnly, ua: st.fx.watch.address, txs, unconfirmed: structuredClone(st.fx.watchUnconfirmed), pendingMine: [],
    });
    return ok({ createAccount: id });
  }
  if (has('accounts')) {
    st.calls.push('accounts');
    let list = st.accounts;
    if (v.f?.id !== undefined) list = list.filter((a) => a.id === v.f.id);
    if (v.f?.name !== undefined) list = list.filter((a) => a.name === v.f.name);
    return ok({ accounts: list.map(pub) });
  }
  if (has('addressByAccount')) {
    const a = acct(v.id); if (!a) return fail('Unknown account', 'addressByAccount');
    return ok({ addressByAccount: { ua: a.ua, transparent: null, sapling: a.id === 1 ? null : st.fx.watch.sapling, orchard: null, ironwood: null } });
  }
  if (has('unifiedFullViewingKey')) {
    const a = acct(v.id); if (!a) return fail('Unknown account', 'unifiedFullViewingKey');
    if (v.inc) return ok({ unifiedFullViewingKey: a.uivk });
    if (!a.ufvk) return fail('Selected pools are unavailable for this account', 'unifiedFullViewingKey');
    return ok({ unifiedFullViewingKey: a.ufvk });
  }
  if (has('synchronize')) {
    st.calls.push('synchronize');
    st.tip += 1;
    for (const id of v.ids || []) {
      const a = acct(id); if (!a) return fail('Unknown account', 'synchronize');
      for (const p of a.pendingMine.splice(0)) a.txs.push({ ...p, height: st.tip, time: new Date().toISOString().slice(0, 19) });
      a.height = st.tip;
    }
    return ok({ synchronize: st.tip });
  }
  if (has('transactionsByAccount')) {
    const a = acct(v.id); if (!a) return fail('Unknown account', 'transactionsByAccount');
    return ok({ transactionsByAccount: a.txs });
  }
  if (has('transactionById')) {
    const a = acct(v.id); if (!a) return fail('Unknown account', 'transactionById');
    const t = a.txs.find((x) => x.txid === v.txid);
    return t ? ok({ transactionById: t }) : fail('Unknown txid', 'transactionById');
  }
  if (has('unconfirmedByAccount')) {
    const a = acct(v.id); if (!a) return fail('Unknown account', 'unconfirmedByAccount');
    return ok({ unconfirmedByAccount: a.unconfirmed });
  }
  if (has('memosByTransaction')) {
    const a = acct(v.id); if (!a) return fail('Unknown account', 'memosByTransaction');
    const t = a.txs.find((x) => x.id === v.tx);
    return ok({ memosByTransaction: t ? t.notes.map((n) => n.memo).filter(Boolean) : [] });
  }
  if (has('balanceByAccount')) {
    const a = acct(v.id); if (!a) return fail('Unknown account', 'balanceByAccount');
    const total = a.txs.reduce((s, t) => s + toZats(t.value), 0);
    return ok({ balanceByAccount: { height: a.height, transparent: '0.00000000', sapling: '0.00000000', orchard: '0.00000000', ironwood: zec8(total), total: zec8(total) } });
  }
  if (has('pay')) {
    st.calls.push('pay');
    const a = acct(v.id); if (!a) return fail('Unknown account', 'pay');
    if (!a.seed) return fail('No Signing Key', 'pay');
    const r = v.p?.recipients?.[0];
    const target = st.accounts.find((x) => x.ua === r?.address && x.id !== a.id);
    const txid = randomBytes(32).toString('hex');
    if (target) {
      const amount = zec8(toZats(r.amount));
      const note = { pool: 3, value: amount, address: target.ua, scope: 0, memo: r.memo ?? null };
      target.unconfirmed.push({ txid, value: amount, notes: [{ ...note, diversifier: '' }] });
      target.pendingMine.push({ id: target.txs.length + target.pendingMine.length + 100, txid, value: amount, fee: '0.00000000', notes: [note] });
    }
    return ok({ pay: txid });
  }
  return fail(`MOCK: unsupported query: ${q.slice(0, 80)}`);
}

/** @param {{port?: number, fixturePath?: string}} [opts] */
export async function startMockZkool({ port = 0, fixturePath } = {}) {
  const st = createMockState({ fixturePath });
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let out;
      try {
        const { query, variables } = JSON.parse(body || '{}');
        out = resolveMock(st, String(query || ''), variables || {});
      } catch (e) {
        out = fail(`MOCK: bad request: ${e.message}`);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const p = server.address().port;
  return { state: st, port: p, url: `http://127.0.0.1:${p}/graphql`, close: () => new Promise((r) => server.close(r)) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const m = await startMockZkool({ port: Number(process.argv[2] || 8002) });
  console.log(`MOCK zkool_graphql (fixture data, not a wallet) on ${m.url}`);
  console.log(`example watch-only keys for the demo (fake): UIVK ${m.state.fx.watch.exampleUivk}`);
  console.log(`                                           UFVK ${m.state.fx.watch.exampleUfvk}`);
}
