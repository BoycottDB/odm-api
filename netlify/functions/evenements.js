/**
 * Netlify Function - Events data
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
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

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
    const { limit = '100', offset = '0' } = event.queryStringParameters || {};
    
    // Check cache
    const cacheKey = `evenements_${limit}_${offset}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      console.log('Cache hit for events');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(cached.data)
      };
    }

    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    // Get events with all related data
    const { data: evenements, error } = await supabase
      .from('Evenement')
      .select(`
        *,
        Marque!Evenement_marque_id_fkey (
          id,
          nom,
          secteur_marque_id,
          message_boycott_tips,
          SecteurMarque!secteur_marque_id (
            id,
            nom,
            message_boycott_tips
          )
        ),
        Categorie!Evenement_categorie_id_fkey (
          id,
          nom,
          emoji,
          couleur,
          ordre
        )
      `)
      .order('date', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) throw error;

    // Transform for frontend compatibility
    const transformedEvents = evenements?.map(evt => ({
      id: evt.id,
      marque_id: evt.marque_id,
      titre: evt.titre || evt.description,
      description: evt.description,
      date: evt.date,
      categorie_id: evt.categorie_id,
      source_url: evt.source_url || evt.source,
      reponse: evt.reponse,
      condamnation_judiciaire: evt.condamnation_judiciaire || false,
      created_at: evt.created_at,
      updated_at: evt.updated_at,
      marque: evt.Marque ? {
        id: evt.Marque.id,
        nom: evt.Marque.nom,
        secteur_marque_id: evt.Marque.secteur_marque_id,
        message_boycott_tips: evt.Marque.message_boycott_tips,
        secteur_marque: evt.Marque.SecteurMarque
      } : null,
      categorie: evt.Categorie
    })) || [];

    // Cache the result
    cache.set(cacheKey, {
      data: transformedEvents,
      timestamp: now
    });

    console.log(`Events loaded: ${transformedEvents.length} events`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(transformedEvents)
    };

  } catch (error) {
    console.error('Events endpoint error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Erreur serveur lors de la récupération des événements',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};