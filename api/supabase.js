// api/supabase.js — Proxy Supabase pour éviter les erreurs CSP de Discord Activity
// Toutes les requêtes Supabase du frontend passent par ici.
//
// Format de la requête :
//   POST /api/supabase
//   Body JSON : { action, table, ...params }
//
// Actions disponibles :
//   select  : { action:'select', table, select, filters }
//   upsert  : { action:'upsert', table, data, onConflict, ignoreDuplicates }
//   update  : { action:'update', table, data, filters }

const SUPABASE_URL = process.env.VITE_SUPABASE_URL  || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

function supabaseHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}

// Construit la query string de filtres  ex: { discord_id: 'eq.123' }
function buildFilters(filters = {}) {
  return Object.entries(filters)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

export default async function handler(req, res) {
  // CORS pour Discord Activity
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { action, table, select, filters = {}, data, onConflict, ignoreDuplicates } = req.body ?? {};

  if (!action || !table) return res.status(400).json({ error: 'Missing action or table' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  try {
    let url, method, body, headers = supabaseHeaders();

    if (action === 'select') {
      // GET avec select + filtres
      const params = new URLSearchParams();
      if (select) params.set('select', select);
      Object.entries(filters).forEach(([k, v]) => params.set(k, v));
      // Pour .single() on accepte un seul résultat
      headers['Accept'] = 'application/json';
      url    = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
      method = 'GET';

    } else if (action === 'upsert') {
      // POST avec Prefer: resolution=merge-duplicates
      const prefer = ['return=representation'];
      if (onConflict)       prefer.push(`resolution=merge-duplicates`);
      if (ignoreDuplicates) prefer.push('resolution=ignore-duplicates');
      headers['Prefer'] = prefer.join(',');
      if (onConflict) headers['on_conflict'] = onConflict; // non standard mais utile
      const params = new URLSearchParams();
      if (onConflict) params.set('on_conflict', onConflict);
      url    = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
      method = 'POST';
      body   = JSON.stringify(Array.isArray(data) ? data : [data]);

    } else if (action === 'update') {
      // PATCH avec filtres
      const filterStr = buildFilters(filters);
      url    = `${SUPABASE_URL}/rest/v1/${table}${filterStr ? '?' + filterStr : ''}`;
      method = 'PATCH';
      body   = JSON.stringify(data);

    } else {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    const response = await fetch(url, { method, headers, body });
    const text = await response.text();

    if (!response.ok) {
      console.error(`[/api/supabase] ${action} ${table} → ${response.status}`, text);
      return res.status(response.status).json({ error: text });
    }

    const result = text ? JSON.parse(text) : [];
    return res.status(200).json({ data: result, error: null });

  } catch (err) {
    console.error('[/api/supabase]', err);
    return res.status(500).json({ error: err.message });
  }
}