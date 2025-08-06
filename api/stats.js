/**
 * Stats endpoint
 */
export default function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Basic stats (since we can't access NodeCache in serverless)
  const stats = {
    server: {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      platform: 'node-server',
      memory: process.memoryUsage(),
      version: '1.0.0'
    },
    cache: {
      note: 'Cache stats available in server mode',
      strategy: 'In-memory server cache'
    },
    endpoints: [
      '/health',
      '/api/brands/version',
      '/api/brands/updates',
      '/api/brands/full',
      '/api/stats'
    ]
  };

  res.status(200).json(stats);
}