// Tiny static server for the harness; POST /result stores the results as result_<timestamp>.json.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8765;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' };

http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST' && u === '/result') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      fs.writeFileSync(path.join(__dirname, 'result_' + Date.now() + '.json'), body);
      res.end('ok');
    });
    return;
  }
  const f = path.join(__dirname, u === '/' ? 'harness.html' : u);
  if (!f.startsWith(__dirname) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log('harness on http://localhost:' + PORT + '/harness.html'));
