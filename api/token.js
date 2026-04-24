// api/token.js — échange le code OAuth Discord contre un access_token
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code } = req.body ?? {};
  if (!code) return res.status(400).json({ error: 'Missing code' });

  try {
    const response = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[/api/token] Discord error:', err);
      return res.status(400).json({ error: 'Token exchange failed', detail: err });
    }

    const data = await response.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ access_token: data.access_token });
  } catch (err) {
    console.error('[/api/token]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
