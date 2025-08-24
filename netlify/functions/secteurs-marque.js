/**
 * Netlify Function - Brand sectors data
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
const CACHE_TTL = 60 * 60 * 1000; // 1 hour (sectors rarely change)

export const handler = async (event) => {
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
    const { id } = event.queryStringParameters || {};
    
    // Check cache
    const cacheKey = id ? `secteur_${id}` : 'secteurs_all';
    const now = Date.now();
    const cached = cache.get(cacheKey);
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      console.log('Cache hit for sectors');
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'X-Data-Source': 'odm-api-secteurs-cache'
        },
        body: JSON.stringify(cached.data)
      };
    }

    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    if (id) {
      // Get specific sector
      const { data: secteur, error } = await supabase
        .from('SecteurMarque')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      cache.set(cacheKey, {
        data: secteur,
        timestamp: now
      });

      return {
        statusCode: 200,
        headers: {
          ...headers,
          'X-Data-Source': 'odm-api-secteurs-fresh'
        },
        body: JSON.stringify(secteur)
      };
    } else {
      // Get all sectors
      const { data: secteurs, error } = await supabase
        .from('SecteurMarque')
        .select('*')
        .order('nom');

      if (error) throw error;

      cache.set(cacheKey, {
        data: secteurs || [],
        timestamp: now
      });

      console.log(`Sectors loaded: ${secteurs?.length || 0} sectors`);
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'X-Data-Source': 'odm-api-secteurs-fresh'
        },
        body: JSON.stringify(secteurs || [])
      };
    }

  } catch (error) {
    console.error('Sectors endpoint error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Erreur serveur lors de la récupération des secteurs',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};