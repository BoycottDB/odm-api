/**
 * Netlify Function - Get brand by slug
 * Returns complete brand data with events, beneficiary chain, and boycott tips
 */
import { createClient } from '@supabase/supabase-js';
import { toutesLesLignes } from './utils/toutesLesLignes.js';
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

const PROFONDEUR_MAX = 5;

/**
 * Bénéficiaires, liens, controverses et marques de chaque bénéficiaire, en 4 requêtes vérifiées
 */
async function chargerGraphe() {
  const [beneficiaires, relations, controverses, liaisons] = await Promise.all([
    toutesLesLignes(supabase, 'Beneficiaires', 'id, nom, impact_generique, type_beneficiaire'),
    toutesLesLignes(supabase, 'beneficiaire_relation', '*'),
    toutesLesLignes(supabase, 'controverse_beneficiaire', 'id, beneficiaire_id, titre, date, source_url, source_archive_url, reponse, categorie_id, created_at, updated_at, Categorie!controverse_beneficiaire_categorie_id_fkey(*)'),
    toutesLesLignes(supabase, 'Marque_beneficiaire', 'id, beneficiaire_id, Marque!marque_id (id, nom)'),
  ]);

  const grouperPar = (lignes, cle) => {
    const groupes = new Map();
    for (const ligne of lignes) {
      if (!groupes.has(ligne[cle])) groupes.set(ligne[cle], []);
      groupes.get(ligne[cle]).push(ligne);
    }
    return groupes;
  };

  return {
    beneficiaireParId: new Map(beneficiaires.map((b) => [b.id, b])),
    relationsParSource: grouperPar(relations, 'beneficiaire_source_id'),
    relationsParCible: grouperPar(relations, 'beneficiaire_cible_id'),
    controversesParBeneficiaire: grouperPar(controverses, 'beneficiaire_id'),
    liaisonsParBeneficiaire: grouperPar(liaisons, 'beneficiaire_id'),
  };
}

// Graphe partagé par les requêtes d'une même instance pendant 60 s : au build, les pages
// demandées en même temps attendent le même chargement au lieu d'en lancer chacune un
const GRAPHE_TTL = 60 * 1000;
let grapheEnCache = null;

function grapheRecent() {
  if (!grapheEnCache || Date.now() - grapheEnCache.depuis > GRAPHE_TTL) {
    const promesse = chargerGraphe().catch((error) => {
      // Un échec n'est jamais réutilisé
      if (grapheEnCache?.promesse === promesse) grapheEnCache = null;
      throw error;
    });
    grapheEnCache = { promesse, depuis: Date.now() };
  }
  return grapheEnCache.promesse;
}

/**
 * Autres marques d'un bénéficiaire (hors marque affichée) : directes et via les bénéficiaires
 * qui lui sont liés (relations entrantes), regroupées par intermédiaire
 */
function marquesTransitives(graphe, beneficiaireId, marqueActuelleId, visites = new Set()) {
  if (visites.has(beneficiaireId) || visites.size >= PROFONDEUR_MAX) {
    return { marquesDirectes: [], marquesIndirectes: {} };
  }
  visites.add(beneficiaireId);

  const marquesDirectes = (graphe.liaisonsParBeneficiaire.get(beneficiaireId) || [])
    .filter((liaison) => liaison.Marque)
    .map((liaison) => ({ id: liaison.Marque.id, nom: liaison.Marque.nom }))
    .filter((marque) => marque.id !== marqueActuelleId);

  const marquesIndirectes = {};
  for (const relation of graphe.relationsParCible.get(beneficiaireId) || []) {
    const sourceId = relation.beneficiaire_source_id;
    const source = graphe.beneficiaireParId.get(sourceId);
    if (!sourceId || !source || visites.has(sourceId)) continue;

    const marquesSource = marquesTransitives(graphe, sourceId, marqueActuelleId, new Set(visites));

    if (marquesSource.marquesDirectes.length > 0) {
      marquesIndirectes[source.nom] = [...(marquesIndirectes[source.nom] || []), ...marquesSource.marquesDirectes];
    }
    for (const [intermediaire, marques] of Object.entries(marquesSource.marquesIndirectes)) {
      if (marques.length > 0) marquesIndirectes[`${source.nom} → ${intermediaire}`] = marques;
    }
  }

  // Supprimer les doublons dans chaque groupe
  for (const [cle, marques] of Object.entries(marquesIndirectes)) {
    marquesIndirectes[cle] = marques.filter((marque, index) => marques.findIndex((m) => m.id === marque.id) === index);
  }

  return { marquesDirectes, marquesIndirectes };
}

