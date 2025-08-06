/**
 * Brands API index - lists available endpoints
 */
export default function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.status(200).json({
    service: 'Brands API',
    status: 'OK',
    timestamp: new Date().toISOString(),
    endpoints: {
      version: '/api/brands/version',
      updates: '/api/brands/updates?since=2024-01-01T00:00:00.000Z',
      full: '/api/brands/full'
    },
    description: 'API pour les données des marques du Répertoire Collaboratif des Marques à Boycotter'
  });
}