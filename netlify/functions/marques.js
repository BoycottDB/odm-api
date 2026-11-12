/**
 * Netlify Function - Liste complète des marques, lue par l'extension (synchronisation et snapshot statique)
 */
import { createClient } from '@supabase/supabase-js';
import { initSentry, sentryHandler } from './utils/sentry.js';
import { createServerlessCache } from './utils/serverlessCache.js';
import { createHash } from 'node:crypto';

// Initialiser Sentry
initSentry();

// Cache unifié pour marques
const cache = createServerlessCache('marques');

// Configuration Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase configuration');
}

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
}) : null;

const marquesHandler = async (event) => {
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
    const { limit = '999', offset = '0' } = event.queryStringParameters || {};
    const ifNoneMatch = (event.headers && (event.headers['if-none-match'] || event.headers['If-None-Match'])) || undefined;
    
    const endpointType = 'marques_all';
    const params = { limit, offset };
    const cached = cache.get(endpointType, params);

    if (cached) {
      const bodyStr = JSON.stringify(cached);
      const etag = createHash('sha1').update(bodyStr).digest('hex');
      const maxAge = 1200; // 20 min
      if (ifNoneMatch && etag && ifNoneMatch === etag) {
        return {
          statusCode: 304,
          headers: {
            ...headers,
            'X-Data-Source': 'odm-api-marques-cache-unified',
            'X-Cache': 'HIT',
            'X-Cache-Type': endpointType,
            'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=60`,
            'ETag': etag
          },
          body: ''
        };
      }
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'X-Data-Source': 'odm-api-marques-cache-unified',
          'X-Cache': 'HIT',
          'X-Cache-Type': endpointType,
          'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=60`,
          'ETag': etag
        },
        body: bodyStr
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
          marque_id,
          titre,
          date,
          source_url,
          reponse,
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
      // Order embedded events by their event date (newest first)
      .order('date', { ascending: false, referencedTable: 'Evenement' })
      .order('nom');

    // Apply pagination
    const { data: marques, error } = await query
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) throw error;

    // Transformation simplifiée utilisant les données des JOINs
    const transformedBrands = (marques || []).map((marque) => {
      const beneficiaires_marque = (marque.Marque_beneficiaire || [])
        .filter((liaison) => liaison.Beneficiaires)
        .map((liaison) => {
          // Nettoyer les données bénéficiaire pour éviter duplication
          const { controverse_beneficiaire, ...beneficiaireClean } = liaison.Beneficiaires;
          return {
            id: liaison.id,
            lien_financier: liaison.lien_financier,
            beneficiaire: {
              ...beneficiaireClean,
              controverses: controverse_beneficiaire || []
            }
          };
        });

      // Traitement des événements
      const evenements = marque.Evenement || [];
      
      // Nettoyer les données pour éviter duplication
      const { SecteurMarque, Marque_beneficiaire, Evenement, ...marqueClean } = marque;

      // Simplifier les événements (supprimer redondances)
      const evenementsTransformed = evenements.map(ev => ({
        id: ev.id,
        titre: ev.titre ?? ev.description,
        date: ev.date,
        source_url: ev.source_url,
        reponse: ev.reponse,
        categorie: ev.Categorie || null
      }));

      return {
        id: marqueClean.id,
        nom: marqueClean.nom,
        // Événements simplifiés
        evenements: evenementsTransformed,
        // Bénéficiaires directs (liste complète, utilisée par l'extension)
        beneficiaires_marque,
        // Secteur (seulement si nécessaire pour BoycottTips)
        message_boycott_tips: marqueClean.message_boycott_tips,
        secteur_marque: SecteurMarque ? {
          nom: SecteurMarque.nom,
          message_boycott_tips: SecteurMarque.message_boycott_tips
        } : null
      };
    });

    // Cache unifié avec TTL automatique
    cache.set(endpointType, transformedBrands, params);

    console.log(`Brands loaded: ${transformedBrands.length} brands`);
    const bodyStr = JSON.stringify(transformedBrands);
    const etag = createHash('sha1').update(bodyStr).digest('hex');
    const maxAge = 1200; // 20 min
    if (ifNoneMatch && etag && ifNoneMatch === etag) {
      return {
        statusCode: 304,
        headers: {
          ...headers,
          'X-Data-Source': 'odm-api-marques-fresh-unified',
          'X-Cache': 'MISS',
          'X-Cache-Type': endpointType,
          'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=60`,
          'ETag': etag
        },
        body: ''
      };
    }
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'X-Data-Source': 'odm-api-marques-fresh-unified',
        'X-Cache': 'MISS',
        'X-Cache-Type': endpointType,
        'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=60`,
        'ETag': etag
      },
      body: bodyStr
    };

  } catch (error) {
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