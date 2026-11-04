# Hisaab

> Private books for shielded ZEC. Invoices travel in encrypted memos, payments are matched with a view-only key, and at year end you give your CA an incoming-only ledger for the Indian financial year, not your wallet.

| | |
|---|---|
| **Track** | Privacy |
| **Privacy theme(s)** | 3. Privacy beyond the transaction (viewing-key export, verifiable receipts, invoices in encrypted memos), with a small leg of 1. Private payment rails (checkout matched by memo) |
| **What it is** | CLI + local web UI + zero-dependency JavaScript library (`src/`) |
| **Live URL** | N/A. It runs on `127.0.0.1` by design (it holds a viewing key). The video shows it running. |
| **Demo video** | https://github.com/nikhil-pn/hisaab/blob/main/docs/hisaab-demo.mp4 |
| **Testnet txid** | `d78fd57ae683f7ac1055e4c6b8133db2e5350cce2306ae15a0ab8e5dd5ac4541` · https://testnet.zcashexplorer.app/transactions/d78fd57ae683f7ac1055e4c6b8133db2e5350cce2306ae15a0ab8e5dd5ac4541 (open in a browser; tonight zexplorer.app/testnet is indexed only to block 4,506,233, see FEEDBACK.md) |
| **Team** | Nikhil P N (@nikhil-pn) |

---

## 1. The problem and who it's for

