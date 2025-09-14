/**
 * Netlify Function - Ultra-fast suggestions for auto-completion
 * Returns minimal data (id + nom only) for optimal performance
 */
import { createClient } from '@supabase/supabase-js';
import { MetricsLogger } from './utils/metrics.js';
import { initSentry, sentryHandler } from './utils/sentry.js';

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

// Cache spécialisé pour suggestions (TTL plus court pour freshness)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes pour suggestions temps réel

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

    // Check cache optimisé pour suggestions
    const cacheKey = `suggestions_${q.toLowerCase().trim()}_${limit}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);

    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      MetricsLogger.logCache(functionName, true);
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'X-Data-Source': 'odm-api-suggestions-cache',
          'X-Cache': 'HIT'
        },
        body: JSON.stringify(cached.data)
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

    // Cache les résultats
    cache.set(cacheKey, {
      data: suggestions,
      timestamp: now
    });

    // Nettoyage périodique du cache (garde seulement les 100 plus récents)
    if (cache.size > 100) {
      const entries = Array.from(cache.entries());
      entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      cache.clear();
      entries.slice(0, 100).forEach(([key, value]) => {
        cache.set(key, value);
      });
    }

    MetricsLogger.logCache(functionName, false);

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'X-Data-Source': 'odm-api-suggestions',
        'X-Cache': 'MISS',
        'X-Query-Time': `${Date.now() - startTime}ms`
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