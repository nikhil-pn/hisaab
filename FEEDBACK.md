# Feedback

For each item: what we tried, what happened, what we expected.

## Faucet
- **Fauzec API worked first time.** `POST /api/v1/claim` with a `utest1` address returned 200 with a txid at once (`63cc8301…2666`); 1 TAZ was spendable in the Ironwood pool about 75 s later. No friction. Expected: exactly this.

## Node or indexer (lightwalletd, Zebra, Zaino)
- **Explorer: zexplorer.app's testnet index is ~76,000 blocks behind.** Tried: `https://zexplorer.app/testnet/tx/<txid>` for our txid `d78fd57a…4541` (block 4,582,622) and for an older entrant's txid (block 4,582,317). Happened: "Transaction not found"; the overview page said "as of #4,506,233" while the chain tip was 4,582,627 (22:00 IST, 4 Nov). Expected: the explorer the brief recommends to show the tx. Impact: our demo video couldn't show an explorer page, so we show the client wallet's own view of the tx instead.
- **testnet.zcashexplorer.app returns `403 Forbidden nginx/1.18.0` to headless Chrome**, not just to curl. The brief says it works in a browser; it does not for automated recording. A note that both explorers can fail would have saved 15 minutes.
- **testnet.zec.rocks:443 was solid all evening.** Mempool visibility about 5 s after broadcast through a watch-only UIVK account; mined in 40 s.

## SDK or wallet tool (zkool2 v6.36.0, `zkool_graphql`)
- **Toolchain on first build.** Tried: `cargo build` in `zkool2/rust` as the brief says. Happened: `rust/` pins a Rust toolchain (1.99.0), so the first build also downloads a new toolchain before compiling. Expected: a note that the first build includes a toolchain download.
- **Prebuilt binary not mentioned.** Tried: followed the build-from-source steps (about 30 minutes). Happened: release v6.36.0 of zkool2 ships a prebuilt `zkool_graphql` asset, but the brief only documents building from source. Expected: one line pointing to the release asset, which would save every team the build.
- **Bind address not in the documented command.** Tried: the documented run command with `--allow-unauthenticated`, which exposes seeds. Happened: `--bind-address` exists (`src/graphql-cli.rs`) but is not in the command. Expected: the documented command to include `--bind-address 127.0.0.1` wherever `--allow-unauthenticated` is used. We use it in `scripts/zkool-up.sh`.

## Wallet
- **Fee differs from the brief.** The brief says a simple send costs 0.0001 ZEC (ZIP 317, 2 actions × 5,000 zats). Our 1-recipient shielded send with a memo paid **0.00002 TAZ** (zkool `transactionsByAccount.fee` for `d78fd57a…`). Either the brief or our understanding of NU7 fees is out of date; worth a one-line correction.
- **Incoming-only accounts refuse to spend with a different message than the brief says.** The brief says a watch-only account's `pay` returns `No Signing Key`. For a UIVK account zkool returns `This account sees incoming payments only; it cannot spend` (a UFVK account presumably gives `No Signing Key`). Code that string-matches the brief's text breaks.
- **`unifiedFullViewingKey(idAccount, incoming: true)` (UIVK export) isn't in the brief.** It is the narrowest key to hand an accountant: payments received only, no spends, no change. Worth a line in the "Taking a payment" and Theme 3 sections.

## Docs
- See the two zkool items above (prebuilt binary, bind address): both are documentation gaps.

## Other
- **Build time was mostly network, not CPU.** The first `cargo build --features graphql --bin zkool_graphql` cloned the full nymtech/nym history (a `[patch.crates-io]` git dependency resolved even without the `nym` feature) at ~0.5 MB/s. A shallow fetch of the pinned rev (171 MB, 2 min) plus `path =` patches got us compiling; the whole build took 43 min on 8 cores. zkool2 releases ship a prebuilt `zkool_graphql`; the brief only documents the source build. Upstream note drafted in `docs/upstream-zkool2-issue.md`.
- **`rust-toolchain.toml` pins 1.99.0** (its comment says 1.95.0 builds); a second `rustup` call during the toolchain download corrupted it (`could not rename downloaded file`). Building with the installed stable 1.96.0 (`cargo +stable`) worked.
