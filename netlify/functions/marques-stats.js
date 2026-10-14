/**
 * Netlify Function - Brand statistics for public /marques page
 */
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { toutesLesLignes } from './utils/toutesLesLignes.js';

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

const PROFONDEUR_MAX = 5;
// Bénéficiaires, liens de la chaîne et controverses, chargés une fois pour toutes les marques
async function chargerChaines() {
  const [beneficiaires, relations, controverses] = await Promise.all([
    toutesLesLignes(supabase, 'Beneficiaires', 'id, nom'),
    toutesLesLignes(supabase, 'beneficiaire_relation', 'id, beneficiaire_source_id, beneficiaire_cible_id'),
    toutesLesLignes(supabase, 'controverse_beneficiaire', 'id, beneficiaire_id, date, Categorie!controverse_beneficiaire_categorie_id_fkey (nom, emoji)'),
  ]);

  const nomParId = new Map(beneficiaires.map((b) => [b.id, b.nom]));

  const ciblesParSource = new Map();
  for (const { beneficiaire_source_id: source, beneficiaire_cible_id: cible } of relations) {
    if (!source || !cible) continue;
    if (!ciblesParSource.has(source)) ciblesParSource.set(source, []);
    ciblesParSource.get(source).push(cible);
  }

  const controversesParBeneficiaire = new Map();
  for (const controverse of controverses) {
    const id = controverse.beneficiaire_id;
    if (!controversesParBeneficiaire.has(id)) controversesParBeneficiaire.set(id, []);
    controversesParBeneficiaire.get(id).push(controverse);
  }

  return { nomParId, ciblesParSource, controversesParBeneficiaire };
}

// Bénéficiaires controversés d'une chaîne, en remontant de source en cible
// (profondeur limitée, sans repasser par un bénéficiaire déjà vu sur la branche)
function beneficiairesControversesDepuis(chaines, beneficiaireId, visites, profondeurRestante, resultat) {
  if (profondeurRestante <= 0 || visites.has(beneficiaireId)) return;
  visites.add(beneficiaireId);

  const controverses = chaines.controversesParBeneficiaire.get(beneficiaireId) || [];
  const nom = chaines.nomParId.get(beneficiaireId);
  if (controverses.length > 0 && nom && !resultat.has(beneficiaireId)) {
    resultat.set(beneficiaireId, { id: beneficiaireId, nom, controverses });
  }

  for (const cible of chaines.ciblesParSource.get(beneficiaireId) || []) {
    beneficiairesControversesDepuis(chaines, cible, new Set(visites), profondeurRestante - 1, resultat);
  }
}

// Bénéficiaires controversés d'une marque, sur plusieurs niveaux ; Map par id :
// un bénéficiaire atteint par plusieurs chemins n'est compté qu'une fois
function beneficiairesControversesDeLaMarque(chaines, liaisons) {
  const resultat = new Map();
  for (const { beneficiaire_id: beneficiaireId } of liaisons) {
    if (beneficiaireId) beneficiairesControversesDepuis(chaines, beneficiaireId, new Set(), PROFONDEUR_MAX, resultat);
  }
  const trouves = Array.from(resultat.values());
  return {
    beneficiaires: trouves.map(({ id, nom }) => ({ id, nom })),
    controverses: trouves.flatMap((b) => b.controverses),
  };
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

    // Marques avec leurs controverses et leurs bénéficiaires directs
    const [marques, chaines] = await Promise.all([
      toutesLesLignes(supabase, 'Marque', `
        id,
        nom,
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
          beneficiaire_id
        )
      `),
      chargerChaines(),
    ]);

    // Calculer les statistiques pour chaque marque
    const marquesWithStats = marques.map((marque) => {
      const beneficiairesData = beneficiairesControversesDeLaMarque(chaines, marque.Marque_beneficiaire || []);

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
        nbBeneficiairesControverses: beneficiairesData.beneficiaires.length,
        beneficiairesControverses: beneficiairesData.beneficiaires.slice(0, MAX_BENEFICIAIRES)
      };
    });

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