/**
 * Netlify Function - Get all brand slugs for static generation
 * Returns an array of slugs for all brands
 */
import { createClient } from '@supabase/supabase-js';
import { createServerlessCache } from './utils/serverlessCache.js';
import { initSentry, sentryHandler } from './utils/sentry.js';

// Initialiser Sentry
initSentry();

// Cache
const cache = createServerlessCache('marques-slugs');

// Configuration Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase configuration');
}

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
}) : null;

/**
 * Slugify function (must match frontend)
 */
function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();
}

/**
 * Handler principal
 */
const handler = sentryHandler(async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, s-maxage=1200, stale-while-revalidate=2400'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (!supabase) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Database configuration error' })
    };
  }

  try {
    // Vérifier le cache
    const cacheKey = 'all-slugs';
    const cached = cache.get(cacheKey);
    if (cached) {
      return {
        statusCode: 200,
        headers: { ...headers, 'X-Cache': 'HIT' },
        body: JSON.stringify(cached)
      };
    }

    // Récupérer toutes les marques
    const { data: marques, error } = await supabase
      .from('Marque')
      .select('nom')
      .order('nom', { ascending: true });

    if (error) {
      throw error;
    }

    // Générer les slugs
    const slugs = (marques || []).map(m => slugify(m.nom));

    // Mettre en cache pour 20 minutes
    cache.set(cacheKey, slugs, 1200);

    return {
      statusCode: 200,
      headers: { ...headers, 'X-Cache': 'MISS' },
      body: JSON.stringify(slugs)
    };
  } catch (error) {
    console.error('Error fetching brand slugs:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
});

export { handler };
