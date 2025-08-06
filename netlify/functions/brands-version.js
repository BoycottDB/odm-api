/**
 * Netlify Function - Brands version
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

// Simple cache (limited in serverless but works)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
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
    const cacheKey = 'brands_version';
    const now = Date.now();
    const cached = cache.get(cacheKey);
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      console.log('Cache hit for version');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(cached.data)
      };
    }

    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    // Get brand stats (try different timestamp columns)
    let brandStats = null;
    let eventStats = null;
    
    // Try updated_at first, then created_at, then id-based approach
    try {
      const { data, error } = await supabase
        .from('Marque')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1);
      if (!error) brandStats = data;
    } catch {
      // Fallback to created_at or id
      try {
        const { data } = await supabase
          .from('Marque')
          .select('created_at')
          .order('created_at', { ascending: false })
          .limit(1);
        brandStats = data?.map(item => ({ updated_at: item.created_at }));
      } catch {
        // Final fallback: use current time
        brandStats = [{ updated_at: new Date().toISOString() }];
      }
    }

    try {
      const { data, error } = await supabase
        .from('Evenement')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1);
      if (!error) eventStats = data;
    } catch {
      try {
        const { data } = await supabase
          .from('Evenement')
          .select('created_at')
          .order('created_at', { ascending: false })
          .limit(1);
        eventStats = data?.map(item => ({ updated_at: item.created_at }));
      } catch {
        eventStats = [{ updated_at: new Date().toISOString() }];
      }
    }

    // Count totals with error handling
    let totalBrands = 0;
    let totalEvents = 0;
    
    try {
      const { count } = await supabase
        .from('Marque')
        .select('*', { count: 'exact', head: true });
      totalBrands = count || 0;
    } catch (error) {
      console.error('Error counting brands:', error);
      totalBrands = 0;
    }

    try {
      const { count } = await supabase
        .from('Evenement')
        .select('*', { count: 'exact', head: true });
      totalEvents = count || 0;
    } catch (error) {
      console.error('Error counting events:', error);
      totalEvents = 0;
    }

    // Calculate version
    const lastBrandUpdate = brandStats?.[0]?.updated_at || new Date().toISOString();
    const lastEventUpdate = eventStats?.[0]?.updated_at || new Date().toISOString();
    const mostRecent = new Date(Math.max(
      new Date(lastBrandUpdate).getTime(),
      new Date(lastEventUpdate).getTime()
    ));

    const checksum = `${totalBrands}-${totalEvents}-${mostRecent.getTime()}`;

    const versionData = {
      version: mostRecent.toISOString(),
      lastUpdated: mostRecent.toISOString(),
      totalBrands: totalBrands,
      totalEvents: totalEvents,
      checksum
    };

    // Cache the result
    cache.set(cacheKey, {
      data: versionData,
      timestamp: now
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(versionData)
    };

  } catch (error) {
    console.error('Version endpoint error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Erreur serveur lors de la récupération de la version',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};