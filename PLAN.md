# Hisaab — plan (Free Society Hack, Privacy track)

**Pitch:** Hisaab gives a shielded-ZEC freelancer or shop private books: invoices travel in encrypted memos, payments are matched by a view-only key, and at year end you hand your CA (accountant) a viewing-key ledger for the Indian financial year, not your wallet.

*Hisaab* = "accounts" in Hindi/Urdu. Track: **Privacy (Zcash)**, Theme 3 (viewing-key export, verifiable receipts, invoices in encrypted memos) with a Theme 1 leg (checkout matched by memo, organisers' recipe A + E).

## Why this, not the obvious idea
- 25 entries already on Stadium; ~15 are "agent + shielded ZEC + Bitrefill gift card". None is an accountant / tax-season tool. Theme 3 explicitly lists "accountants, auditors" and "a read-only export from a viewing key, a verifiable receipt for one payment, invoices in encrypted memos".
- Agentic track is not reachable tonight: needs a Bitrefill account and event credits handed out at the venue.
- Rubric fit (0–3 each): **Works** — one small flow, fully real on testnet. **Private** — server holds only a UFVK, stores invoice codes + txids, nothing else; honest trust note. **Easy** — CA gets one folder + one command. **Needed** — India taxes VDAs (115BBH 30%, 194S TDS, Schedule VDA in ITR) and mainstream crypto tax tools can't read shielded ZEC. **Continuing** — upstream issue + forum post during the hack. **Bonus** — `src/` is an importable zero-dependency library (zkool GraphQL client + ledger/receipt builders).

## Architecture
```
 payer wallet (zkool #1, seed, 127.0.0.1:8001)  --shielded TAZ + memo "HSB-XXXXXX"-->  freelancer UA (utest1…)
                                                                                         |
 Hisaab watcher (zkool #2, watch-only UFVK + birth, 127.0.0.1:8002) <-- light-wallet: https://testnet.zec.rocks:443
        |
 hisaab (Node 24, zero deps):  invoices.json ── match memo ── ledger (Indian FY Apr–Mar) ── CA pack
        |                                                                                    ├ ledger.csv / ledger.json
 web UI 127.0.0.1:4040 (connect UFVK, invoices + zcash: links, ledger, download pack)        ├ receipts/<txid>.json
                                                                                             ├ readonly-proof.txt ("No Signing Key")
                                                                                             ├ MANIFEST.sha256
                                                                                             └ README-for-CA.md
```
- Payment state: seen (mempool) → mined (height) → confirmed (≥1 conf; threshold in README). Each txid acted on once.
- Optional INR reference column: CoinGecko historical ZEC/INR for the tx date, clearly labelled "mainnet reference rate; testnet TAZ has no value". Blank if offline.

## Files (ownership)
- `src/zkool.js` GraphQL client · `src/ledger.js` rows/FY/CSV · `src/invoices.js` ZIP 321 + memo codes + matching · `src/receipt.js` receipt + verify · `src/pack.js` CA pack · `src/server.js` + `web/` local UI · `bin/hisaab.js` CLI · `scripts/` wallet setup + demo seeding · `test/` node:test with a mock zkool server.
- Docs (`README.md`, `FEEDBACK.md`, `docs/`) are written last, from real results.

## Human actions
1. Allow the agent to build/run `zkool_graphql` (third-party Rust wallet server) — needed for any real testnet tx.
2. Submit on Stadium with the Luma email (only the owner can): fields in `docs/SUBMISSION.md`.

## Risks
- zkool build time (~30 min) → start first. Fauzec 1 TAZ/day/address → enough for ~50 demo payments.
- Light-wallet sync slow → watch-only birth set just below the first payment.
- Deadline 00:00 IST: code freeze 23:40, video by 23:30.
