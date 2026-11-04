// Minimal GraphQL client for zkool_graphql (hhanh00/zkool2, rust/src/graphql).
//
// Units: zkool returns every amount as a GraphQL BigDecimal scalar, which
// juniper serializes as a decimal-ZEC *string* with scale 8 ("0.01000000").
// This client returns those strings untouched; callers convert with
// `zecToZats` from ./amount.js before doing any math. `pay` takes decimal ZEC.
// `time` on transactions is a chrono NaiveDateTime (block time, UTC, no zone).

export class ZkoolError extends Error {
  /**
   * @param {string} message
   * @param {{errors?: any[], status?: number, cause?: any}} [extra]
   */
  constructor(message, extra = {}) {
    super(message, extra.cause ? { cause: extra.cause } : undefined);
    this.name = 'ZkoolError';
    this.errors = extra.errors || [];
    this.status = extra.status;
  }
}

const TX_FIELDS = 'id txid height time value fee notes { pool value address scope memo }';

/**
 * @typedef {{pool:number, value:string, address:string, scope:number, memo:string|null}} ZkNote
 * @typedef {{id:number, txid:string, height:number, time:string, value:string, fee:string, notes:ZkNote[]}} ZkTx
 * @typedef {{txid:string, value:string, notes:{pool:number,scope:number,value:string,address:string|null,memo:string|null}[]}} ZkUnconfirmed
 * @typedef {{id:number, name:string, birth:number, height:number, balance:string, incomingOnly:boolean}} ZkAccount
 */

/**
 * @param {{url?: string, fetchImpl?: typeof fetch, timeoutMs?: number, network?: 'test'|'main'}} opts
 *   network 'main' → `pay` is refused locally and never sent (mainnet is watch-only).
 */
