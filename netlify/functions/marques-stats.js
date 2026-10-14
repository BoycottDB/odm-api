/**
 * Netlify Function - Brand statistics for public /marques page
 */
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

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
const MAX_BENEFICIAIRES = 5;

// Catégorie jamais affichée en étiquette : elle ne dit rien au visiteur
const CATEGORIE_EXCLUE = 'Autre';

// Une étiquette par catégorie, avec le nombre de controverses ;
// ordre : catégorie dont la controverse est la plus récente en premier
// (même calcul que calculerEtiquettes sur la page de marque du site) ;
// controverses de la marque (Evenement) ou de bénéficiaires (controverse_beneficiaire)
function calculerEtiquettes(controverses) {
  const parCategorie = new Map();

  for (const controverse of controverses) {
    const categorie = Array.isArray(controverse.Categorie) ? controverse.Categorie[0] : controverse.Categorie;
    const nom = categorie?.nom;
    if (!nom || nom === CATEGORIE_EXCLUE) continue;

    const date = controverse.date ? new Date(controverse.date).getTime() : 0;
    const existante = parCategorie.get(nom);
    parCategorie.set(nom, {
      emoji: categorie.emoji,
      nombre: (existante?.nombre ?? 0) + 1,
      plusRecente: Math.max(existante?.plusRecente ?? 0, date),
    });
  }

  return [...parCategorie.entries()]
    .sort(([, a], [, b]) => b.plusRecente - a.plusRecente)
    .map(([nom, { emoji, nombre }]) => ({ nom, emoji, nombre }));
}

// D'où viennent les étiquettes affichées : 'marque', 'beneficiaires', 'marque_ou_beneficiaires' ou null
function origineDesEtiquettes(depuisMarque, depuisBeneficiaires) {
  if (depuisMarque && depuisBeneficiaires) return 'marque_ou_beneficiaires';
  if (depuisMarque) return 'marque';
  if (depuisBeneficiaires) return 'beneficiaires';
  return null;
}

