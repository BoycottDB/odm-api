/**
 * Netlify Function - Health check
 */
import { createClient } from '@supabase/supabase-js';
import { initSentry, sentryHandler } from './utils/sentry.js';

// Initialiser Sentry
initSentry();

const healthHandler = async (event) => {
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

  // Test connexion Supabase
  let supabaseStatus = 'unknown';
  let dbResponseTime = 0;
  try {
    const start = Date.now();
    const supabase = createClient(
      process.env.SUPABASE_URL, 
      process.env.SUPABASE_ANON_KEY
    );
    await supabase.from('Marque').select('id').limit(1);
    dbResponseTime = Date.now() - start;
    supabaseStatus = 'connected';
  } catch (error) {
    supabaseStatus = 'error';
    console.error('Supabase health check failed:', error.message);
  }

  const response = {
    status: supabaseStatus === 'connected' ? 'OK' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    service: 'ODM API - Netlify',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'production',
    services: {
      database: {
        status: supabaseStatus,
        responseTime: dbResponseTime > 0 ? `${dbResponseTime}ms` : 'N/A'
      },
      functions: 'OK'
    }
  };

  return {
    statusCode: supabaseStatus === 'connected' ? 200 : 503,
    headers: {
      ...headers,
      'X-Data-Source': 'odm-api-health'
    },
    body: JSON.stringify(response)
  };
};

export const handler = sentryHandler(healthHandler);