import { createClient } from '@supabase/supabase-js';

// Configuration Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL et SUPABASE_ANON_KEY sont requis');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

// Cache simple en mémoire
let cache = {};
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Extraire les catégories uniques depuis une liste d'événements
 */
function extractUniqueCategories(evenements) {
  if (!evenements || !Array.isArray(evenements)) {
    return [];
  }

  const categoriesMap = new Map();
  
  evenements.forEach(evt => {
    if (evt.categorie && evt.categorie.id) {
      categoriesMap.set(evt.categorie.id, {
        id: evt.categorie.id,
        nom: evt.categorie.nom,
        emoji: evt.categorie.emoji,
        couleur: evt.categorie.couleur
      });
    }
  });

  return Array.from(categoriesMap.values());
}

/**
 * Get incremental updates endpoint
 */
export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    const { since } = req.query;
    
    if (!since) {
      return res.status(400).json({
        error: 'Paramètre "since" requis (timestamp ISO)'
      });
    }

    // Validation du format de date
    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) {
      return res.status(400).json({
        error: 'Format de date invalide pour "since"'
      });
    }

    // Vérifier le cache
    const cacheKey = `updates_since_${since}`;
    const now = Date.now();
    
    if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_TTL) {
      console.log('Cache hit for updates');
      return res.status(200).json(cache[cacheKey].data);
    }

    // Récupérer les marques mises à jour (même structure que le projet web)
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

    if (brandsError) {
      console.error('Brands update error:', brandsError);
      throw brandsError;
    }

    // Récupérer les événements mis à jour (même si la marque n'a pas changé)
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

    if (eventsError) {
      console.error('Events update error:', eventsError);
      throw eventsError;
    }

    // Transformer les données (même logique que full.js)
    const transformedBrands = updatedBrands.map(marque => {
      const evenements = marque.Evenement || [];
      
      // Calculer les statistiques réelles
      const nbControverses = evenements.length;
      const nbCondamnations = evenements.filter(e => e.condamnation_judiciaire === true).length;
      const nbDirigeantsControverses = marque.marque_dirigeant ? marque.marque_dirigeant.length : 0;
      
      // Extraction des catégories uniques
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
      
      // Transformer les événements
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

    // Mettre en cache
    cache[cacheKey] = {
      data: updates,
      timestamp: now
    };

    console.log(`Updates since ${since}: ${transformedBrands.length} brands, ${updatedEvents.length} events`);
    res.status(200).json(updates);

  } catch (error) {
    console.error('Updates endpoint error:', error);
    res.status(500).json({
      error: 'Erreur serveur lors de la récupération des mises à jour',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}