/**
 * Netlify Function - Brands data with search capabilities
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
const CACHE_TTL = 20 * 60 * 1000; // 20 minutes

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
    const { search, limit = '100', offset = '0' } = event.queryStringParameters || {};
    
    // Check cache
    const cacheKey = `marques_${search || 'all'}_${limit}_${offset}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      console.log('Cache hit for brands');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(cached.data)
      };
    }

    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    // Build query
    let query = supabase
      .from('Marque')
      .select(`
        *,
        marque_dirigeant!marque_id (
          id,
          dirigeant_id,
          lien_financier,
          impact_specifique,
          created_at,
          updated_at,
          dirigeant:dirigeant_id (
            id,
            nom,
            controverses,
            sources,
            impact_generique
          )
        ),
        SecteurMarque!secteur_marque_id (
          id,
          nom,
          description,
          message_boycott_tips,
          created_at,
          updated_at
        )
      `)
      .order('nom');

    // Apply search filter if provided
    if (search) {
      query = query.ilike('nom', `%${search}%`);
    }

    // Apply pagination
    const { data: marques, error } = await query
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) throw error;

    // Transform for frontend compatibility (similar to brands-full but with pagination)
    const transformedBrands = marques?.map(marque => {
      let dirigeant_controverse = null;
      
      // marque_dirigeant is an array, take the first element
      const dirigeantLiaison = marque.marque_dirigeant?.[0];
      
      if (dirigeantLiaison && dirigeantLiaison.dirigeant) {
        // Transform to legacy format for compatibility
        dirigeant_controverse = {
          id: dirigeantLiaison.id,
          marque_id: marque.id,
          dirigeant_id: dirigeantLiaison.dirigeant.id,
          dirigeant_nom: dirigeantLiaison.dirigeant.nom,
          controverses: dirigeantLiaison.dirigeant.controverses,
          lien_financier: dirigeantLiaison.lien_financier,
          impact_description: dirigeantLiaison.impact_specifique || dirigeantLiaison.dirigeant.impact_generique || '',
          sources: dirigeantLiaison.dirigeant.sources,
          created_at: dirigeantLiaison.created_at,
          updated_at: dirigeantLiaison.updated_at
        };
      }
      
      return {
        ...marque,
        dirigeant_controverse,
        secteur_marque: marque.SecteurMarque || null
      };
    }) || [];

    // Cache the result
    cache.set(cacheKey, {
      data: transformedBrands,
      timestamp: now
    });

    console.log(`Brands loaded: ${transformedBrands.length} brands (search: ${search || 'none'})`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(transformedBrands)
    };

  } catch (error) {
    console.error('Brands endpoint error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Erreur serveur lors de la récupération des marques',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};