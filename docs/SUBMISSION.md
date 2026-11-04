# Stadium submission: copy blocks

Replace the `{{...}}` placeholders first. One block per field.

## Project name
```
Hisaab
```

## One-line pitch (max 140 characters)
```
Private books for shielded ZEC: invoices in memos, view-only payment matching, and an incoming-only CA ledger for the Indian FY.
```

## Track
```
Privacy
```

## Description (about 150 words)
```
Hisaab is private bookkeeping for Indian freelancers and small shops paid in shielded ZEC, and for their CA. You create an invoice and get a zcash: payment link whose memo carries an invoice code. The client pays from any shielded wallet. A watch-only zkool_graphql account, built from an incoming viewing key (no spending key), sees the payment in the mempool, reads the memo, and marks the invoice paid after one confirmation. Each txid is matched once. At year end, "hisaab pack" writes a folder for the Indian financial year (1 Apr to 31 Mar): ledger.csv and ledger.json, one receipt per payment, invoices.csv, a read-only proof (zkool refuses a pay attempt: "This account sees incoming payments only; it cannot spend"), a sha256 manifest and a README for the CA. The CA runs "hisaab verify" on any receipt. The CA gets an incoming-only ledger, not the wallet. It is a Node 24 CLI and local web UI with zero dependencies; src/ is an importable library. Tested on Zcash testnet.
```

## Repo URL
```
https://github.com/nikhil-pn/hisaab
```

## Testnet transaction ID
```
d78fd57ae683f7ac1055e4c6b8133db2e5350cce2306ae15a0ab8e5dd5ac4541
```
Explorer: https://testnet.zcashexplorer.app/transactions/d78fd57ae683f7ac1055e4c6b8133db2e5350cce2306ae15a0ab8e5dd5ac4541 (open in a browser; tonight zexplorer.app/testnet is indexed only to block 4,506,233, see FEEDBACK.md)

## Viewing key and birth height (optional)
```
Viewing key: uivktest1hnjpqcxfupge0m0586svtg38spsyfqy5le7500lg8y8r67z5j6rr9juczs84a6cdprcrg9kyeljrvys5aqk4s7a3m20xxv9nqg2yflpqmm3cqkl2flm56peafpn3znq4vnfuyqqrwqhsdpnm4f6pgkgdazjdrk8ut2d9tzc7zzp7kgzqmr47fwcqkv7ffd832e7cr2ttr3jdzqeupw72szq8clf7ltazm2af5d2s9elj74npq46t9h9w57wgtlaug0q8642r78d3cg4300vuxkus6u7zfqx8wud4vdw2gvwnxrdfut2wzfg5wsmw6h3t3mlr5maty3gfja80fjlpwqfaardzsk
Birth height: 4582613
Demo freelancer wallet on testnet. Incoming-only key (UIVK): shows the amount and memo of received payments, cannot spend.
```

## Public URL
```
none — local CLI + web UI; see video
```

## Privacy and trust note
```
1. What stays private: on-chain, sender, receiver and amount are shielded and the memo is encrypted. Hisaab never holds a spending key. It connects with an incoming-only viewing key (UIVK), refuses seed phrases and spending keys, and the CA pack records that zkool refuses a pay attempt ("This account sees incoming payments only; it cannot spend").
2. What the app reveals, to whom:
   - the light-wallet server (testnet.zec.rocks) sees the watcher's IP and sync timing
   - Hisaab stores invoice codes, descriptions, txids, amounts and memos locally in data/ (directory 700, files 600), and nothing else; no phone number or email is collected or stored
   - the optional INR column (off unless --inr) calls CoinGecko, which sees our IP and the dates queried
   - no LLM or other model provider is in the loop
   - the CA who receives the pack sees the whole ledger, including memos and descriptions
   - if the UIVK itself is shared, the holder sees all incoming history forever; the pack exists so you do not have to share it
3. Who users must trust: us as operator of their own machine; the light-wallet server for honest chain data (it cannot read notes); the zkool_graphql binary; CoinGecko if --inr is used; the CA with the ledger.
4. What we'd fix next: Nym for the watcher's traffic; a narrower per-FY disclosure (verifiable receipts without handing over the key); encrypt data/ at rest.
```

## Next 30 days
```
- Publish src/ to npm as a zero-dependency library (zkool GraphQL client, ZIP 321 and memo-code helpers, Indian-FY ledger and receipt builders).
- Schedule-VDA-shaped INR export with cost basis, as a CSV a CA can paste from.
- Pilot with one CA in Kochi or Mumbai (not started; nobody has agreed yet).
- Nym transport for the watcher and per-FY narrower disclosure.
- Upstream issue to zkool2 on the build and run friction in FEEDBACK.md: drafted in docs/upstream-zkool2-issue.md (to be filed on hhanh00/zkool2)
```

## Demo video
```
https://github.com/nikhil-pn/hisaab/blob/main/docs/hisaab-demo.mp4
```

## Friction notes (paste of FEEDBACK.md, with area tags)
```
[SDK or wallet tool: zkool2 v6.36.0] Toolchain on first build. Tried: cargo build in zkool2/rust as the brief says. Happened: rust/ pins a Rust toolchain (1.99.0), so the first build also downloads a new toolchain before compiling. Expected: a note that the first build includes a toolchain download.

[SDK or wallet tool: zkool2 v6.36.0] Prebuilt binary not mentioned. Tried: followed the build-from-source steps (about 30 minutes). Happened: release v6.36.0 ships a prebuilt zkool_graphql asset, but the brief only documents building from source. Expected: one line pointing to the release asset.

[SDK or wallet tool: zkool2 v6.36.0] Bind address not in the documented command. Tried: the documented run command with --allow-unauthenticated, which exposes seeds. Happened: --bind-address exists (src/graphql-cli.rs) but is not in the command. Expected: the documented command to include --bind-address 127.0.0.1 wherever --allow-unauthenticated is used.

[Docs] The two zkool items above (prebuilt binary, bind address) are documentation gaps.

(more added during the real-chain run)
```

## How to finalize on Stadium
- [ ] Sign in on https://stadium.joinwebzero.com/programs/free-society-hack-2026 with the point person's Luma email (the one checked in at the event).
- [ ] Give teammates edit access from the team list (their Luma email must be checked in).
- [ ] Submit the event feedback form first; Finalize needs it.
- [ ] Fill every field above from the copy blocks. Check the testnet txid badge (a failed check does not block you).
- [ ] Save the draft, re-read the video link in a private window, then click **Finalize and submit** before 00:00 IST, 5 Nov.
- [ ] After finalizing you can still edit until 00:00. Code pushed after 00:00 is not scored.
