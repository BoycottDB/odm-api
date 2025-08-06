/**
 * Simple test endpoint
 */
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ 
    message: 'Test endpoint works!',
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url
  });
}