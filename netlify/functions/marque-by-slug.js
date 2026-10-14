/**
 * Netlify Function - Get brand by slug
 * Returns complete brand data with events, beneficiary chain, and boycott tips
 */
import { createClient } from '@supabase/supabase-js';
import { recupererToutesMarquesTransitives } from './utils/marquesTransitives.js';
import { createServerlessCache } from './utils/serverlessCache.js';
import { initSentry, sentryHandler } from './utils/sentry.js';

// Initialiser Sentry
initSentry();

// Cache
const cache = createServerlessCache('marque-by-slug');

// Configuration Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase configuration');
}

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
}) : null;

/**
 * Slugify function (must match frontend)
 */
function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();
}

/**
 * Construire la chaîne de bénéficiaires récursivement (chaque bénéficiaire une seule fois ;
 * les liens entre bénéficiaires sont dans relations_suivantes)
 */
async function construireChaineRecursive(beneficiaireId, niveauActuel, visitedIds, marqueId, profondeurMax = 5, lienFinancierParent = '') {
  if (niveauActuel >= profondeurMax || visitedIds.has(beneficiaireId)) {
    return [];
  }

  visitedIds.add(beneficiaireId);

  try {
    const { data: beneficiaire, error: beneficiaireError } = await supabase
      .from('Beneficiaires')
      .select(`
        id,
        nom,
        impact_generique,
        type_beneficiaire,
        controverses:controverse_beneficiaire(*,Categorie!controverse_beneficiaire_categorie_id_fkey(*))
      `)
      .eq('id', beneficiaireId)
      .single();

    if (beneficiaireError || !beneficiaire) {
      visitedIds.delete(beneficiaireId);
      return [];
    }

    const { data: relations } = await supabase
      .from('beneficiaire_relation')
      .select('*')
      .eq('beneficiaire_source_id', beneficiaireId);

    const relationsSuivantes = (relations || []).map(rel => ({
      id: rel.id,
      beneficiaire_source_id: rel.beneficiaire_source_id,
      beneficiaire_cible_id: rel.beneficiaire_cible_id,
      type_relation: 'actionnaire',
      description_relation: rel.description_relation
    }));

    // Autres marques du bénéficiaire (hors marque affichée), directes et via les bénéficiaires qui lui sont liés
    const { marquesDirectes, marquesIndirectes } = await recupererToutesMarquesTransitives(
      supabase,
      beneficiaireId,
      marqueId
    );

    const nodeActuel = {
      beneficiaire: {
        id: beneficiaire.id,
        nom: beneficiaire.nom,
        controverses: beneficiaire.controverses || [],
        impact_generique: beneficiaire.impact_generique,
        type_beneficiaire: beneficiaire.type_beneficiaire
      },
      niveau: niveauActuel,
      relations_suivantes: relationsSuivantes,
      lien_financier: lienFinancierParent || 'Lien financier non défini',
      marques_directes: marquesDirectes,
      marques_indirectes: marquesIndirectes
    };

    const noeuds = [nodeActuel];

    for (const relation of relationsSuivantes) {
      const sousNoeuds = await construireChaineRecursive(
        relation.beneficiaire_cible_id,
        niveauActuel + 1,
        visitedIds,
        marqueId,
        profondeurMax,
        relation.description_relation || 'Lien financier'
      );
      noeuds.push(...sousNoeuds);
    }

    return noeuds;
  } catch (error) {
    console.error(`Error building chain for beneficiary ${beneficiaireId}:`, error);
    visitedIds.delete(beneficiaireId);
    return [];
  }
}

/**
 * Handler principal
 */
const handler = sentryHandler(async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (!supabase) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Database configuration error' })
    };
  }

  try {
    const slug = event.queryStringParameters?.slug;

    if (!slug) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing slug parameter' })
      };
    }

    // Vérifier le cache
    const cacheKey = `slug:${slug}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return {
        statusCode: 200,
        headers: { ...headers, 'X-Cache': 'HIT' },
        body: JSON.stringify(cached)
      };
    }

    // Récupérer toutes les marques pour matcher le slug
    const { data: marques, error: marquesError } = await supabase
      .from('Marque')
      .select('id, nom');

    if (marquesError) {
      throw marquesError;
    }

    // Trouver la marque correspondant au slug
    const marque = marques?.find(m => slugify(m.nom) === slug);

    if (!marque) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Brand not found' })
      };
    }

    // Récupérer les données complètes de la marque
    const { data: marqueComplete, error: marqueError } = await supabase
      .from('Marque')
      .select(`
        id,
        nom,
        message_boycott_tips,
        secteur_marque:SecteurMarque(
          id,
          nom,
          message_boycott_tips
        ),
        evenements:Evenement(
          id,
          titre,
          date,
          source_url,
          reponse,
          categorie:Categorie(*)
        )
      `)
      .eq('id', marque.id)
      .single();

    if (marqueError || !marqueComplete) {
      throw marqueError || new Error('Brand not found');
    }

    // Construire la chaîne de bénéficiaires
    const { data: liaisonsBeneficiaires } = await supabase
      .from('Marque_beneficiaire')
      .select('beneficiaire_id, lien_financier')
      .eq('marque_id', marque.id);

    let chaine_beneficiaires = [];
    let total_beneficiaires_chaine = 0;

    if (liaisonsBeneficiaires && liaisonsBeneficiaires.length > 0) {
      const visitedIds = new Set();
      for (const liaison of liaisonsBeneficiaires) {
        const noeuds = await construireChaineRecursive(
          liaison.beneficiaire_id,
          0,
          visitedIds,
          marque.id,
          5,
          liaison.lien_financier
        );
        chaine_beneficiaires.push(...noeuds);
      }
      total_beneficiaires_chaine = new Set(chaine_beneficiaires.map(n => n.beneficiaire.id)).size;
    }

    const result = {
      ...marqueComplete,
      chaine_beneficiaires,
      total_beneficiaires_chaine,
      total_evenements: marqueComplete.evenements?.length || 0
    };

    // Mettre en cache
    cache.set(cacheKey, result, 600); // 10 minutes

    return {
      statusCode: 200,
      headers: { ...headers, 'X-Cache': 'MISS' },
      body: JSON.stringify(result)
    };
  } catch (error) {
    console.error('Error fetching brand by slug:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
});

export { handler };
