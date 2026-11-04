#!/usr/bin/env node
// Hisaab CLI — private books for shielded ZEC (Zcash testnet).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadEnv, settings } from '../src/env.js';
import { createHisaab } from '../src/service.js';
import { startServer } from '../src/server.js';
import { verifyReceipt } from '../src/receipt.js';
import { formatIst } from '../src/ledger.js';
import { zatsToZec } from '../src/amount.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(join(process.cwd(), '.env'));
if (resolve(process.cwd()) !== resolve(ROOT)) loadEnv(join(ROOT, '.env'));

const USAGE = `hisaab — private books for shielded ZEC (testnet)

  hisaab connect --key uivktest1…|uviewtest1… --birth N [--name NAME]
      (--ufvk is an alias; uivktest = incoming-only, narrowest; uviewtest = full)
  hisaab sync
  hisaab status
  hisaab invoice new --amount 0.01 --for "Logo design"
  hisaab invoice list
  hisaab ledger [--fy 2026-27] [--csv out.csv] [--inr] [--json]
  hisaab pack [--fy 2026-27] [--inr]
  hisaab verify <receipt.json>
  hisaab serve

env: HISAAB_NETWORK (test | main; main is watch-only), ZKOOL_URL (default http://127.0.0.1:8002/graphql), HISAAB_ACCOUNT_NAME,
     HISAAB_CONFIRMATIONS (default 1), HISAAB_PORT (default 4040). A .env file is read.`;

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {string[]} */
  const pos = [];
  /** @type {Record<string, string|boolean>} */
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

