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

// ── /api/supabase ─────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}

app.post('/api/supabase', async (req, res) => {
  const { action, table, select, filters = {}, data, onConflict, ignoreDuplicates } = req.body ?? {};
  if (!action || !table) return res.status(400).json({ error: 'Missing action or table' });

  try {
    let url, method, body, headers = sbHeaders();

    if (action === 'select') {
      const params = new URLSearchParams();
      if (select) params.set('select', select);
      Object.entries(filters).forEach(([k, v]) => params.set(k, v));
      url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
      method = 'GET';
    } else if (action === 'upsert') {
      const prefer = ['return=representation'];
      if (ignoreDuplicates) prefer.push('resolution=ignore-duplicates');
      else if (onConflict) prefer.push('resolution=merge-duplicates');
      headers['Prefer'] = prefer.join(',');
      const params = new URLSearchParams();
      if (onConflict) params.set('on_conflict', onConflict);
      url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
      method = 'POST';
      body = JSON.stringify(Array.isArray(data) ? data : [data]);
    } else if (action === 'update') {
      const qs = Object.entries(filters).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      url = `${SUPABASE_URL}/rest/v1/${table}${qs ? '?' + qs : ''}`;
      method = 'PATCH';
      body = JSON.stringify(data);
    } else {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    const response = await fetch(url, { method, headers, body });
    const text = await response.text();
    if (!response.ok) return res.status(response.status).json({ error: text });
    return res.json({ data: text ? JSON.parse(text) : [], error: null });
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