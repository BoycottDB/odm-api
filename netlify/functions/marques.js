/**
 * Netlify Function - Brands data with search capabilities
 */
import { createClient } from '@supabase/supabase-js';
import { recupererToutesMarquesTransitives } from './utils/marquesTransitives.js';
import { MetricsLogger } from './utils/metrics.js';
import { initSentry, sentryHandler } from './utils/sentry.js';

// Initialiser Sentry
initSentry();

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

const marquesHandler = async (event) => {
  const startTime = Date.now();
  const functionName = 'marques';
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
    const { search, limit = '999', offset = '0' } = event.queryStringParameters || {};
    
    // Check cache
    const cacheKey = `marques_${search || 'all'}_${limit}_${offset}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      MetricsLogger.logCache(functionName, true);
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'X-Data-Source': 'odm-api-marques-cache',
          'X-Cache': 'HIT'
        },
        body: JSON.stringify(cached.data)
      };
    }

    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    let query = supabase
      .from('Marque')
      .select(`
        *,
        Evenement!marque_id (
          id,
          titre,
          date,
          source_url,
          condamnation_judiciaire,
          Categorie!categorie_id (
            id,
            nom,
            emoji,
            couleur,
            ordre
          )
        ),
        Marque_beneficiaire!marque_id (
          id,
          beneficiaire_id,
          lien_financier,
          impact_specifique,
          created_at,
          updated_at,
          Beneficiaires!marque_beneficiaire_beneficiaire_id_fkey (
            id,
            nom,
            impact_generique,
            type_beneficiaire,
            created_at,
            updated_at,
            controverse_beneficiaire!beneficiaire_id (
              id,
              titre,
              date,
              source_url,
              created_at,
              Categorie!controverse_beneficiaire_categorie_id_fkey (
                id,
                nom,
                emoji,
                couleur,
                ordre
              )
            ),
            autres_marques:Marque_beneficiaire!marque_beneficiaire_beneficiaire_id_fkey (
              Marque!marque_id (id, nom)
            )
          )
        ),
        SecteurMarque!secteur_marque_id (
          id,
          nom,
          description,
          message_boycott_tips,
          created_at,
          updated_at
        )
      `)
      .order('nom');

    // Apply search filter if provided
    if (search) {
      query = query.ilike('nom', `%${search}%`);
    }

    // Apply pagination
    const { data: marques, error } = await query
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) throw error;

    // ransformation simplifiée utilisant les données des JOINs
    const transformedBrands = await Promise.all(
      (marques || []).map(async (marque) => {
        const liaisonsDirectes = marque.Marque_beneficiaire || [];

        // Transformation unifiée des bénéficiaires directs
        const beneficiaires_marque = [];

        for (const liaison of liaisonsDirectes) {
          if (liaison.Beneficiaires) {
            // Utiliser les données déjà récupérées par les JOINs
            const controverses = liaison.Beneficiaires.controverse_beneficiaire || [];
            const autres_marques_raw = liaison.Beneficiaires.autres_marques || [];

            // Calculer les marques directes (exclure la marque actuelle)
            const marques_directes = autres_marques_raw
              .map(m => ({ id: m.Marque.id, nom: m.Marque.nom }))
              .filter(m => m.id !== marque.id);

            // Calculer les marques transitives (gardé pour compatibilité complexe)
            const marquesTransitives = await recupererToutesMarquesTransitives(
              supabase,
              liaison.Beneficiaires.id,
              marque.id,
              new Set(),
              5
            );

            const marques_indirectes = marquesTransitives.marquesIndirectes;

            // Nettoyer les données bénéficiaire pour éviter duplication
            const { controverse_beneficiaire, autres_marques, ...beneficiaireClean } = liaison.Beneficiaires;

            beneficiaires_marque.push({
              id: liaison.id,
              lien_financier: liaison.lien_financier,
              impact_specifique: liaison.impact_specifique,
              source_lien: 'direct',
              beneficiaire: {
                ...beneficiaireClean,
                controverses: controverses, 
                marques_directes: marques_directes,
                marques_indirectes: marques_indirectes
              }
            });
          }
        }

        // Traitement des événements et catégories
        const evenements = marque.Evenement || [];
        const categoriesUniques = new Map();
        
        // Extraire les catégories uniques des événements
        evenements.forEach(event => {
          if (event.Categorie && !categoriesUniques.has(event.Categorie.id)) {
            categoriesUniques.set(event.Categorie.id, event.Categorie);
          }
        });
        
        const categories = Array.from(categoriesUniques.values())
          .sort((a, b) => a.ordre - b.ordre);
        
        // Calculer les statistiques
        const nbControverses = evenements.length;
        const nbCondamnations = evenements.filter(e => e.condamnation_judiciaire === true).length;
        const nbDirigeantsControverses = beneficiaires_marque.length;
        
        // Nettoyer les données pour éviter duplication
        const { SecteurMarque, Marque_beneficiaire, Evenement, ...marqueClean } = marque;

        return {
          ...marqueClean,
          // Événements et catégories
          evenements,
          categories,
          // Statistiques
          nbControverses,
          nbCondamnations,
          nbDirigeantsControverses,
          // Structure unifiée sans duplication
          beneficiaires_marque, // Format unifié
          secteur_marque: SecteurMarque || null
        };
      })
    );

    // Cache the result
    cache.set(cacheKey, {
      data: transformedBrands,
      timestamp: now
    });

    MetricsLogger.logCache(functionName, false);

    console.log(`Brands loaded: ${transformedBrands.length} brands (search: ${search || 'none'})`);
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'X-Data-Source': 'odm-api-marques-fresh',
        'X-Cache': 'MISS'
      },
      body: JSON.stringify(transformedBrands)
    };

  } catch (error) {
    MetricsLogger.logError(functionName, error);
    console.error('Brands endpoint error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Erreur serveur lors de la récupération des marques',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};

export const handler = sentryHandler(marquesHandler);