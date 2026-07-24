import http from 'node:http';

const port = Number(process.env.FRONTEND_PORT);
const target = Number(process.env.BACKEND_PORT);
if (!Number.isInteger(port) || !Number.isInteger(target) || port === target) throw new Error('Distinct BACKEND_PORT and FRONTEND_PORT are required');
const server = http.createServer((req, res) => {
  const upstream = http.request({ hostname: '127.0.0.1', port: target, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${target}` } }, (response) => {
    res.writeHead(response.statusCode || 502, response.headers);
    response.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end('Upstream unavailable'); });
  req.pipe(upstream);
});
server.listen(port, '127.0.0.1', () => console.log(`QuickBooks UI proxy listening on 127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
