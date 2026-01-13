const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const OUTPUT_DIR = path.join(__dirname, 'output');
const VIEWER_FILE = path.join(__dirname, 'viewer.html');

const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API: List JSON files in output/
  if (req.url === '/api/files' && req.method === 'GET') {
    fs.readdir(OUTPUT_DIR, (err, files) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to read output directory' }));
        return;
      }

      const jsonFiles = files
        .filter(f => f.endsWith('.json'))
        .map(f => ({
          name: f,
          path: `/api/file/${encodeURIComponent(f)}`
        }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(jsonFiles));
    });
    return;
  }

  // API: Update review metadata for a specific test
  if (req.url.startsWith('/api/file/') && req.url.endsWith('/review') && req.method === 'POST') {
    const match = req.url.match(/^\/api\/file\/([^/]+)\/review$/);
    if (!match) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid review path' }));
      return;
    }

    const filename = decodeURIComponent(match[1]);
    const filepath = path.join(OUTPUT_DIR, filename);

    if (!filepath.startsWith(OUTPUT_DIR)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });

    req.on('end', () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
        return;
      }

      const { originalIndex, testId, review } = payload || {};
      if (!review || typeof review !== 'object') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing review payload' }));
        return;
      }

      if (review.tag && review.tag !== 'correct' && review.tag !== 'wrong') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid review tag' }));
        return;
      }

      fs.readFile(filepath, 'utf8', (readErr, data) => {
        if (readErr) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File not found' }));
          return;
        }

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch (parseErr) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Stored file is invalid JSON' }));
          return;
        }

        const tests = parsed?.results?.results;
        if (!Array.isArray(tests)) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Results array not found in file' }));
          return;
        }

        let targetIndex = typeof originalIndex === 'number' ? originalIndex : -1;
        if (targetIndex < 0 || targetIndex >= tests.length) {
          targetIndex = tests.findIndex(t => t && t.id === testId);
        }

        if (targetIndex < 0 || targetIndex >= tests.length) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Test case not found' }));
          return;
        }

        const targetTest = tests[targetIndex];
        if (!targetTest.metadata || typeof targetTest.metadata !== 'object') {
          targetTest.metadata = {};
        }

        const sanitizedReview = {
          tag: review.tag ?? null,
          notes: typeof review.notes === 'string' ? review.notes : ''
        };

        if (sanitizedReview.tag === null && sanitizedReview.notes.trim() === '') {
          delete targetTest.metadata.review;
        } else {
          targetTest.metadata.review = sanitizedReview;
        }

        fs.writeFile(filepath, JSON.stringify(parsed, null, 2), 'utf8', (writeErr) => {
          if (writeErr) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to persist review' }));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, review: targetTest.metadata.review || null }));
        });
      });
    });

    return;
  }

  // API: Get specific JSON file content
  if (req.url.startsWith('/api/file/') && req.method === 'GET') {
    const filename = decodeURIComponent(req.url.replace('/api/file/', ''));
    const filepath = path.join(OUTPUT_DIR, filename);

    // Security: prevent directory traversal
    if (!filepath.startsWith(OUTPUT_DIR)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }

    fs.readFile(filepath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
    return;
  }

  // API: Delete specific JSON file
  if (req.url.startsWith('/api/file/') && req.method === 'DELETE') {
    const filename = decodeURIComponent(req.url.replace('/api/file/', ''));
    const filepath = path.join(OUTPUT_DIR, filename);

    // Security: prevent directory traversal
    if (!filepath.startsWith(OUTPUT_DIR)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }

    fs.unlink(filepath, (err) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to delete file' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // Serve viewer.html
  if (req.url === '/' || req.url === '/viewer.html') {
    fs.readFile(VIEWER_FILE, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading viewer');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n✅ CheckMate Eval Viewer running at http://localhost:${PORT}\n`);
  console.log(`   Serving files from: ${OUTPUT_DIR}\n`);
});
