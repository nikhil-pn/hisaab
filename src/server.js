// Local web UI + JSON API. Binds 127.0.0.1 only; rejects cross-origin POSTs
// and foreign Host headers (DNS rebinding).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fyOf } from './ledger.js';

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const MAX_BODY = 16 * 1024;

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * @param {import('./service.js').Hisaab} hisaab
 * @param {{port?: number, host?: string}} [opts]
 * @returns {Promise<{server: import('node:http').Server, url: string, port: number, close: () => Promise<void>}>}
 */
export async function startServer(hisaab, { port = 4040, host = '127.0.0.1' } = {}) {
  if (host !== '127.0.0.1') throw new Error('Hisaab only binds 127.0.0.1');
  let actualPort = port;
  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      const status = e?.status || (e?.name === 'ZkoolError' ? 502 : 500);
      send(res, status, { error: e?.message || String(e) });
    });
  });

  /** @param {import('node:http').ServerResponse} res @param {number} status @param {unknown} body */
  function send(res, status, body) {
    if (res.headersSent) return res.end();
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
    res.end(JSON.stringify(body));
  }

  /** @param {import('node:http').IncomingMessage} req */
  function allowedOrigins() {
    return new Set([`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`]);
  }

  /** @param {import('node:http').IncomingMessage} req @returns {Promise<any>} */
  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      /** @type {Buffer[]} */
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text) return resolve({});
        try { resolve(JSON.parse(text)); } catch { reject(Object.assign(new Error('invalid JSON body'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  async function handle(req, res) {
    const url = new URL(req.url || '/', `http://127.0.0.1:${actualPort}`);
    const hostHeader = String(req.headers.host || '');
    if (!allowedOrigins().has(`http://${hostHeader}`)) return send(res, 421, { error: 'unexpected Host header' });

    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin !== undefined && !allowedOrigins().has(String(origin))) return send(res, 403, { error: 'cross-origin request rejected' });
      const site = req.headers['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none') return send(res, 403, { error: 'cross-site request rejected' });
      const ct = String(req.headers['content-type'] || '');
      if (ct && !ct.startsWith('application/json')) return send(res, 415, { error: 'send application/json' });
    }

    const route = `${req.method} ${url.pathname}`;
    switch (route) {
      case 'GET /':
      case 'GET /index.html': {
        const html = readFileSync(join(WEB_DIR, 'index.html'));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP, ...SECURITY_HEADERS });
        return res.end(html);
      }
      case 'GET /api/status':
        return send(res, 200, await hisaab.status());
      case 'POST /api/connect': {
        const b = await readJson(req);
        return send(res, 200, await hisaab.connect({ key: b.key ?? b.ufvk, birth: b.birth, name: b.name }));
      }
      case 'POST /api/sync':
        return send(res, 200, await hisaab.sync());
      case 'GET /api/ledger':
        return send(res, 200, await hisaab.ledger(url.searchParams.get('fy') || undefined));
      case 'POST /api/invoices': {
        const b = await readJson(req);
        return send(res, 200, await hisaab.newInvoice({ amount: b.amount, description: b.description }));
      }
      case 'GET /api/invoices':
        return send(res, 200, await hisaab.listInvoices());
      case 'POST /api/pack': {
        const r = await hisaab.pack({ fy: url.searchParams.get('fy') || undefined, inr: url.searchParams.get('inr') === '1' });
        return send(res, 200, { mode: await hisaab.mode(), path: r.dir, files: r.files, manifestSha256: r.manifestSha256, totals: r.totals, readonlyProof: { result: r.readonlyProof.result, error: r.readonlyProof.error, attemptedAt: r.readonlyProof.attemptedAt } });
      }
      case 'GET /api/pack/download': {
        const { fy, csv } = await hisaab.ledgerCsvText({ fy: url.searchParams.get('fy') || fyOf(new Date()), inr: url.searchParams.get('inr') === '1' });
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="hisaab-ledger-FY${fy}.csv"`, ...SECURITY_HEADERS });
        return res.end(csv);
      }
      default:
        return send(res, 404, { error: 'not found' });
    }
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(undefined));
  });
  const addr = server.address();
  actualPort = typeof addr === 'object' && addr ? addr.port : port;
  return {
    server,
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}/`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
