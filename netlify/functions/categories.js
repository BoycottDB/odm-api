/**
 * Netlify Function - Categories data
 */
import { createClient } from '@supabase/supabase-js';

// Configuration Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase configuration');
}

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
}) : null;

// Cache
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour (categories rarely change)

export const handler = async (event, context) => {
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
    // Check cache
    const cacheKey = 'categories';
    const now = Date.now();
    const cached = cache.get(cacheKey);
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      console.log('Cache hit for categories');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(cached.data)
      };
    }

    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    // Get all categories
    const { data: categories, error } = await supabase
      .from('Categorie')
      .select('*')
      .eq('actif', true)
      .order('ordre', { ascending: true });

    if (error) throw error;

    // Cache the result
    cache.set(cacheKey, {
      data: categories || [],
      timestamp: now
    });

    console.log(`Categories loaded: ${categories?.length || 0} categories`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(categories || [])
    };

  } catch (error) {
    console.error('Categories endpoint error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Erreur serveur lors de la récupération des catégories',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};