/**
 * Construire la chaîne de bénéficiaires (chaque bénéficiaire une seule fois ;
 * les liens entre bénéficiaires sont dans relations_suivantes)
 */
function construireChaine(graphe, beneficiaireId, niveauActuel, visitedIds, marqueId, lienFinancierParent = '') {
  if (niveauActuel >= PROFONDEUR_MAX || visitedIds.has(beneficiaireId)) {
    return [];
  }

  const beneficiaire = graphe.beneficiaireParId.get(beneficiaireId);
  if (!beneficiaire) return [];
  visitedIds.add(beneficiaireId);

  const relationsSuivantes = (graphe.relationsParSource.get(beneficiaireId) || []).map(rel => ({
    id: rel.id,
    beneficiaire_source_id: rel.beneficiaire_source_id,
    beneficiaire_cible_id: rel.beneficiaire_cible_id,
    type_relation: 'actionnaire',
    description_relation: rel.description_relation
  }));

  const { marquesDirectes, marquesIndirectes } = marquesTransitives(graphe, beneficiaireId, marqueId);

  const noeuds = [{
    beneficiaire: {
      id: beneficiaire.id,
      nom: beneficiaire.nom,
      controverses: graphe.controversesParBeneficiaire.get(beneficiaireId) || [],
      impact_generique: beneficiaire.impact_generique,
      type_beneficiaire: beneficiaire.type_beneficiaire
    },
    niveau: niveauActuel,
    relations_suivantes: relationsSuivantes,
    lien_financier: lienFinancierParent || 'Lien financier non défini',
    marques_directes: marquesDirectes,
    marques_indirectes: marquesIndirectes
  }];

  for (const relation of relationsSuivantes) {
    noeuds.push(...construireChaine(
      graphe,
      relation.beneficiaire_cible_id,
      niveauActuel + 1,
      visitedIds,
      marqueId,
      relation.description_relation || 'Lien financier'
    ));
  }

  return noeuds;
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

    // Récupérer toutes les marques et leurs autres noms (produits et variantes) pour matcher le slug
    const [marques, autresNoms] = await Promise.all([
      toutesLesLignes(supabase, 'Marque', 'id, nom'),
      toutesLesLignes(supabase, 'marque_autre_nom', 'marque_id, nom, type'),
    ]);

    // Trouver la marque correspondant au slug, sinon celle dont un autre nom y correspond
    // (le site affiche alors la page de la marque, titrée du produit ou, pour une variante, du nom de la marque)
    const autreNom = autresNoms.find(a => slugify(a.nom) === slug);
    const marque = marques.find(m => slugify(m.nom) === slug)
      ?? (autreNom && marques.find(m => m.id === autreNom.marque_id));

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
    const [{ data: liaisonsBeneficiaires, error: liaisonsError }, graphe] = await Promise.all([
      supabase
        .from('Marque_beneficiaire')
        .select('beneficiaire_id, lien_financier')
        .eq('marque_id', marque.id)
        .order('id'),
      grapheRecent(),
    ]);

    if (liaisonsError) {
      throw liaisonsError;
    }

    const chaine_beneficiaires = [];
    const visitedIds = new Set();
    for (const liaison of liaisonsBeneficiaires) {
      chaine_beneficiaires.push(...construireChaine(
        graphe,
        liaison.beneficiaire_id,
        0,
        visitedIds,
        marque.id,
        liaison.lien_financier
      ));
    }
    const total_beneficiaires_chaine = new Set(chaine_beneficiaires.map(n => n.beneficiaire.id)).size;

    const result = {
      ...marqueComplete,
      autres_noms: autresNoms.filter(a => a.marque_id === marque.id && a.type === 'produit').map(a => a.nom),
      variantes: autresNoms.filter(a => a.marque_id === marque.id && a.type === 'variante').map(a => a.nom),
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