export function createZkool({ url = 'http://127.0.0.1:8002/graphql', fetchImpl = fetch, timeoutMs = 300_000, network = 'test' } = {}) {
  /**
   * @param {string} query
   * @param {Record<string, any>} [variables]
   * @param {{timeoutMs?: number}} [o]
   */
  async function gql(query, variables = {}, o = {}) {
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(o.timeoutMs ?? timeoutMs),
      });
    } catch (e) {
      throw new ZkoolError(`zkool unreachable at ${url}: ${e?.cause?.code || e?.message || e}`, { cause: e });
    }
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ZkoolError(`zkool returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`, { status: res.status });
    }
    if (Array.isArray(body.errors) && body.errors.length) {
      const msg = body.errors.map((e) => e?.message ?? String(e)).join('; ');
      throw new ZkoolError(msg, { errors: body.errors, status: res.status });
    }
    if (!res.ok) throw new ZkoolError(`zkool HTTP ${res.status}`, { status: res.status });
    if (!body.data) throw new ZkoolError('zkool response had no data');
    return body.data;
  }

  return {
    url,
    network,
    gql,
    /** "1.0" on the real server; the test mock answers "mock-…". */
    async apiVersion() {
      return (await gql('{ apiVersion }')).apiVersion;
    },
    /** @returns {Promise<number>} chain tip seen by zkool's light-wallet server */
    async currentHeight() {
      return (await gql('{ currentHeight }')).currentHeight;
    },
    /**
     * Create an account. For watch-only pass a `uviewtest…` UFVK as `key` and a `birth`.
     * @param {{name:string, key:string, birth?:number, aindex?:number, useInternal?:boolean}} a
     * @returns {Promise<number>} new account id
     */
    async createAccount({ name, key, birth, aindex = 0, useInternal = false }) {
      /** @type {Record<string, any>} */
      const na = { name, key, aindex, useInternal };
      if (birth !== undefined && birth !== null) na.birth = birth;
      const d = await gql('mutation($na: NewAccount!) { createAccount(newAccount: $na) }', { na });
      return d.createAccount;
    },
    /** @returns {Promise<ZkAccount[]>} (never requests `seed`/`passphrase`) */
    async listAccounts() {
      return (await gql('{ accounts { id name birth height balance incomingOnly } }')).accounts;
    },
    /**
     * True if zkool holds a seed for this account. The seed itself is reduced
     * to a boolean here and never returned, logged or stored.
     * @param {number} id
     */
    async hasSeed(id) {
      const d = await gql('query($f: AccountFilter) { accounts(accountFilter: $f) { id seed } }', { f: { id } });
      const a = d.accounts?.[0];
      if (!a) throw new ZkoolError(`Unknown account ${id}`);
      return typeof a.seed === 'string' && a.seed.length > 0;
    },
    /** @param {number} id @param {number} [pools] @returns {Promise<{ua:string|null, transparent:string|null, sapling:string|null, orchard:string|null, ironwood:string|null}>} */
    async address(id, pools) {
      const d = await gql(
        'query($id: Int!, $pools: Int) { addressByAccount(idAccount: $id, pools: $pools) { ua transparent sapling orchard ironwood } }',
        { id, pools: pools ?? null },
      );
      return d.addressByAccount;
    },
    /**
     * Export the account's viewing key: UFVK (uviewtest…) by default, UIVK (uivktest…) with `incoming`.
     * @param {number} id @param {{incoming?: boolean}} [o] @returns {Promise<string>}
     */
    async ufvk(id, { incoming = false } = {}) {
      return (await gql('query($id: Int!, $inc: Boolean) { unifiedFullViewingKey(idAccount: $id, incoming: $inc) }', { id, inc: incoming }))
        .unifiedFullViewingKey;
    },
    /** @param {number[]} ids @returns {Promise<number>} synced height */
    async synchronize(ids, { fast = false } = {}) {
      return (await gql('mutation($ids: [Int!]!, $fast: Boolean) { synchronize(idAccounts: $ids, fast: $fast) }', { ids, fast }))
        .synchronize;
    },
    /** @param {number} id @returns {Promise<ZkTx[]>} */
    async transactions(id) {
      return (await gql(`query($id: Int!) { transactionsByAccount(idAccount: $id) { ${TX_FIELDS} } }`, { id }))
        .transactionsByAccount;
    },
    /** @param {number} id @param {string} txid @returns {Promise<ZkTx>} */
    async transactionById(id, txid) {
      return (await gql(`query($id: Int!, $txid: String!) { transactionById(idAccount: $id, txid: $txid) { ${TX_FIELDS} } }`, { id, txid }))
        .transactionById;
    },
    /** Mempool view. Keeps listing txids after they are mined. @param {number} id @returns {Promise<ZkUnconfirmed[]>} */
    async unconfirmed(id) {
      return (await gql('query($id: Int!) { unconfirmedByAccount(idAccount: $id) { txid value notes { pool scope value address memo } } }', { id }))
        .unconfirmedByAccount;
    },
    /** @param {number} id */
    async balance(id) {
      return (await gql('query($id: Int!) { balanceByAccount(idAccount: $id) { height transparent sapling orchard ironwood total } }', { id }))
        .balanceByAccount;
    },
    /**
     * @param {number} id
     * @param {{recipients: {address:string, amount:string, memo?:string}[], confirmations?: number}} payment amounts in decimal ZEC
     * @returns {Promise<string>} txid
     */
    async pay(id, { recipients, confirmations = 1 }) {
      if (network !== 'test') throw new ZkoolError('Hisaab never calls pay on mainnet (watch-only mode)');
      return (await gql('mutation($id: Int!, $p: Payment!) { pay(idAccount: $id, payment: $p) }', { id, p: { recipients, confirmations } }, { timeoutMs: 120_000 }))
        .pay;
    },
    /** @param {number} id @param {number} idTransaction (zkool's per-account row id, not the txid) @returns {Promise<string[]>} */
    async memosByTransaction(id, idTransaction) {
      return (await gql('query($id: Int!, $tx: Int!) { memosByTransaction(idAccount: $id, idTransaction: $tx) }', { id, tx: idTransaction }))
        .memosByTransaction;
    },
  };
}

/** @typedef {ReturnType<typeof createZkool>} Zkool */