// Fonction pour récupérer les bénéficiaires controversés sur plusieurs niveaux
async function getBeneficiairesControverses(supabase, marqueId) {
  try {
    // 1. Récupérer les bénéficiaires directs de cette marque
    const { data: liaisonsBeneficiaires } = await supabase
      .from('Marque_beneficiaire')
      .select('beneficiaire_id')
      .eq('marque_id', marqueId);

    if (!liaisonsBeneficiaires || liaisonsBeneficiaires.length === 0) {
      return { count: 0, beneficiaires: [], controverses: [] };
    }

    // 2. Pour chaque bénéficiaire direct, construire sa chaîne et collecter les controversés
    const beneficiairesControversesMap = new Map();
    
    for (const liaison of liaisonsBeneficiaires) {
      if (!liaison.beneficiaire_id) continue;
      
      const controversesDeChaine = await getBeneficiairesControversesRecursif(
        supabase,
        liaison.beneficiaire_id,
        new Set(),
        5 // profondeur max
      );
      
      controversesDeChaine.forEach(beneficiaire => {
        beneficiairesControversesMap.set(beneficiaire.id, beneficiaire);
      });
    }
    
    // Map par id : un bénéficiaire atteint par plusieurs chemins n'est compté qu'une fois
    const controverses = Array.from(beneficiairesControversesMap.values()).flatMap((b) => b.controverses);
    const beneficiaires = Array.from(beneficiairesControversesMap.values()).map(({ id, nom }) => ({ id, nom }));
    return { count: beneficiaires.length, beneficiaires, controverses };
  } catch (error) {
    console.error(`Erreur lors de la récupération des bénéficiaires controversés pour la marque ${marqueId}:`, error);
    return { count: 0, beneficiaires: [], controverses: [] };
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
  
  // Controverses de ce bénéficiaire, avec catégorie et date pour les étiquettes
  const { data: controverses } = await supabase
    .from('controverse_beneficiaire')
    .select('id, date, Categorie!controverse_beneficiaire_categorie_id_fkey (nom, emoji)')
    .eq('beneficiaire_id', beneficiaireId);

  if (controverses && controverses.length > 0) {
    // Récupérer le nom du bénéficiaire
    const { data: beneficiaire } = await supabase
      .from('Beneficiaires')
      .select('id, nom')
      .eq('id', beneficiaireId)
      .single();
      
    if (beneficiaire) {
      result.add({ id: beneficiaire.id, nom: beneficiaire.nom, controverses });
    }
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
        sousResult.forEach(beneficiaire => result.add(beneficiaire));
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
    const ifNoneMatch = (event.headers && (event.headers['if-none-match'] || event.headers['If-None-Match'])) || undefined;
    // Check cache
    const cacheKey = 'marques_stats';
    const now = Date.now();
    const cached = cache.get(cacheKey);
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      if (ifNoneMatch && cached.etag && ifNoneMatch === cached.etag) {
        return {
          statusCode: 304,
          headers: {
            ...headers,
            'ETag': cached.etag,
            'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60',
            'X-Data-Source': 'odm-api-cache',
            'X-Cache': 'HIT'
          },
          body: ''
        };
      }
      console.log('Cache hit for brand stats');
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'ETag': cached.etag,
          'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60',
          'X-Data-Source': 'odm-api-cache',
          'X-Cache': 'HIT'
        },
        body: cached.bodyStr || JSON.stringify(cached.data)
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
        secteur_marque_id,
        secteur_marque:SecteurMarque!Marque_secteur_marque_id_fkey (
          id,
          nom
        ),
        Evenement (
          id,
          date,
          Categorie!Evenement_categorie_id_fkey (
            nom,
            emoji
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
      // Bénéficiaires controversés (multi-niveaux)
      const beneficiairesData = await getBeneficiairesControverses(supabase, marque.id);
      const beneficiairesLimited = (beneficiairesData.beneficiaires || []).slice(0, MAX_BENEFICIAIRES);

      // Étiquettes de la marque et de ses bénéficiaires, fusionnées ; l'origine sert
      // au libellé du site, pour ne pas attribuer à la marque les controverses de ses bénéficiaires
      const evenements = marque.Evenement || [];
      const etiquettes = calculerEtiquettes([...evenements, ...beneficiairesData.controverses]);
      const origineEtiquettes = origineDesEtiquettes(
        calculerEtiquettes(evenements).length > 0,
        calculerEtiquettes(beneficiairesData.controverses).length > 0
      );
      
      return {
        id: marque.id,
        nom: marque.nom,
        secteur: marque.secteur_marque ? {
          id: marque.secteur_marque.id,
          nom: marque.secteur_marque.nom
        } : null,
        etiquettes,
        origineEtiquettes,
        nbBeneficiairesControverses: beneficiairesData.count,
        beneficiairesControverses: beneficiairesLimited
      };
    }));

    // Tri alphabétique côté API pour éviter un tri duplicatif côté front
    marquesWithStats.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));

    // Préparer ETag et mise en cache
    const bodyStr = JSON.stringify(marquesWithStats);
    const etag = createHash('sha1').update(bodyStr).digest('hex');
    cache.set(cacheKey, {
      data: marquesWithStats,
      timestamp: now,
      etag,
      bodyStr
    });

    console.log(`Brand stats loaded: ${marquesWithStats.length} brands`);
    if (ifNoneMatch && etag && ifNoneMatch === etag) {
      return {
        statusCode: 304,
        headers: {
          ...headers,
          'ETag': etag,
          'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60',
          'X-Data-Source': 'odm-api-fresh',
          'X-Cache': 'MISS'
        },
        body: ''
      };
    }
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'ETag': etag,
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60',
        'X-Data-Source': 'odm-api-fresh',
        'X-Cache': 'MISS'
      },
      body: bodyStr
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