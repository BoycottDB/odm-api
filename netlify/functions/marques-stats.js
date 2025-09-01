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

// Fonction pour compter les bénéficiaires controversés sur plusieurs niveaux
async function getNbBeneficiairesControverses(supabase, marqueId) {
  try {
    // 1. Récupérer les bénéficiaires directs de cette marque
    const { data: liaisonsBeneficiaires } = await supabase
      .from('Marque_beneficiaire')
      .select('beneficiaire_id')
      .eq('marque_id', marqueId);

    if (!liaisonsBeneficiaires || liaisonsBeneficiaires.length === 0) {
      return 0;
    }

    // 2. Pour chaque bénéficiaire direct, construire sa chaîne et compter les controversés
    const beneficiairesControverses = new Set();
    
    for (const liaison of liaisonsBeneficiaires) {
      if (!liaison.beneficiaire_id) continue;
      
      const controversesDeChaine = await getBeneficiairesControversesRecursif(
        supabase,
        liaison.beneficiaire_id,
        new Set(),
        5 // profondeur max
      );
      
      controversesDeChaine.forEach(id => beneficiairesControverses.add(id));
    }
    
    return beneficiairesControverses.size;
  } catch (error) {
    console.error(`Erreur lors du comptage des bénéficiaires controversés pour la marque ${marqueId}:`, error);
    return 0;
  }
}

// Fonction récursive pour parcourir la chaîne et trouver les bénéficiaires controversés
async function getBeneficiairesControversesRecursif(supabase, beneficiaireId, visited, profondeurRestante) {
  const result = new Set();
  
  // Éviter les cycles et limiter la profondeur
  if (profondeurRestante <= 0 || visited.has(beneficiaireId)) {
    return result;
  }
  
  visited.add(beneficiaireId);
  
  // Vérifier si ce bénéficiaire a des controverses
  const { data: controverses } = await supabase
    .from('controverse_beneficiaire')
    .select('id')
    .eq('beneficiaire_id', beneficiaireId)
    .limit(1);
    
  if (controverses && controverses.length > 0) {
    result.add(beneficiaireId);
  }
  
  // Récupérer les relations suivantes
  const { data: relations } = await supabase
    .from('beneficiaire_relation')
    .select('beneficiaire_cible_id')
    .eq('beneficiaire_source_id', beneficiaireId);
    
  if (relations && relations.length > 0) {
    for (const relation of relations) {
      if (relation.beneficiaire_cible_id && !visited.has(relation.beneficiaire_cible_id)) {
        const sousResult = await getBeneficiairesControversesRecursif(
          supabase,
          relation.beneficiaire_cible_id,
          new Set(visited), // Nouvelle copie pour chaque branche
          profondeurRestante - 1
        );
        sousResult.forEach(id => result.add(id));
      }
    }
  }
  
  return result;
}

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
    const marquesWithStats = await Promise.all((marques || []).map(async (marque) => {
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
      
      // Nombre de bénéficiaires controversés (multi-niveaux)
      const nbBeneficiairesControverses = await getNbBeneficiairesControverses(supabase, marque.id);
      
      return {
        id: marque.id,
        nom: marque.nom,
        nbControverses,
        categories,
        nbCondamnations,
        nbBeneficiairesControverses
      };
    }));

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