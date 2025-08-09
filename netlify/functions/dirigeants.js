/**
 * Netlify Function - Leaders data
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
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

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
    const { id } = event.queryStringParameters || {};
    
    // Check cache
    const cacheKey = id ? `dirigeant_${id}` : 'dirigeants_all';
    const now = Date.now();
    const cached = cache.get(cacheKey);
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      console.log('Cache hit for leaders');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(cached.data)
      };
    }

    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    if (id) {
      // Get specific leader with their brand relationships
      const { data: dirigeant, error } = await supabase
        .from('dirigeants')
        .select(`
          *,
          marque_dirigeant!dirigeant_id (
            id,
            marque_id,
            lien_financier,
            impact_specifique,
            Marque!marque_id (
              id,
              nom
            )
          )
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      // Transform to DirigeantWithMarques format
      const transformedDirigeant = {
        id: dirigeant.id,
        nom: dirigeant.nom,
        controverses: dirigeant.controverses,
        sources: dirigeant.sources,
        impact_generique: dirigeant.impact_generique,
        marques: dirigeant.marque_dirigeant?.map(liaison => ({
          id: liaison.Marque.id,
          nom: liaison.Marque.nom,
          lien_financier: liaison.lien_financier,
          impact_specifique: liaison.impact_specifique,
          liaison_id: liaison.id
        })) || []
      };

      cache.set(cacheKey, {
        data: transformedDirigeant,
        timestamp: now
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(transformedDirigeant)
      };
    } else {
      // Get all leaders with their brand count
      const { data: dirigeants, error } = await supabase
        .from('dirigeants')
        .select(`
          *,
          marque_dirigeant!dirigeant_id (
            id,
            marque_id,
            lien_financier,
            impact_specifique,
            Marque!marque_id (
              id,
              nom
            )
          )
        `)
        .order('nom');

      if (error) throw error;

      // Transform to DirigeantWithMarques format
      const transformedDirigeants = dirigeants?.map(dirigeant => ({
        id: dirigeant.id,
        nom: dirigeant.nom,
        controverses: dirigeant.controverses,
        sources: dirigeant.sources,
        impact_generique: dirigeant.impact_generique,
        marques: dirigeant.marque_dirigeant?.map(liaison => ({
          id: liaison.Marque.id,
          nom: liaison.Marque.nom,
          lien_financier: liaison.lien_financier,
          impact_specifique: liaison.impact_specifique,
          liaison_id: liaison.id
        })) || []
      })) || [];

      cache.set(cacheKey, {
        data: transformedDirigeants,
        timestamp: now
      });

      console.log(`Leaders loaded: ${transformedDirigeants.length} leaders`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(transformedDirigeants)
      };
    }

  } catch (error) {
    console.error('Leaders endpoint error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Erreur serveur lors de la récupération des dirigeants',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};