/** @param {Record<string, string|boolean>} f @param {string} k */
const str = (f, k) => (typeof f[k] === 'string' ? /** @type {string} */ (f[k]) : undefined);

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const cfg = settings();
  const h = createHisaab(cfg);
  const cmd = pos[0];
  const out = (/** @type {unknown} */ x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));

  switch (cmd) {
    case 'connect': {
      const r = await h.connect({ key: str(flags, 'key') ?? str(flags, 'ufvk') ?? str(flags, 'uivk') ?? '', birth: str(flags, 'birth') ?? '', name: str(flags, 'name') });
      out(`[${r.mode}] [${r.networkLabel}] ${r.created ? 'created' : 'reusing'} watch-only account #${r.accountId} "${r.name}" (birth ${r.birth}, ${r.keyKind} key). Next: hisaab sync`);
      return;
    }
    case 'sync': {
      const r = await h.sync();
      out(`[${r.mode}] synced to height ${r.syncedHeight}; ${r.invoices} invoice(s) re-matched`);
      return;
    }
    case 'status':
      out(await h.status());
      return;
    case 'invoice': {
      if (pos[1] === 'new') {
        const inv = await h.newInvoice({ amount: str(flags, 'amount') ?? '', description: str(flags, 'for') ?? str(flags, 'description') ?? '' });
        out(`[${inv.mode}] invoice ${inv.code} for ${inv.amountZec} TAZ — ${inv.description}\nmemo: ${inv.memo}\npay:  ${inv.uri}`);
        return;
      }
      if (pos[1] === 'list') {
        const { mode, invoices } = await h.listInvoices();
        if (flags.json) return out(invoices);
        out(`[${mode}] ${invoices.length} invoice(s)`);
        for (const i of invoices) {
          const extra = i.txid ? ` ${i.paymentState} h=${i.height ?? '-'} recv=${zatsToZec(i.receivedZats)} ${i.explorer}` : '';
          out(`${i.code}  ${i.amountZec.padStart(10)} TAZ  ${i.status.padEnd(9)} ${i.description}${extra}`);
        }
        return;
      }
      throw new Error('usage: hisaab invoice new --amount 0.01 --for "…" | hisaab invoice list');
    }
    case 'ledger': {
      const fy = str(flags, 'fy');
      const csvPath = str(flags, 'csv');
      if (csvPath) {
        const r = await h.ledgerCsvText({ fy, inr: !!flags.inr });
        writeFileSync(csvPath, r.csv);
        out(`wrote ${csvPath} (FY ${r.fy})`);
        return;
      }
      const l = await h.ledger(fy);
      if (flags.json) return out(l);
      out(`[${l.mode}] [${l.networkLabel}] FY ${l.fy} — account #${l.account.id} "${l.account.name}" (${l.keyKind} key) — tip ${l.tip}, confirm after ${l.threshold}`);
      for (const r of l.rows) {
        out(`${r.timeIst ?? '(mempool)'}  ${r.kind.padEnd(4)} ${r.amountZec.padStart(12)}  ${r.status.padEnd(9)} h=${r.height ?? '-'}  ${r.memo || ''}  ${r.explorer}`);
      }
      for (const r of l.pending) out(`(mempool)            in   ${r.amountZec.padStart(12)}  seen      ${r.memo || ''}  ${r.explorer}`);
      const t = l.totals;
      if (t.note) out(`received ${t.received} (${t.countIn}) · ${t.note}`);
      else out(`received ${t.received} (${t.countIn}) · sent ${t.sent} (${t.countOut}) · fees ${t.fees} · net ${t.net}`);
      return;
    }
    case 'pack': {
      const r = await h.pack({ fy: str(flags, 'fy'), inr: !!flags.inr });
      out(`[${await h.mode()}] CA pack: ${r.dir}`);
      for (const f of r.files) out(`  ${f}`);
      out(`MANIFEST.sha256 sha256: ${r.manifestSha256}`);
      out(`read-only proof: ${r.readonlyProof.result}${r.readonlyProof.error ? ` — "${r.readonlyProof.error}"` : ''}`);
      return;
    }
    case 'verify': {
      if (!pos[1]) throw new Error('usage: hisaab verify <receipt.json>');
      const receipt = JSON.parse(readFileSync(pos[1], 'utf8'));
      const c = h.loadConfig();
      if (!c) throw new Error('No watch-only account connected; run hisaab connect first.');
      const r = await verifyReceipt(receipt, h.zkool, c.accountId);
      out(`[${await h.mode()}] receipt ${receipt.txid}`);
      out(`  hash ${r.hashOk ? 'OK' : 'MISMATCH (receipt was edited)'}`);
      if (!r.found) out(`  tx NOT found in watch-only account #${c.accountId}${r.error ? `: ${r.error}` : ''}`);
      for (const f of r.fields) out(`  ${f.match ? 'match   ' : 'MISMATCH'} ${f.field}: receipt=${JSON.stringify(f.expected)} wallet=${JSON.stringify(f.actual)}`);
      out(r.ok ? 'VERIFIED' : 'NOT VERIFIED');
      process.exitCode = r.ok ? 0 : 1;
      return;
    }
    case 'serve': {
      const s = await startServer(h, { port: cfg.port });
      out(`Hisaab UI on ${s.url} (127.0.0.1 only) · ${h.network === 'main' ? 'MAINNET (watch-only)' : 'TESTNET'} · zkool ${cfg.zkoolUrl} · ${formatIst(new Date())}`);
      // Background watcher: sync the watch-only account so invoices flip to "seen"/"paid" without a click.
      // HISAAB_SYNC_SECS=0 turns it off. Runs never overlap; errors (e.g. not connected yet) are skipped quietly.
      const every = Number(process.env.HISAAB_SYNC_SECS ?? 20);
      if (every > 0) {
        let busy = false;
        setInterval(async () => {
          if (busy) return;
          busy = true;
          try { await h.sync(); } catch { /* not connected yet, or zkool busy: try again next tick */ }
          busy = false;
        }, every * 1000);
        out(`watching: sync every ${every}s (HISAAB_SYNC_SECS)`);
      }
      return;
    }
    case undefined:
    case 'help':
    case '--help':
      out(USAGE);
      return;
    default:
      throw new Error(`unknown command "${cmd}"\n\n${USAGE}`);
  }
}

main().catch((e) => {
  console.error(`hisaab: ${e?.message || e}`);
  process.exitCode = 1;
});
