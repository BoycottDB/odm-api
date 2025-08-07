/**
 * Netlify Function - All brands data
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
    // Check cache
    const cacheKey = 'brands_full';
    const now = Date.now();
    const cached = cache.get(cacheKey);
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      console.log('Cache hit for full data');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(cached.data)
      };
    }

    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    // Get all brands with their leaders and events with categories
    const { data: marques, error: marqueError } = await supabase
      .from('Marque')
      .select(`
        *,
        marque_dirigeant!marque_id (
          id,
          dirigeant_nom,
          controverses,
          lien_financier,
          impact_description
        )
      `)
      .order('nom');

    if (marqueError) throw marqueError;

    // Get all events with their categories
    const { data: evenements, error: eventError } = await supabase
      .from('Evenement')
      .select(`
        *,
        Categorie!Evenement_categorie_id_fkey (
          id,
          nom,
          emoji,
          couleur,
          ordre
        )
      `);

    if (eventError) {
      console.warn('Could not load events:', eventError);
      // Continue without events rather than failing completely
    }

    // Group events by marque
    const eventsByMarque = new Map();
    if (evenements) {
      evenements.forEach(evt => {
        const marqueId = evt.marque_id || evt.marqueId;
        if (marqueId) {
          if (!eventsByMarque.has(marqueId)) {
            eventsByMarque.set(marqueId, []);
          }
          eventsByMarque.get(marqueId).push(evt);
        }
      });
    }

    // Transform data for extension compatibility
    const transformedBrands = marques.map(marque => {
      const evenements = eventsByMarque.get(marque.id) || [];
      
      // Calculate real stats
      const nbControverses = evenements.length;
      const nbCondamnations = evenements.filter(e => e.condamnation_judiciaire === true).length;
      // Calculate real number of controversial leaders (handle object/array from Supabase)
      let dirigeants = marque.marque_dirigeant || [];
      if (!Array.isArray(dirigeants)) {
        dirigeants = dirigeants ? [dirigeants] : [];
      }
      const nbDirigeantsControverses = dirigeants.length;
      
      // Extract unique categories from events with their details
      const categoryMap = new Map();
      evenements.forEach(evt => {
        if (evt.Categorie) {
          const cat = evt.Categorie;
          if (!categoryMap.has(cat.id)) {
            categoryMap.set(cat.id, {
              id: cat.id,
              nom: cat.nom,
              emoji: cat.emoji,
              couleur: cat.couleur,
              ordre: cat.ordre
            });
          }
        }
      });
      const categories = Array.from(categoryMap.values()).sort((a, b) => (a.ordre || 999) - (b.ordre || 999));
      
      // Transform events with category details
      const transformedEvenements = evenements.map(evt => ({
        id: evt.id,
        titre: evt.titre || evt.description,
        date: evt.date,
        source_url: evt.source_url || evt.source,
        condamnation_judiciaire: evt.condamnation_judiciaire || false,
        categorie: evt.Categorie ? {
          id: evt.Categorie.id,
          nom: evt.Categorie.nom,
          emoji: evt.Categorie.emoji,
          couleur: evt.Categorie.couleur
        } : null
      }));
      
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
        // Add controversial leaders data for extension  
        dirigeants_controverses: dirigeants
      };
    });

    // Get version metadata
    const { count: totalBrands } = await supabase
      .from('Marque')
      .select('*', { count: 'exact', head: true });

    const { count: totalEvents } = await supabase
      .from('Evenement')
      .select('*', { count: 'exact', head: true });

    const now_iso = new Date().toISOString();
    const checksum = `${totalBrands}-${totalEvents}-${Date.now()}`;

    const fullData = {
      brands: transformedBrands,
      version: now_iso,
      lastUpdated: now_iso,
      totalBrands: totalBrands || 0,
      totalEvents: totalEvents || 0,
      checksum
    };

    // Cache the result
    cache.set(cacheKey, {
      data: fullData,
      timestamp: now
    });

    console.log(`Full data: ${transformedBrands.length} brands loaded`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(fullData)
    };

  } catch (error) {
    console.error('Full data endpoint error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Erreur serveur lors de la récupération des données',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};