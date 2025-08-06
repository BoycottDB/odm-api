/**
 * Netlify Function - Brand updates since date
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
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

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
    const { since } = event.queryStringParameters || {};
    
    if (!since) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Paramètre "since" requis (timestamp ISO)'
        })
      };
    }

    // Validate date format
    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Format de date invalide pour "since"'
        })
      };
    }

    // Check cache
    const cacheKey = `updates_since_${since}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      console.log('Cache hit for updates');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(cached.data)
      };
    }

    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    // Get updated brands
    const { data: updatedBrands, error: brandsError } = await supabase
      .from('Marque')
      .select(`
        id,
        nom,
        imagePath,
        category,
        shortDescription,
        description,
        nbControverses,
        nbCondamnations,
        nbDirigeantsControverses,
        updated_at,
        Evenement (
          id,
          titre,
          date,
          source_url,
          condamnation_judiciaire,
          updated_at,
          categorie_id,
          Categorie!Evenement_categorie_id_fkey (
            id,
            nom,
            emoji,
            couleur
          )
        ),
        marque_dirigeant!marque_id (
          id,
          dirigeant_nom,
          controverses
        )
      `)
      .gte('updated_at', since)
      .order('updated_at', { ascending: false });

    if (brandsError) throw brandsError;

    // Get updated events
    const { data: updatedEvents, error: eventsError } = await supabase
      .from('Evenement')
      .select(`
        id,
        titre,
        date,
        source_url,
        condamnation_judiciaire,
        marque_id,
        updated_at,
        categorie_id,
        Categorie!Evenement_categorie_id_fkey (
          id,
          nom,
          emoji,
          couleur
        )
      `)
      .gte('updated_at', since)
      .order('updated_at', { ascending: false });

    if (eventsError) throw eventsError;

    // Transform data (same logic as full.js)
    const transformedBrands = updatedBrands.map(marque => {
      const evenements = marque.Evenement || [];
      
      const nbControverses = evenements.length;
      const nbCondamnations = evenements.filter(e => e.condamnation_judiciaire === true).length;
      const nbDirigeantsControverses = marque.marque_dirigeant ? marque.marque_dirigeant.length : 0;
      
      // Categories
      const categoriesMap = new Map();
      evenements.forEach(evt => {
        const categorie = evt.Categorie;
        let cat = null;
        if (Array.isArray(categorie) && categorie.length > 0) {
          cat = categorie[0];
        } else if (categorie && 'nom' in categorie) {
          cat = categorie;
        }
        if (cat && cat.id) {
          categoriesMap.set(cat.id, {
            id: cat.id,
            nom: cat.nom,
            emoji: cat.emoji,
            couleur: cat.couleur
          });
        }
      });
      const categories = Array.from(categoriesMap.values());
      
      // Transform events
      const transformedEvenements = evenements.map(evt => {
        const categorie = evt.Categorie;
        let transformedCategorie = null;
        if (Array.isArray(categorie) && categorie.length > 0) {
          transformedCategorie = categorie[0];
        } else if (categorie && 'nom' in categorie) {
          transformedCategorie = categorie;
        }
        
        return {
          id: evt.id,
          titre: evt.titre,
          date: evt.date,
          source_url: evt.source_url,
          condamnation_judiciaire: evt.condamnation_judiciaire,
          categorie: transformedCategorie
        };
      });
      
      return {
        id: marque.id,
        name: marque.nom,
        nbControverses,
        nbCondamnations,
        nbDirigeantsControverses,
        categories,
        evenements: transformedEvenements,
        category: marque.category,
        shortDescription: marque.shortDescription,
        description: marque.description,
        imagePath: marque.imagePath,
        lastUpdated: marque.updated_at
      };
    });

    const updates = {
      hasUpdates: transformedBrands.length > 0 || updatedEvents.length > 0,
      updatedBrands: transformedBrands,
      updatedEvents: updatedEvents || [],
      timestamp: new Date().toISOString()
    };

    // Cache result
    cache.set(cacheKey, {
      data: updates,
      timestamp: now
    });

    console.log(`Updates since ${since}: ${transformedBrands.length} brands, ${updatedEvents.length} events`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(updates)
    };

  } catch (error) {
    console.error('Updates endpoint error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Erreur serveur lors de la récupération des mises à jour',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};