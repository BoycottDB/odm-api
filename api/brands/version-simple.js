/**
 * Simple version endpoint without Supabase for testing
 */
export default function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple mock response
  const version = {
    version: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    totalBrands: 7,
    totalEvents: 15,
    checksum: `7-15-${Date.now()}`,
    source: 'mock-data',
    timestamp: new Date().toISOString()
  };

  res.status(200).json(version);
}