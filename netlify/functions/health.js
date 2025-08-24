/**
 * Netlify Function - Health check
 */
export const handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const response = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'ODM API - Netlify',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'production'
  };

  return {
    statusCode: 200,
    headers: {
      ...headers,
      'X-Data-Source': 'odm-api-health'
    },
    body: JSON.stringify(response)
  };
};