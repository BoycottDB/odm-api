/**
 * Netlify Function - Events data
 * Controverses des marques (Evenement) et des bénéficiaires (controverse_beneficiaire), triées par date
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
    const { limit = '100', offset = '0' } = event.queryStringParameters || {};
    
    // Check cache
    const cacheKey = `evenements_${limit}_${offset}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      console.log('Cache hit for events');
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'X-Data-Source': 'odm-api-evenements-cache'
        },
        body: JSON.stringify(cached.data)
      };
    }

    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    // Les N plus récentes de chaque table suffisent pour trouver les N plus récentes de la fusion
    const debut = parseInt(offset);
    const fin = debut + parseInt(limit);
    const [evenementsMarque, controversesBeneficiaire] = await Promise.all([
      supabase
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
        .order('date', { ascending: false, nullsFirst: false })
        .range(0, fin - 1),
      supabase
        .from('controverse_beneficiaire')
        .select(`
          id, beneficiaire_id, titre, date, source_url, reponse, categorie_id, created_at, updated_at,
          Beneficiaires!controverse_beneficiaire_beneficiaire_id_fkey (id, nom),
          Categorie!controverse_beneficiaire_categorie_id_fkey (id, nom, emoji, couleur, ordre)
        `)
        .order('date', { ascending: false, nullsFirst: false })
        .range(0, fin - 1)
    ]);

    if (evenementsMarque.error) throw evenementsMarque.error;
    if (controversesBeneficiaire.error) throw controversesBeneficiaire.error;

    // Transform for frontend compatibility
    const evenementsTransformes = (evenementsMarque.data || []).map(evt => ({
      id: evt.id,
      marque_id: evt.marque_id,
      titre: evt.titre || evt.description,
      description: evt.description,
      date: evt.date,
      categorie_id: evt.categorie_id,
      source_url: evt.source_url || evt.source,
      reponse: evt.reponse,
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
    }));

    const controversesTransformees = (controversesBeneficiaire.data || []).map(ctv => ({
      id: ctv.id,
      titre: ctv.titre,
      date: ctv.date,
      categorie_id: ctv.categorie_id,
      source_url: ctv.source_url,
      reponse: ctv.reponse,
      created_at: ctv.created_at,
      updated_at: ctv.updated_at,
      beneficiaire: ctv.Beneficiaires,
      categorie: ctv.Categorie
    }));

    // Tri par date de la controverse, sans date en dernier
    const transformedEvents = [...evenementsTransformes, ...controversesTransformees]
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(debut, fin);

    // Cache the result
    cache.set(cacheKey, {
      data: transformedEvents,
      timestamp: now
    });

    console.log(`Events loaded: ${transformedEvents.length} events`);
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'X-Data-Source': 'odm-api-evenements-fresh'
      },
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