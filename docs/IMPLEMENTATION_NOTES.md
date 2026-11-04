# Implementation notes (implementer agent, 2026-11-04)

## Test command

```
cd ~/hackathons/freesociety-nikhil/hisaab
~/.nvm/versions/node/v24.14.1/bin/node --test test/*.test.js
```
Result on 2026-11-04 21:12 IST: 28 tests, 28 pass. Tests run against `test/mock-zkool.js`, a MOCK GraphQL
server fed by `test/fixtures/mock-zkool-fixture.json`. No real zkool_graphql was run.

Offline UI demo (MOCK data, badge shows MOCK):
```
node test/mock-zkool.js 8002 &       # prints example (fake) uivktest1… / uviewtest1… keys
node bin/hisaab.js serve             # http://127.0.0.1:4040/
```
In the mock, account #1 has a "seed" and can `pay`; that puts the tx in the target's mempool and the next
`synchronize` mines it. This allows a full invoice → seen → paid loop without a chain.

## Layout
- `src/amount.js`: decimal ZEC ↔ integer zats. All math is in zats.
- `src/zkool.js`: GraphQL client. It uses variables everywhere, surfaces `errors[].message` as `ZkoolError`, and never requests `seed` except in `hasSeed()`, which reduces it to a boolean.
- `src/ledger.js`: pure rows, FY, totals and CSV, plus `fetchInrRate` (the one impure part: CoinGecko, 5 s timeout, cache in `data/inr-cache.json`).
- `src/invoices.js`: codes, memo, ZIP 321, address validation, matching, and `data/invoices.json` (dir 700, file 600, atomic write).
- `src/receipt.js`: receipt and canonical-JSON sha256 hash, and `verifyReceipt`.
- `src/pack.js`: the CA pack and `readonlyProof`.
- `src/service.js`: the app layer shared by the CLI and the server (config in `data/config.json`, mode 600).
- `src/server.js` and `web/index.html`: local UI. `src/index.js` is the library entry.
- `bin/hisaab.js`: CLI with its own `.env` loader (`src/env.js`).

## Decisions
- **Units.** zkool `BigDecimal` is serialized by juniper as a decimal-ZEC *string* with scale 8, e.g. `"0.01000000"`. The repo's `example/sh` does `tonumber` on it. The client converts it with `zecToZats`. `pay` sends the amount as a decimal string.
- **Time.** `Transaction.time` is a chrono `NaiveDateTime` (UTC). The juniper 0.17 string format is not verified, so `parseZkoolTime` accepts `T` or a space, with or without `Z`, and unix seconds.
- **Rows.**
  - When a tx's net `value` ≥ 0, each `scope: 0` note becomes one `in` row.
  - When net < 0, the tx becomes one `out` row (net value incl. fee, plus fee). Its scope-0 notes become `self` rows, which never count as income. This handles self-sends.
  - `scope: 1` is change and is skipped.
  - Mempool txs (`unconfirmedByAccount`) not yet mined become `seen` rows. They are excluded from FY totals because they have no block time.
- **Status.** Confirmations = tip − height + 1. A row is `confirmed` once confirmations ≥ `HISAAB_CONFIRMATIONS` (default 1), otherwise `mined`. With no height it is `seen`.
- **Indian FY.** "2026-27" runs from 2026-04-01 00:00:00 IST to 2027-03-31 23:59:59.999 IST and is filtered on block time.
- **CSV.**
  - Amounts are always non-negative, in separate `received_zec`, `sent_zec` and `fee_zec` columns, so the injection guard never mangles a number.
  - Cells starting with `= + - @ \t \r` get a `'` prefix. Escaping follows RFC 4180 and lines end in CRLF.
  - The INR columns are opt-in (`--inr` / `?inr=1`). Their headers say "mainnet ZEC/INR … testnet TAZ has no value".
- **Invoice matching.**
  - The memo must contain the code (case-insensitive). Scope-0 notes of one txid carrying the code are summed.
  - Invoices are processed oldest first, and each txid is claimed by at most one invoice.
  - Once an invoice holds a txid, it keeps it.
  - Status:
    - exact amount and confirmed → `paid`
    - exact amount, still in mempool or mined but not yet confirmed → `seen` (`paymentState` says which)
    - less than the amount → `underpaid`
    - more than the amount → `overpaid`
- **Addresses.**
  - Only `utest1…` (≥100 bech32 chars) and `ztestsapling1…` are accepted.
  - Mainnet addresses (u1/zs1/t1/t3) and transparent testnet addresses (tm/t2/textest) are rejected, with a reason given.
  - There is no bech32m checksum check (zero deps). zkool generates the address itself.
- **Viewing key input.**
  - Only `^uviewtest1[bech32]{100,}$` is accepted. Input containing whitespace is refused as a likely seed phrase.
  - The error text never echoes the input.
  - `connect` also refuses an account if zkool reports a seed for it.