- **User:** an Indian freelancer or small shop that is paid in shielded ZEC, and the chartered accountant (CA) who files their return.
- **Problem:** in India, crypto income is taxed as a virtual digital asset (VDA) and Schedule VDA in the ITR is transaction-wise. Everything a CA needs for a shielded payment (date, amount, memo, which invoice it paid) is inside encrypted notes. Nothing on the public chain gives it to the CA, and the usual tools cannot read it.
- **Evidence** (all from `docs/research-needed.md`, which has more detail and marks what we could not verify):
  - The Zcash forum thread [Is anyone actually using viewing keys for business accounting?](https://forum.zcashcommunity.com/t/is-anyone-actually-using-viewing-keys-for-business-accounting/56300) (20 Jun 2026): "The bookkeeper needs records and the auditor needs proof, and tax season doesn't care that your chain is private." and "But I can't find much evidence that anyone uses them this way." A reply says "The encryption is done; the boring middle is not."
  - The forum thread [Exporting transaction history to JSON/CSV from UFVK/seed](https://forum.zcashcommunity.com/t/exporting-transaction-history-to-json-csv-from-ufvk-seed/54662) (10 Feb 2026): Zashi's tax export "contains almost no information, not even txids", and Ywallet, Zkool and Zingo "all have really terrible export options".
  - Zodl's own [Export Tax File](https://support.zodl.com/article/22-exporting-a-tax-file) has only Date, Received/Sent Quantity, Fee and Tag columns (no txid, no memo, no address, no fiat value), covers only the previous calendar year (the Indian FY runs 1 Apr to 31 Mar), and is unencrypted.
  - CoinTracker's [Zcash page](https://www.cointracker.io/wallet/zcash): "Shielded addresses (z-addresses) are not publicly viewable." Koinly's [Zcash page](https://koinly.io/integrations/zcash/) offers only a public address, an XPUB or a CSV upload. (We did not find a statement either way for KoinX, CoinLedger or ZenLedger, so we claim nothing about them.)
  - [Schedule VDA](https://www.taxheal.com/?p=129471) asks for each transfer: date of acquisition, date of transfer, cost of acquisition, consideration received (all in INR). A practitioner checklist from [Patron Accounting](https://www.patronaccounting.com/blog/crypto-vda-taxation-income-tax-act-2025-rules) lists timestamps, quantities, INR price at the time and receipts as proof of cost.
  - We did not interview users for this project. This README names no one who asked for it.

**What already exists, honestly.** Viewing key to CSV already exists in developer form (Zkool, zingo-cli, Zenith). Two early bookkeeping tools exist too:
- [ZecLedger](https://github.com/vancube2/zecledger) is a read-only CLI plus dashboard with balances, tx history, cost-basis reports and payment reconciliation. It was rejected for a retroactive grant in Sep 2026 (see the [forum thread](https://forum.zcashcommunity.com/t/retroactive-grant-zecledger/56969)); we have not run it.
- [ZecBooks / SaneBooks](https://github.com/sane-apps/SaneBooks) (v0.1.1) is a macOS app that classifies rows and exports CSV/PDF and an encrypted expiring proof pack; fiat values are user-supplied.

From their descriptions, neither matches payments to invoice codes in the memo, uses the Indian financial year, or gives the accountant a verifiable receipt for a single payment. Hisaab does those three things, and the CA's check needs no key. It is a small tool; it does not replace tax software.

## 2. What it does

You create an invoice. Hisaab gives you a `zcash:` payment link whose memo is an invoice code like `HSB-XXXXXX`. The client pays from any shielded wallet. A watch-only account (a view-only key, no spending key) sees the payment arrive, reads the memo, and marks the invoice paid after one confirmation. At year end `hisaab pack` writes a folder for your CA: a ledger for the Indian FY, one receipt per payment, and a manifest. The CA runs `hisaab verify` on any receipt to check it against the chain data, and never needs your wallet.

Screenshots: see the demo video (https://github.com/nikhil-pn/hisaab/blob/main/docs/hisaab-demo.mp4).

## 3. Run it in under 15 minutes

**Requirements:** Node 24 (tested on 24.14.1; the system `node` on some machines is older). No `npm install`: there are zero dependencies. For the real-chain path you also need the Rust toolchain to build `zkool_graphql` (about 30 minutes the first time; or use a prebuilt binary from the zkool2 releases page if one exists for your OS).

**Option A: no chain at all (MOCK).** This uses a mock GraphQL server and fake data. It shows the UI and the invoice-to-paid loop but proves nothing about Zcash. The UI shows a MOCK badge.

```bash
git clone https://github.com/nikhil-pn/hisaab && cd hisaab
node test/mock-zkool.js 8002 &     # prints example FAKE keys; MOCK, not a chain
node bin/hisaab.js serve           # http://127.0.0.1:4040/
npm test                           # 28 tests, all against the mock
```

**Option B: real Zcash testnet.**

```bash
# 1. Build the wallet server (once)
git clone https://github.com/hhanh00/zkool2 && cd zkool2/rust
cargo build --release --features graphql --bin zkool_graphql
cd ../..                           # back in the hisaab repo

# 2. Start two local zkool servers, both on 127.0.0.1:
#    :8001 demo payer + demo freelancer wallets (hold seeds, never expose)
#    :8002 Hisaab's watch-only account
ZKOOL_BIN=../zkool2/target/release/zkool_graphql scripts/zkool-up.sh all

# 3. Create the two demo wallets (prints addresses and the freelancer's public keys only)
node scripts/demo-wallets.mjs --faucet     # fund the payer from a testnet faucet (https://fauzec.com or https://faucet.testnet.valargroup.dev/)

# 4. Connect the watch-only account with the freelancer's incoming-only key
cp .env.example .env
node bin/hisaab.js connect --key uivktest1... --birth <height>   # values from step 3 / data/demo-wallets.json
node bin/hisaab.js sync

# 5. Invoice, pay, watch, pack, verify
node bin/hisaab.js invoice new --amount 0.01 --for "Logo design"   # prints the zcash: link
node scripts/demo-pay.mjs 'zcash:utest1...?amount=0.01&memo=...'    # plays the client
node bin/hisaab.js sync && node bin/hisaab.js invoice list
node bin/hisaab.js ledger --fy 2026-27
node bin/hisaab.js pack --fy 2026-27
node bin/hisaab.js verify out/<pack-dir>/receipts/<txid>.json
node bin/hisaab.js serve                                            # or use the web UI at http://127.0.0.1:4040/
```

**Test funds:** testnet only. Faucet TAZ has no value. To check our result without running anything, use the viewing key in section 5.

**Settings** (`.env`): `HISAAB_NETWORK` (`test` default, `main` is watch-only), `ZKOOL_URL` (default `http://127.0.0.1:8002/graphql`), `HISAAB_CONFIRMATIONS` (default 1), `HISAAB_PORT` (default 4040), `HISAAB_ACCOUNT_NAME`.

## 4. How it works, and what is real

1. **Invoice.** `hisaab invoice new` makes a code `HSB-XXXXXX` and a ZIP 321 `zcash:` URI with the amount and the code in the memo. Only testnet shielded addresses (`utest1`, `ztestsapling1`) are accepted.
2. **Client pays** from any shielded wallet by opening the link. (Manual step in the demo: `scripts/demo-pay.mjs` plays the client.)
3. **Seen.** The watcher is a `zkool_graphql` account made from the incoming viewing key. It sees the transaction in the mempool and decrypts the memo.
4. **Mined, then paid.** Once the transaction has a block height, and confirmations reach `HISAAB_CONFIRMATIONS` (default 1), an invoice with the exact amount becomes `paid`. Less is `underpaid`, more is `overpaid`. Each txid is claimed by at most one invoice and never acts twice.
5. **Ledger.** One row per received note, grouped by Indian FY (1 Apr to 31 Mar, boundaries in IST). Mempool rows are shown but excluded from FY totals. An optional INR reference column is opt-in (`--inr`).
6. **CA pack.** `hisaab pack --fy 2026-27` writes `out/hisaab-FY2026-27-<stamp>/` with `ledger.csv`, `ledger.json`, `receipts/<txid>.json`, `invoices.csv`, `readonly-proof.txt`, `MANIFEST.sha256` and `README-for-CA.md`.
7. **CA verifies.** `hisaab verify receipt.json` recomputes the receipt's sha256 and compares each field to the transaction in a watch-only account. `sha256sum -c MANIFEST.sha256` checks the folder was not edited. (Today `verify` needs a Hisaab watch-only account to compare against; the pack alone proves integrity, not authenticity.)

| Step | Status | Evidence |
|---|---|---|
| Create invoice and ZIP 321 link | real | `hisaab invoice new` output, video |
| Shielded testnet payment with memo | real (zkool payer wallet, public testnet) | `d78fd57ae683f7ac1055e4c6b8133db2e5350cce2306ae15a0ab8e5dd5ac4541`, https://testnet.zcashexplorer.app/transactions/d78fd57ae683f7ac1055e4c6b8133db2e5350cce2306ae15a0ab8e5dd5ac4541 (open in a browser; tonight zexplorer.app/testnet is indexed only to block 4,506,233, see FEEDBACK.md) |
| Watch-only account sees it, memo matched | real | video, section 5 key |
| Paid after 1 confirmation | real | video |
| Ledger, CA pack, `verify` | real code, run against the same real account | video |
| Unit and integration tests | 28 tests, MOCK zkool server only | `npm test` |
| Read-only proof | real on testnet: zkool refused a `pay` on the watch-only account with "This account sees incoming payments only; it cannot spend" | `readonly-proof.txt` in the pack, video |
| Second real payment (first CLI run) | real | `083854f4ed942d0658da1e9fea0d053a70daf5915bc441f391b425956958a8ea`, block 4,582,618 |

**Known limitations:** the payer side is a script we run, not a real client. `verify` is only as good as the watch-only account it queries. INR rates are mainnet reference prices and are not Schedule-VDA cost basis. No bech32m checksum check on addresses (zkool makes the address itself). Data at rest is plain files (mode 600).

## 5. Privacy and trust

1. **What stays private?** On-chain, sender, receiver and amount are shielded and the memo is encrypted. Hisaab never holds a spending key: it connects with a `uivktest1…` incoming-only key (a full `uviewtest1…` key is accepted, but the UIVK is the narrowest), refuses seed phrases and spending keys, and the pack records that zkool refuses a `pay` attempt ("This account sees incoming payments only; it cannot spend").
2. **What does the app reveal, and to whom?**
   - The light-wallet server (`testnet.zec.rocks`) sees the watcher's IP address and sync timing.
   - Hisaab stores invoice codes, descriptions, txids, amounts and memos locally in `data/` (directory 700, files 600), and nothing else. No phone number or email is collected or stored.
   - The optional INR column (only with `--inr`) calls CoinGecko, which sees our IP address and the dates queried. It is off by default.
   - No LLM or other model provider is in the loop.
   - The CA who receives the pack sees the whole ledger, including memos and descriptions.
   - If you hand over the UIVK itself, the holder sees all incoming history, forever. A handed-out key cannot be recalled (ZecHub's [Viewing Keys](https://zechub.wiki/zcash-tech/viewing-keys) page: "a handed-out key cannot be recalled — only outlived by moving the funds"). The pack exists so you do not have to.
   - The web UI binds only to `127.0.0.1`, checks the Host header, and refuses cross-origin POSTs.
3. **Who do users have to trust?** The operator of the machine running Hisaab (you); the light-wallet server for honest chain data (it can lie or withhold, it cannot read your notes); the `zkool_graphql` binary; CoinGecko if you use `--inr`; and your CA with the ledger.
4. **What would we fix next?** (a) Route the watcher's traffic through Nym so the light-wallet server does not see an IP. (b) A narrower per-FY disclosure, so the CA gets verifiable receipts without ever being handed the key. (c) Encrypt `data/` at rest.

**Viewing key (optional):** `uivktest1hnjpqcxfupge0m0586svtg38spsyfqy5le7500lg8y8r67z5j6rr9juczs84a6cdprcrg9kyeljrvys5aqk4s7a3m20xxv9nqg2yflpqmm3cqkl2flm56peafpn3znq4vnfuyqqrwqhsdpnm4f6pgkgdazjdrk8ut2d9tzc7zzp7kgzqmr47fwcqkv7ffd832e7cr2ttr3jdzqeupw72szq8clf7ltazm2af5d2s9elj74npq46t9h9w57wgtlaug0q8642r78d3cg4300vuxkus6u7zfqx8wud4vdw2gvwnxrdfut2wzfg5wsmw6h3t3mlr5maty3gfja80fjlpwqfaardzsk` · birth height `4582613`. This is the demo freelancer wallet on testnet. It is an incoming-only key: it shows the amount and memo of what that wallet received and cannot spend.

## 6. How it's built

- **Technologies used:**
  - Node.js 24.14.1 (built-in `fetch`, `node:http`, `node:test`, `node:crypto`; zero npm dependencies), plain ESM JavaScript with JSDoc
  - `zkool_graphql` built from [zkool2](https://github.com/hhanh00/zkool2) v6.36.0 source (GraphQL wallet server)
  - lightwalletd at `https://testnet.zec.rocks:443`
  - Zcash standards: ZIP 316 (unified addresses and viewing keys, UIVK/UFVK), ZIP 317 (fees), ZIP 321 (payment request URIs), ZIP 302 (memos)
  - CoinGecko API (optional INR reference rates)
  - Playwright and ffmpeg (recording the demo video only)
- **Architecture:**

  ```
  payer wallet (zkool :8001, has seed) --shielded TAZ + memo HSB-XXXXXX--> freelancer UA
                                                                              |
  Hisaab (Node 24)  <-- GraphQL --  zkool watcher :8002 (UIVK only) <-- testnet.zec.rocks
     invoices ── memo match ── ledger (Indian FY) ── CA pack
     web UI 127.0.0.1:4040                          (ledger.csv/json, receipts, invoices.csv,
                                                     readonly-proof.txt, MANIFEST.sha256, README-for-CA.md)
  ```

- **Code worth reading:** `src/invoices.js` (memo codes, ZIP 321, matching, one-txid-once rule) · `src/ledger.js` (rows, Indian FY in IST, CSV with formula-injection guard) · `src/receipt.js` (canonical-JSON hash, `verifyReceipt`) · `src/pack.js` (CA pack, manifest, read-only proof) · `src/zkool.js` (GraphQL client with variables only) · `src/network.js`.
- **Design decisions:**
  - All money math is integer zats; CSV amounts are non-negative in separate received/sent/fee columns.
  - Incoming-only key preferred. With a UIVK the ledger has only `in` rows and says "spends not visible"; self-sends never count as income.
  - A txid is claimed by at most one invoice, and an invoice keeps its first txid.
  - Indian FY by block time in IST; mempool rows excluded from totals.
  - The read-only proof refuses to run if zkool holds a seed for the account (a `pay` would then be a real spend).
  - Networks are never mixed: keys and addresses from the other network are refused, and a data dir is bound to one network.
  - CSV cells starting with `= + - @` are prefixed with `'`.
  - No third party sees anything by default; INR rates are opt-in.
- **Built during the hack vs before:** everything here was written during the hack (4 Nov 2026). Dependencies built elsewhere: zkool2, lightwalletd.
- **Reusable parts:** `src/` is an importable library with no dependencies (`import { ... } from 'hisaab'`, subpaths `hisaab/zkool`, `/ledger`, `/invoices`, `/receipt`, `/pack`): a zkool GraphQL client, ZIP 321 and memo-code helpers, Indian-FY ledger and receipt builders. It is not yet published to npm.

## 7. What's next (30 days)

- Publish `src/` to npm as a library with docs.
- A Schedule-VDA-shaped INR export, with cost basis, as a CSV the CA can paste from.
- A pilot with one CA in Kochi or Mumbai: ask whether the pack is what they would actually want. Not started; nobody has agreed yet.
- Nym transport for the watcher, and per-FY narrower disclosure.
- An upstream issue to zkool2 about the friction in FEEDBACK.md: drafted in docs/upstream-zkool2-issue.md (to be filed on hhanh00/zkool2).
- **Who benefits:** Indian freelancers and shops paid in shielded ZEC, and their CAs.

## Also runs on mainnet (watch-only)

This is an extra. Judging is on testnet and everything above is testnet. Testnet TAZ has no value, and we do not claim otherwise.

`HISAAB_NETWORK=main` switches the key prefixes (`uivk1…`, `uview1…`) and address prefixes (`u1`, `zs1`). Mainnet is watch-only by design: no code path calls `pay` on mainnet, and the UI, ledger, receipts and pack are labelled MAINNET. A mainnet watcher and a mainnet invoice (`HSB-E6FVT8`, 0.002 ZEC) are running; a real mainnet payment, once made, will be listed here: MAINNET_TXID_PENDING.

## 8. Links

- Repo: https://github.com/nikhil-pn/hisaab
- Demo video: https://github.com/nikhil-pn/hisaab/blob/main/docs/hisaab-demo.mp4
- Research and evidence: `docs/research-needed.md`; implementation notes: `docs/IMPLEMENTATION_NOTES.md`

## Feedback

See [FEEDBACK.md](./FEEDBACK.md).

## License

MIT

---

## Resources used

- Privacy track brief: https://stadium.joinwebzero.com/programs/free-society-hack-2026/privacy/llms.txt
- Testnet faucets: https://fauzec.com · https://faucet.testnet.valargroup.dev/
- Testnet explorer: https://zexplorer.app (`/testnet/tx/<txid>`)
- zkool2: https://github.com/hhanh00/zkool2 · lightwalletd: https://github.com/zcash/lightwalletd
