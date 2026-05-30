import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for all incoming client requests (local + GitHub Pages)
app.use(cors());

// Parse JSON request bodies
app.use(express.json());

// Log incoming local requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

/**
 * Unified Workflowy API Proxy
 * Proxies POST requests to https://beta.workflowy.com/api/beta/:action/
 * Pass through Authorization header and JSON body
 */
app.post('/api/workflowy/:action', async (req, res) => {
  const { action } = req.params;
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    console.warn(`[Proxy Warning] Missing Authorization header for action: ${action}`);
    return res.status(401).json({ error: 'Authorization header is required' });
  }

  const targetUrl = `https://beta.workflowy.com/api/beta/${action}/`;
  console.log(`[Proxy Request] Forwarding to ${targetUrl}`);

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify(req.body)
    });

    const contentType = response.headers.get('content-type');
    let data;

    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = { text };
    }

    console.log(`[Proxy Response] Status ${response.status} from ${action}`);
    res.status(response.status).json(data);
  } catch (error) {
    console.error(`[Proxy Error] Failed to proxy action: ${action}`, error);
    res.status(500).json({ error: `Failed to connect to Workflowy API for action: ${action}` });
  }
});

// Serve frontend static files in production
const frontendDistPath = path.join(__dirname, 'frontend', 'dist');
app.use(express.static(frontendDistPath));

// Catch-all route to serve the SPA index.html in production
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'), (err) => {
    if (err) {
      // If index.html doesn't exist yet (e.g. before build), return a simple welcome message
      res.status(200).send('Fresh Kitchen Planner backend is running! Frontend is not built yet.');
    }
  });
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🟢 Fresh Kitchen Planner Server is now active!`);
  console.log(`   Local Address: http://localhost:${PORT}`);
  console.log(`==================================================`);
});