- **Read-only proof.** `pay` is attempted only after `hasSeed()` says false. It sends 0.00001 TAZ to the account's own UA, and the exact error text and timestamp are recorded. If zkool has a seed for the account, the attempt is skipped, so it is never a real spend.
- **Server.**
  - Hardcoded bind to 127.0.0.1.
  - Host header must be `127.0.0.1:port` or `localhost:port` (DNS-rebinding guard, otherwise 421).
  - POST is refused for a foreign `Origin` or `Sec-Fetch-Site: cross-site` (403) and for non-JSON content types (415, which blocks simple-form CSRF).
  - Strict CSP, no CDN.
- **Mode badge.** REAL vs MOCK comes from `apiVersion`: real zkool answers `"1.0"`, the mock answers `"mock-1.0"`.
- **Pack.**
  - The directory is `out/hisaab-FY<fy>-<YYYYMMDD-HHMM IST>/`, with files mode 600.
  - `MANIFEST.sha256` holds `sha256sum -c`-compatible lines for every file except itself.
  - There is one receipt per incoming txid in the FY.

## Spec change 1: incoming viewing keys (UIVK)
- `validateViewingKey(key, network)` accepts `uviewtest1…` (kind `full`) and `uivktest1…` (kind `incoming-only`).
  It refuses seed phrases (whitespace), spending keys (`secret-extended-key…`, `usk…`) and anything else.
- `connect` takes `key` (the old `ufvk` field still works as an alias) and stores `keyKind` in `data/config.json`.
  - Dedupe only reuses an account of the same kind (zkool `accounts{incomingOnly}`), so a UIVK never silently maps onto a full-key account.
  - A same-name, different-kind account is refused with 409.
- `status.account.keyKind` comes from zkool's `incomingOnly` when available. The UI shows a "key incoming-only (UIVK)" chip.
- With a UIVK the ledger has only `in` rows. Totals carry `spendsVisible: false` and `note: "incoming-only key: spends not visible"`; the UI and CLI show the note in place of sent/fees/net.
- `ledger.json` gets `key_kind`, `spends_visible` and `note`. Receipts get `viewing_key_kind`.
- README-for-CA states the key kind and recommends the UIVK as the narrowest key.
- Dedupe on a UIVK account uses `unifiedFullViewingKey(idAccount, incoming: true)`.

## Spec change 2: HISAAB_NETWORK = test (default) | main
- `src/network.js` holds the per-network prefix table, and `EXPLORER_TX` holds both explorer templates in one constant.
- Viewing keys:
  - test: `uviewtest1` / `uivktest1`
  - main: `uview1` / `uivk1`
- Invoice addresses:
  - test: `utest1` / `ztestsapling1`
  - main: `u1` / `zs1`
  - Transparent addresses are always rejected.
- A key or address from the other network is refused with "Networks are never mixed".
- `data/config.json` records the network. A data dir created for one network is refused when run under the other (use a separate `HISAAB_DATA_DIR`).
- Mainnet is watch-only:
  - `createZkool({network:'main'}).pay` throws locally and never sends the request.
  - `readonlyProof` on mainnet does not call `pay`. It records `skipped-mainnet` plus the zkool "no seed" check. I chose the hard rule "no code path calls pay on mainnet" over performing the proof.
- The network label (TESTNET grey / MAINNET amber badge) appears in:
  - the UI header
  - `/api/status` (`network`, `networkLabel`, `chain`, `coin`)
  - `ledger.json` (`network`, `network_label`, `coin`)
  - receipts (`network`, `network_label`)
  - README-for-CA and `readonly-proof.txt`
  - the CLI output
- Mainnet pack directories are named `hisaab-MAINNET-FY…`. The mainnet INR CSV header has no "testnet TAZ" wording.
- The mock server is testnet-only. Mainnet behaviour is tested with pure functions and a stub zkool in `buildPack`.

## To verify against a real zkool_graphql
1. `{ transactionsByAccount(idAccount: N) { id txid height time value fee notes { pool value address scope memo } } }`: check the exact `time` string format and that `value`/`fee` are strings.
2. `mutation($na: NewAccount!) { createAccount(newAccount: $na) }` with `{name, key: "uviewtest1…", aindex: 0, birth, useInternal: false}`.
3. `query($f: AccountFilter) { accounts(accountFilter: $f) { id seed } }`: check that `seed` is null for a UFVK account.
4. `mutation($id: Int!, $p: Payment!) { pay(idAccount: $id, payment: $p) }`: check that a string `amount` is accepted as BigDecimal input, and that a watch-only account returns `No Signing Key`, not a planning error such as insufficient funds, when the balance is 0.
5. `unconfirmedByAccount { txid value notes { pool scope value address memo } }`: check that the mempool notes carry the memo.
6. `unifiedFullViewingKey(idAccount)` / `(idAccount, incoming: true)`: check whether it re-encodes the imported key (used for dedupe) and whether it errors on a UIVK account without `incoming`.
7. `accounts { incomingOnly }` is true for an account created from a `uivktest1…` key, and `transactionsByAccount` on it lists received notes only.
8. `pay` on a UIVK account: check the exact error text (expected "No Signing Key"; may differ).
