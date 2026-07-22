import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Config } from './core/config.ts';
import { buildStats } from './core/stats.ts';
import { sync } from './core/sync.ts';
import { dict, resolveLang } from './core/i18n.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = join(HERE, 'web', 'index.html');

export function serve(cfg: Config): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      try {
        if (url.pathname === '/api/stats') {
          // ?lang= 으로 서버 재시작 없이 언어를 바꾼다
          const q = url.searchParams.get('lang');
          const view = q ? { ...cfg, lang: resolveLang(q) } : cfg;
          // 새로고침할 때마다 원본을 다시 훑는다 (1MB 남짓 — 충분히 싸다)
          sync(cfg);
          const body = JSON.stringify(buildStats(view));
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
          res.end(body);
          return;
        }
        if (url.pathname === '/' || url.pathname === '/index.html') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(readFileSync(INDEX));
          return;
        }
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(dict(cfg.lang).cli.notFound);
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
    });

    server.on('error', reject);
    server.listen(cfg.port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${cfg.port}`;
      const C = dict(cfg.lang).cli;
      console.log(C.dashboardAt(url));
      console.log(C.stopHint);
      const stop = () => {
        server.close(() => resolve());
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    });
  });
}
