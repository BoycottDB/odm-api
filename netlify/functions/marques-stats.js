/**
 * Netlify Function - Brand statistics for public /marques page
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
    // Check cache
    const cacheKey = 'marques_stats';
    const now = Date.now();
    const cached = cache.get(cacheKey);
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      console.log('Cache hit for brand stats');
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'X-Data-Source': 'odm-api-cache'
        },
        body: JSON.stringify(cached.data)
      };
    }

    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    // Récupérer toutes les marques avec leurs événements et bénéficiaires
    const { data: marques, error: marquesError } = await supabase
      .from('Marque')
      .select(`
        id,
        nom,
        Evenement (
          id,
          categorie_id,
          condamnation_judiciaire,
          Categorie!Evenement_categorie_id_fkey (
            id,
            nom,
            emoji,
            couleur
          )
        ),
        Marque_beneficiaire!marque_id (
          id,
          beneficiaire_id,
          lien_financier,
          beneficiaire:Beneficiaires!marque_beneficiaire_beneficiaire_id_fkey (
            id,
            nom,
            type_beneficiaire
          )
        )
      `);

    if (marquesError) throw marquesError;

    // Calculer les statistiques pour chaque marque
    const marquesWithStats = (marques || []).map((marque) => {
      const evenements = marque.Evenement || [];
      
      // Nombre total de controverses
      const nbControverses = evenements.length;
      
      // Catégories uniques (filtrer les null et undefined)
      const categoriesMap = new Map();
      evenements.forEach((e) => {
        const categorie = e.Categorie;
        let cat = null;
        if (Array.isArray(categorie) && categorie.length > 0) {
          cat = categorie[0];
        } else if (categorie && 'nom' in categorie) {
          cat = categorie;
        }
        if (cat && cat.id) {
          categoriesMap.set(cat.id, cat);
        }
      });
      const categories = Array.from(categoriesMap.values());
      
      // Nombre de condamnations judiciaires
      const nbCondamnations = evenements.filter((e) => e.condamnation_judiciaire === true).length;
      
      // Nombre de bénéficiaires controversés
      const nbDirigeantsControverses = Array.isArray(marque.Marque_beneficiaire) ? marque.Marque_beneficiaire.length : 0;
      
      return {
        id: marque.id,
        nom: marque.nom,
        nbControverses,
        categories,
        nbCondamnations,
        nbDirigeantsControverses
      };
    });

    // Trier par nombre de controverses décroissant, puis par nom
    marquesWithStats.sort((a, b) => {
      if (b.nbControverses !== a.nbControverses) {
        return b.nbControverses - a.nbControverses;
      }
      return a.nom.localeCompare(b.nom, 'fr');
    });

    // Cache the result
    cache.set(cacheKey, {
      data: marquesWithStats,
      timestamp: now
    });

    console.log(`Brand stats loaded: ${marquesWithStats.length} brands`);
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'X-Data-Source': 'odm-api-fresh'
      },
      body: JSON.stringify(marquesWithStats)
    };

  } catch (error) {
    console.error('Brand stats endpoint error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Erreur serveur lors de la récupération des statistiques des marques',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};