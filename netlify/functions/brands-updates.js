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

    // Try to get updated brands with leaders, fall back if updated_at column doesn't exist
    let updatedBrands = [];
    try {
      const { data, error } = await supabase
        .from('Marque')
        .select(`
          *,
          Marque_beneficiaire!marque_id (
            id,
            beneficiaire_id,
            lien_financier,
            impact_specifique,
            created_at,
            updated_at,
            beneficiaire:Beneficiaires!marque_beneficiaire_beneficiaire_id_fkey (
              id,
              nom,
              impact_generique,
              type_beneficiaire
            )
          )
        `)
        .gte('updated_at', since)
        .order('updated_at', { ascending: false });
      
      if (!error) {
        updatedBrands = data || [];
      }
    } catch (error) {
      console.warn('Could not filter by updated_at, getting all brands:', error);
      // Fallback: get all brands if updated_at filtering fails
      const { data } = await supabase
        .from('Marque')
        .select(`
          *,
          Marque_beneficiaire!marque_id (
            id,
            beneficiaire_id,
            lien_financier,
            impact_specifique,
            created_at,
            updated_at,
            beneficiaire:Beneficiaires!marque_beneficiaire_beneficiaire_id_fkey (
              id,
              nom,
              impact_generique,
              type_beneficiaire
            )
          )
        `)
        .order('nom');
      updatedBrands = data || [];
    }

    // Try to get updated events with categories
    let updatedEvents = [];
    try {
      const { data, error } = await supabase
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
        `)
        .gte('updated_at', since)
        .order('updated_at', { ascending: false });
      
      if (!error) {
        updatedEvents = data || [];
      }
    } catch (error) {
      console.warn('Could not filter events by updated_at:', error);
      // Don't fail, just return empty array
      updatedEvents = [];
    }

    // Get events for these brands with categories
    const marqueIds = updatedBrands.map(b => b.id);
    let brandsEvents = [];
    if (marqueIds.length > 0) {
      try {
        const { data } = await supabase
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
          `)
          .in('marque_id', marqueIds);
        brandsEvents = data || [];
      } catch (error) {
        console.warn('Could not load events for brands:', error);
      }
    }

    // Group events by marque
    const eventsByMarque = new Map();
    brandsEvents.forEach(evt => {
      const marqueId = evt.marque_id || evt.marqueId;
      if (marqueId) {
        if (!eventsByMarque.has(marqueId)) {
          eventsByMarque.set(marqueId, []);
        }
        eventsByMarque.get(marqueId).push(evt);
      }
    });

    // Transform brands data
    const transformedBrands = await Promise.all(updatedBrands.map(async (marque) => {
      const evenements = eventsByMarque.get(marque.id) || [];
      
      const nbControverses = evenements.length;
      const nbCondamnations = evenements.filter(e => e.condamnation_judiciaire === true).length;
      // Calculate real number of controversial beneficiaires (handle object/array from Supabase)
      let beneficiaires = marque.Marque_beneficiaire || [];
      if (!Array.isArray(beneficiaires)) {
        beneficiaires = beneficiaires ? [beneficiaires] : [];
      }
      const nbDirigeantsControverses = beneficiaires.length; // Keep old name for extension compatibility
      
      // Transform beneficiaires to match extension format with all brands per beneficiaire
      const transformedDirigeants = await Promise.all(beneficiaires.map(async (liaison) => {
        // Récupérer toutes les marques pour ce bénéficiaire
        const { data: toutesMarquesDuBeneficiaire } = await supabase
          .from('Marque_beneficiaire')
          .select(`
            marque:Marque!marque_id (id, nom)
          `)
          .eq('beneficiaire_id', liaison.beneficiaire_id);
        
        const toutesMarques = toutesMarquesDuBeneficiaire?.map(m => {
          const marqueData = m.marque;
          return { id: marqueData.id, nom: marqueData.nom };
        }) || [];

        // Récupérer les controverses structurées pour ce bénéficiaire
        const { data: controverses } = await supabase
          .from('controverse_beneficiaire')
          .select('*')
          .eq('beneficiaire_id', liaison.beneficiaire_id)
          .order('ordre');

        return {
          id: liaison.id,
          dirigeant_id: liaison.beneficiaire_id, // Alias for extension compatibility
          dirigeant_nom: liaison.beneficiaire?.nom || '',
          // ✅ Transformation legacy : concaténer les titres
          controverses: (controverses || [])
            .map(c => c.titre)
            .join(' | ') || '',
          // ✅ Transformation legacy : extraire les URLs
          sources: (controverses || [])
            .map(c => c.source_url) || [],
          lien_financier: liaison.lien_financier,
          impact_description: liaison.impact_specifique || liaison.beneficiaire?.impact_generique || '',
          type_beneficiaire: liaison.beneficiaire?.type_beneficiaire || 'individu',
          toutes_marques: toutesMarques
        };
      }));
      
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
        lastUpdated: marque.updated_at || marque.created_at || new Date().toISOString(),
        // Add controversial beneficiaries data for extension (kept as dirigeants_controverses for compatibility)
        dirigeants_controverses: transformedDirigeants
      };
    }));

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