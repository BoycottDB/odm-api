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
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

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
 * Get all brands data endpoint
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
    // Vérifier le cache
    const cacheKey = 'brands_full';
    const now = Date.now();
    
    if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_TTL) {
      console.log('Cache hit for full data');
      return res.status(200).json(cache[cacheKey].data);
    }

    // Récupérer toutes les marques avec leurs événements et catégories (même structure que le projet web)
    const { data: marques, error } = await supabase
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
        Evenement (
          id,
          titre,
          date,
          source_url,
          condamnation_judiciaire,
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
      .order('nom');

    if (error) {
      console.error('Full data error:', error);
      throw error;
    }

    // Transformation des données pour correspondre au format de l'extension
    const transformedBrands = marques.map(marque => {
      const evenements = marque.Evenement || [];
      
      // Calculer les statistiques réelles depuis les données
      const nbControverses = evenements.length;
      const nbCondamnations = evenements.filter(e => e.condamnation_judiciaire === true).length;
      const nbDirigeantsControverses = marque.marque_dirigeant ? marque.marque_dirigeant.length : 0;
      
      // Extraction des catégories uniques depuis les événements (avec la nouvelle structure)
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
      
      // Événements avec catégorie intégrée (transformation pour compatibilité)
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
        
        // Champs de compatibilité avec l'ancien format
        category: marque.category,
        shortDescription: marque.shortDescription,
        description: marque.description,
        imagePath: marque.imagePath
      };
    });

    // Récupérer aussi les métadonnées de version
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

    // Mettre en cache
    cache[cacheKey] = {
      data: fullData,
      timestamp: now
    };

    console.log(`Full data: ${transformedBrands.length} brands loaded`);
    res.status(200).json(fullData);

  } catch (error) {
    console.error('Full data endpoint error:', error);
    res.status(500).json({
      error: 'Erreur serveur lors de la récupération des données',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}