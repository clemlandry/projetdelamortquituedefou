// api/image.js — proxy d'images pour éviter les problèmes CORS/CSP dans l'Activity Discord
export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) return res.status(400).json({ error: 'Missing url param' });

  let decoded;
  try {
    decoded = decodeURIComponent(url);
    new URL(decoded); // valide que c'est bien une URL
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Sécurité minimale : on bloque les URLs locales/privées
  const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '192.168.', '10.', '172.'];
  if (blocked.some(b => decoded.includes(b))) {
    return res.status(403).json({ error: 'Blocked URL' });
  }

  try {
    const upstream = await fetch(decoded, {
      headers: { 'User-Agent': 'HxH-RPG-Activity/1.0' },
    });

    if (!upstream.ok) return res.status(upstream.status).end();

    const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return res.status(415).json({ error: 'Not an image' });
    }

    const buffer = await upstream.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    console.error('[/api/image]', err);
    return res.status(500).json({ error: 'Fetch failed' });
  }
}
