// Edits the demo video from the raw recording (scripts/record-demo.cjs) with ffmpeg.
// Cards are HTML rendered by headless Chrome. The block wait between "paid" and "mined" is sped up
// and labelled with the real wait time. Nothing is staged: every UI frame is from the real run.
// Usage: node scripts/make-video.cjs   → media/hisaab-demo.mp4
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RAW = process.env.HISAAB_MEDIA_OUT || path.join(ROOT, 'media', 'raw');
const OUT = path.join(path.dirname(RAW), 'hisaab-demo.mp4');
const W = 1280, H = 800, FPS = 30;
const marks = JSON.parse(fs.readFileSync(path.join(RAW, 'marks.json'), 'utf8'));
const webm = fs.readdirSync(RAW).filter((f) => f.endsWith('.webm')).map((f) => path.join(RAW, f))
  .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
const tmp = path.join(RAW, 'build');
fs.mkdirSync(tmp, { recursive: true });
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

const css = `body{margin:0;width:${W}px;height:${H}px;display:flex;align-items:center;justify-content:center;background:#f6f4ef;color:#1d2321;font-family:'Noto Sans','DejaVu Sans',sans-serif}
.c{max-width:1000px;padding:40px} h1{font-size:64px;margin:0 0 12px} h2{font-size:40px;margin:0 0 20px} p{font-size:28px;line-height:1.45;margin:10px 0;color:#3b4542}
.k{font-size:20px;letter-spacing:.12em;text-transform:uppercase;color:#1f6f5c;font-weight:700} q{font-style:italic} small{font-size:20px;color:#6b7572}
pre{font:17px/1.45 'DejaVu Sans Mono',monospace;background:#1d2321;color:#e8efe9;padding:18px 22px;border-radius:10px;white-space:pre-wrap;max-height:560px;overflow:hidden}`;
const cards = {
  title: `<div class="c"><div class="k">Zcash Free Society Hack · Privacy track</div><h1>Hisaab</h1><h2>Private books for shielded ZEC</h2>
    <p>Invoices travel in encrypted memos. Payments are matched with a view-only key. At year end your CA gets an incoming-only ledger for the Indian financial year, not your wallet.</p></div>`,
  problem: `<div class="c"><div class="k">The problem</div><h2>Tax season doesn't care that your chain is private</h2>
    <p>Freelancers and shops in India paid in shielded ZEC must report every transfer in Schedule VDA. Mainstream crypto-tax tools can't see shielded transactions, and wallet exports drop txids and memos.</p>
    <p><q>The bookkeeper needs records and the auditor needs proof… I can't find much evidence that anyone uses them this way.</q></p>
    <small>Zcash Community Forum, "Is anyone actually using viewing keys for business accounting?", Jun 2026</small></div>`,
  verify: fs.existsSync(path.join(RAW, 'verify.txt')) ? `<div class="c" style="max-width:1150px"><div class="k">6. The CA checks the pack (real output)</div>
    <pre>${fs.readFileSync(path.join(RAW, 'verify.txt'), 'utf8').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre></div>` : null,
  chain: fs.existsSync(path.join(RAW, 'chain.txt')) ? `<div class="c" style="max-width:1150px"><div class="k">On-chain evidence (real output)</div>
    <pre>${fs.readFileSync(path.join(RAW, 'chain.txt'), 'utf8').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre></div>` : null,
  trust: `<div class="c"><div class="k">Privacy and trust</div><h2>What each party sees</h2>
    <p><b>On-chain:</b> sender, receiver, amount and memo are shielded.</p>
    <p><b>Hisaab's server:</b> holds a view-only key, never a spending key. Stores invoice codes and txids locally.</p>
    <p><b>Light-wallet server</b> (testnet.zec.rocks) sees the watcher's IP and sync timing. Next: route it over Nym.</p>
    <p><b>The CA</b> sees income only: an incoming viewing key can't see spends and can't spend.</p></div>`,
  end: `<div class="c"><div class="k">Everything in this video was real</div><h2>Public Zcash testnet · NU7 · Ironwood pool</h2>
    <p>Testnet tx <b>${marks.txid ? marks.txid.slice(0, 20) + '…' : ''}</b><br><small>https://zexplorer.app/testnet/tx/${marks.txid || ''}</small></p>
    <p>One wait was sped up, and labelled. TAZ has no value.</p>
    <p><b>github.com/nikhil-pn/hisaab</b> · zero-dependency Node library + CLI + local UI</p></div>`,
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/google/chrome/chrome' });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const [name, html] of Object.entries(cards)) {
    if (!html) continue;
    await page.setContent(`<style>${css}</style>${html}`);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(tmp, `${name}.png`) });
  }
  await browser.close();

  const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an'];
  const card = (name, secs) => { const o = path.join(tmp, `card-${name}.mp4`); ff(['-loop', '1', '-t', String(secs), '-i', path.join(tmp, `${name}.png`), '-vf', `scale=${W}:${H},fps=${FPS}`, ...enc, o]); return o; };
  const cut = (name, from, to, extra = '') => { const o = path.join(tmp, `seg-${name}.mp4`); ff(['-ss', String(from), '-to', String(to), '-i', webm, '-vf', `scale=${W}:${H},fps=${FPS}${extra}`, ...enc, o]); return o; };

  const parts = [card('title', 6), card('problem', 9)];
  const waitFrom = marks.paid + 4, waitTo = marks.mined;
  const waitSecs = waitTo - waitFrom;
  parts.push(cut('a', marks.start, waitFrom));
  if (waitSecs > 12) {
    const factor = Math.ceil(waitSecs / 8);
    const label = `Sped up ${factor}x - real wait ${Math.round(waitSecs)} s for the block`;
    parts.push(cut('wait', waitFrom, waitTo, `,setpts=PTS/${factor},drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${label}':x=(w-tw)/2:y=24:fontsize=26:fontcolor=white:box=1:boxcolor=0x1d2321@0.85:boxborderw=12`));
  } else parts.push(cut('wait', waitFrom, waitTo));
  // End before the explorer shot: tonight the public testnet explorers can't show the tx (see FEEDBACK.md).
  parts.push(cut('b', waitTo, (marks.packAt ?? marks.pack) + 8));
  if (cards.verify) parts.push(card('verify', 11));
  if (cards.chain) parts.push(card('chain', 9));
  parts.push(card('trust', 9), card('end', 7));

  const list = path.join(tmp, 'list.txt');
  fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', OUT]);
  const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT], { encoding: 'utf8' }).trim();
  console.log(`${OUT} · ${Number(dur).toFixed(1)} s`);
})().catch((e) => { console.error(e); process.exit(1); });
