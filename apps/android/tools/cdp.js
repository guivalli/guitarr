// uso: node cdp.js '<expressão JS>'  -> avalia no WebView do app (devtools em localhost:9222) e imprime o resultado
const http = require('http'), WebSocket = require('ws');
const expr = process.argv[2];
http.get('http://localhost:9222/json', (r) => { let b=''; r.on('data', d=>b+=d); r.on('end', () => {
  const page = JSON.parse(b).find(p => p.type === 'page'); const ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 } })));
  ws.on('message', (m) => { const d = JSON.parse(m); if (d.id !== 1) return; const x = d.result; console.log(x.exceptionDetails ? 'EXC ' + JSON.stringify(x.exceptionDetails.exception || x.exceptionDetails).slice(0, 600) : JSON.stringify(x.result.value)); ws.close(); process.exit(0); });
}); });
