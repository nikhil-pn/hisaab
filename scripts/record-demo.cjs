// Records the demo video from the REAL app: Playwright drives the Hisaab UI in headless Chrome while
// the demo client wallet pays a real shielded testnet invoice. Captions are an overlay bar injected
// into the page. Timestamps of each step go to media/raw/marks.json so the editor (make-video.sh)
// can speed up the block wait and label it.
// Prereqs: scripts/zkool-up.sh, data/demo-wallets.json with a funded payer, and `hisaab serve` running
// on HISAAB_URL against a FRESH data dir (no account connected yet).
// Usage: node scripts/record-demo.cjs
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const UI = process.env.HISAAB_URL || 'http://127.0.0.1:4040/';
const OUT = process.env.HISAAB_MEDIA_OUT || path.join(ROOT, 'media', 'raw');
const NODE = process.execPath;
const wallets = JSON.parse(fs.readFileSync(process.env.HISAAB_DEMO_WALLETS || path.join(ROOT, 'data', 'demo-wallets.json'), 'utf8'));
const marks = {};
const t0 = Date.now();
const mark = (k) => { marks[k] = (Date.now() - t0) / 1000; console.log(`${marks[k].toFixed(1)}s ${k}`); };

async function caption(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById('__cap');
    if (!el) {
      el = document.createElement('div');
      el.id = '__cap';
      el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:88%;z-index:99999;' +
        'background:rgba(15,18,22,.88);color:#fff;font:600 22px/1.35 system-ui,sans-serif;padding:12px 20px;border-radius:10px;text-align:center';
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

async function typeSlow(page, sel, text, delay = 25) {
  await page.click(sel);
  await page.fill(sel, '');
  await page.type(sel, text, { delay });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: OUT, size: { width: 1280, height: 800 } } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => { console.log('dialog: ' + d.message()); d.dismiss().catch(() => {}); });
  await page.goto(UI);
  await page.waitForTimeout(1200);
  mark('start');
  await caption(page, 'Hisaab runs locally. It talks to a watch-only zkool wallet server on 127.0.0.1, synced from public Zcash testnet.');
  await page.waitForTimeout(4500);

  // 1. Connect an incoming-only viewing key (the freelancer's UIVK). Paste, not type: it's 300+ chars.
  await caption(page, "1. The freelancer connects an INCOMING-ONLY viewing key (UIVK). It can see payments received. It can't spend and can't see spends.");
  await page.fill('#ufvk', wallets.freelancer.uivk);
  await page.fill('#birth', String(wallets.freelancer.birth));
  await page.fill('#acctName', 'freelancer-books');
  await page.waitForTimeout(2500);
  await page.click('#connectForm button[type=submit], #connectForm button');
  await page.waitForFunction(() => /Connected/i.test(document.querySelector('#connectMsg')?.textContent || ''), null, { timeout: 120000 });
  mark('connected');
  await page.waitForTimeout(3000);

  // 2. Create an invoice: the code rides in the encrypted memo.
  await caption(page, '2. New invoice. The code HSB-… travels inside the encrypted memo of a ZIP 321 payment link.');
  await page.locator('#invoiceForm').scrollIntoViewIfNeeded();
  await typeSlow(page, '#amount', '0.01');
  await typeSlow(page, '#desc', 'Logo design, Chai Point Mumbai');
  await page.click('#invoiceForm button[type=submit], #invoiceForm button');
  await page.waitForFunction(() => /^zcash:/.test(document.querySelector('#uriText')?.textContent || ''), null, { timeout: 30000 });
  const uri = (await page.textContent('#uriText')).trim();
  mark('invoice');
  await page.waitForTimeout(4000);

  // 3. The client pays from their own wallet (our demo payer, a separate zkool account).
  await caption(page, "3. The client pays from their own shielded wallet (a separate demo wallet). It's a real testnet transaction.");
  const payOut = execFileSync(NODE, [path.join(ROOT, 'scripts', 'demo-pay.mjs'), uri], { cwd: ROOT, encoding: 'utf8' });
  const { txid, explorer } = JSON.parse(payOut.trim().split('\n').pop());
  marks.txid = txid; marks.explorerUrl = explorer;
  mark('paid');

  // 4. Watch it go seen → mined → paid. Hisaab's watcher syncs on its own; we also press Sync.
  await caption(page, `Broadcast: ${txid.slice(0, 16)}…  Hisaab's watcher is looking for the memo with the view-only key.`);
  const code = (/HSB-[0-9A-Z]{6}/.exec(decodeURIComponent(new URL(uri.replace(/^zcash:/, 'http://x/')).searchParams.get('message') || '')) || [''])[0];
  marks.code = code;
  const statusText = () => page.evaluate((c) => [...document.querySelectorAll('#invTable tr')].map((r) => r.textContent).find((t) => t.includes(c)) || '', code).catch(() => '');
  let seen = false;
  for (let i = 0; i < 120; i++) {
    const t = await statusText();
    if (!seen && /seen|mempool/i.test(t)) { seen = true; mark('seen'); await caption(page, 'Seen in the mempool: memo matched to the invoice. Not paid yet: Hisaab waits for 1 confirmation.'); }
    if (/paid at height/i.test(t)) { mark('mined'); break; }
    if (i % 4 === 0) await page.click('#syncBtn', { timeout: 2000 }).catch(() => {});
    if (i % 6 === 0) console.log(`  waiting ${i * 5}s: ${t.replace(/\s+/g, ' ').slice(0, 120)}`);
    await page.waitForTimeout(5000);
  }
  if (!marks.mined) throw new Error('payment not seen as paid within 10 minutes');
  await caption(page, 'Paid: mined in a block and matched to the invoice. Each txid can settle only one invoice.');
  await page.waitForTimeout(5000);

  // 5. Ledger for the Indian financial year.
  await page.locator('#ledgerTable').scrollIntoViewIfNeeded();
  await caption(page, '4. The ledger for Indian FY 2026-27 (Apr–Mar): date in IST, amount, memo, block height, explorer link. CSV for the CA.');
  mark('ledger');
  await page.waitForTimeout(6000);

  // 6. CA pack.
  await page.locator('#packBtn').scrollIntoViewIfNeeded();
  await caption(page, '5. One click builds the CA pack: ledger, per-payment receipts, invoices, a read-only proof and a sha256 manifest.');
  await page.click('#packBtn');
  await page.waitForFunction(() => (document.querySelector('#packOut')?.textContent || '').length > 20, null, { timeout: 60000 });
  await page.locator('#packOut').scrollIntoViewIfNeeded();
  mark('pack');
  await page.waitForTimeout(7000);

  // 7. The same txid on a public explorer: proves existence, height, fee — not amount or memo.
  await page.goto(explorer, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(2500);
  await caption(page, 'The public explorer shows the transaction exists and its fee. Amount, memo, sender and receiver stay shielded.');
  mark('explorer');
  await page.waitForTimeout(7000);

  fs.writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify(marks, null, 2));
  await ctx.close();
  await browser.close();
  console.log(JSON.stringify(marks));
})().catch((e) => { console.error(e); process.exit(1); });
