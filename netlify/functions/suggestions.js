/**
 * Netlify Function - Ultra-fast suggestions for auto-completion
 * Returns minimal data (id + nom only) for optimal performance
 */
import { createClient } from '@supabase/supabase-js';
import { MetricsLogger } from './utils/metrics.js';
import { initSentry, sentryHandler } from './utils/sentry.js';
import { createServerlessCache } from './utils/serverlessCache.js';

// Cache spécialisé pour cette fonction
const cache = createServerlessCache('suggestions');

// Initialiser Sentry
initSentry();

// Configuration Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase configuration');
}

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
}) : null;

// Utilisation du cache unifié
// TTL géré automatiquement par unifiedCache selon l'endpoint

const suggestionsHandler = async (event) => {
  const startTime = Date.now();
  const functionName = 'suggestions';
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { q, limit = '10' } = event.queryStringParameters || {};

    // Valider query minimum
    if (!q || q.trim().length < 1) {
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'X-Data-Source': 'odm-api-suggestions-empty'
        },
        body: JSON.stringify([])
      };
    }

    // Check cache serverless optimisé
    const params = { q: q.toLowerCase().trim(), limit };
    const cached = cache.get('suggestions', params);

    if (cached) {
      MetricsLogger.logCache(functionName, true);
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'X-Data-Source': 'odm-api-suggestions-cache-unified',
          'X-Cache': 'HIT'
        },
        body: JSON.stringify(cached)
      };
    }

    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    // Requête ultra-optimisée : seulement id + nom
    const { data: marques, error } = await supabase
      .from('Marque')
      .select('id, nom')
      .ilike('nom', `%${q.trim()}%`)
      .limit(parseInt(limit))
      .order('nom');

    if (error) throw error;

    const suggestions = marques || [];

    // Cache serverless avec TTL automatique (5 minutes pour suggestions)
    cache.set('suggestions', suggestions, params);

    MetricsLogger.logCache(functionName, false);

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'X-Data-Source': 'odm-api-suggestions-unified',
        'X-Cache': 'MISS',
        'X-Query-Time': `${Date.now() - startTime}ms`,
        'X-Cache-Metrics': JSON.stringify(cache.getMetrics())
      },
      body: JSON.stringify(suggestions)
    };

  } catch (error) {
    console.error('Error in suggestions function:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Service temporairement indisponible',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};

export const handler = sentryHandler(suggestionsHandler);