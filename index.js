/**
 * Root endpoint - redirects to API
 */
export default function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Redirect to API info
  res.status(200).json({
    message: 'Extension API - Répertoire des Marques à Boycotter',
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    endpoints: {
      health: '/api',
      version: '/api/brands/version',
      updates: '/api/brands/updates?since=2024-01-01T00:00:00.000Z',
      full: '/api/brands/full',
      stats: '/api/stats'
    },
    documentation: 'https://github.com/your-repo/extension-api'
  });
}