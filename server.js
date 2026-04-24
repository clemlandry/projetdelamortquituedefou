// server.js — serveur local Express pour tester l'Activity avec cloudflared
// Usage : node server.js  (dans le dossier /activity)
// Puis dans un autre terminal : cloudflared tunnel --url http://localhost:3000

import express  from 'express';
import cors     from 'cors';
import { createRequire } from 'module';
import { fileURLToPath }  from 'url';
import path               from 'path';
import { readFileSync }   from 'fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Charge .env manuellement (pas de dotenv ESM natif)
try {
  const envFile = readFileSync(path.join(__dirname, '.env'), 'utf-8');
  for (const line of envFile.split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  }
} catch { /* .env absent — OK en prod */ }

const app  = express();
app.use(cors());
app.use(express.json());

// ── /api/token ────────────────────────────────────────────────────────────────
app.post('/api/token', async (req, res) => {
  const { code } = req.body ?? {};
  if (!code) return res.status(400).json({ error: 'Missing code' });

  const response = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.VITE_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type:    'authorization_code',
      code,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('[/api/token]', err);
    return res.status(400).json({ error: err });
  }

  const data = await response.json();
  return res.json({ access_token: data.access_token });
});

// ── /api/image ────────────────────────────────────────────────────────────────
app.get('/api/image', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    const decoded  = decodeURIComponent(url);
    const upstream = await fetch(decoded);
    const ct       = upstream.headers.get('content-type') ?? 'image/jpeg';
    const buf      = await upstream.arrayBuffer();
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(Buffer.from(buf));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Sert le build Vite en prod locale ─────────────────────────────────────────
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (_, res) => res.sendFile(path.join(distPath, 'index.html')));

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`[Server] ✅  http://localhost:${PORT}`));