/**
 * Root endpoint - redirects to health check
 */
export default function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Health response at root
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Extension API',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    endpoints: [
      '/api',
      '/api/brands/version',
      '/api/brands/updates',
      '/api/brands/full',
      '/api/stats'
    ]
  });
}