import { createServer, type Server } from 'node:http';
import { renderMetrics } from './metrics.js';

/**
 * Servidor interno: /health responde 200 só com o gateway do Discord pronto (usado pelo healthcheck do
 * Docker) e /metrics expõe as métricas para o Prometheus. Não é publicado no host.
 */
export function startHealthServer(port: number, isReady: () => boolean): Server {
	const server = createServer((request, response) => {
		if (request.url === '/health') {
			const ready = isReady();
			response.writeHead(ready ? 200 : 503, { 'content-type': 'text/plain; charset=utf-8' });
			response.end(ready ? 'ok\n' : 'sem conexão com o Discord\n');
			return;
		}

		if (request.url === '/metrics') {
			response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
			response.end(renderMetrics());
			return;
		}

		response.writeHead(404).end();
	});

	server.listen(port, '0.0.0.0');
	return server;
}
