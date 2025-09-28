/**
 * Netlify Function - Brands data with search capabilities
 */
import { createClient } from '@supabase/supabase-js';
import { recupererToutesMarquesTransitives } from './utils/marquesTransitives.js';
import { MetricsLogger } from './utils/metrics.js';
import { initSentry, sentryHandler } from './utils/sentry.js';
import { createServerlessCache } from './utils/serverlessCache.js';

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

// Utilisation du cache unifié
// TTL adapté automatiquement : 10min (recherche) ou 20min (liste complète)

// Algorithme récursif pour construire la chaîne de bénéficiaires
async function construireChaineRecursive(beneficiaireId, niveauActuel, visitedIds, profondeurMax = 5, lienFinancierParent = '') {
  // Éviter les cycles infinis et limiter la profondeur
  if (niveauActuel >= profondeurMax || visitedIds.has(beneficiaireId)) {
    return [];
  }

  // Marquer ce bénéficiaire comme visité
  visitedIds.add(beneficiaireId);

  try {
    // Récupérer le bénéficiaire actuel
    const { data: beneficiaire, error: beneficiaireError } = await supabase
      .from('Beneficiaires')
      .select(`
        id,
        nom,
        impact_generique,
        type_beneficiaire,
        created_at,
        updated_at,
        controverses:controverse_beneficiaire(*,Categorie!controverse_beneficiaire_categorie_id_fkey(*))
      `)
      .eq('id', beneficiaireId)
      .single();

    if (beneficiaireError || !beneficiaire) {
      visitedIds.delete(beneficiaireId);
      return [];
    }

    // Récupérer les relations suivantes
    const { data: relations } = await supabase
      .from('beneficiaire_relation')
      .select(`
        id,
        beneficiaire_source_id,
        beneficiaire_cible_id,
        description_relation,
        created_at,
        updated_at
      `)
      .eq('beneficiaire_source_id', beneficiaireId);

    const relationsSuivantes = (relations || []).map(rel => ({
      id: rel.id,
      beneficiaire_source_id: rel.beneficiaire_source_id,
      beneficiaire_cible_id: rel.beneficiaire_cible_id,
      type_relation: 'actionnaire', // Valeur par défaut
      description_relation: rel.description_relation,
      created_at: rel.created_at,
      updated_at: rel.updated_at
    }));

    // Créer le nœud actuel
    const nodeActuel = {
      beneficiaire: {
        id: beneficiaire.id,
        nom: beneficiaire.nom,
        controverses: beneficiaire.controverses || [],
        impact_generique: beneficiaire.impact_generique,
        type_beneficiaire: beneficiaire.type_beneficiaire,
        created_at: beneficiaire.created_at,
        updated_at: beneficiaire.updated_at
      },
      niveau: niveauActuel,
      relations_suivantes: relationsSuivantes,
      lien_financier: lienFinancierParent || 'Lien financier non défini',
      marques_directes: [],
      marques_indirectes: {}
    };

    // Résultat de la chaîne commençant par ce nœud
    const resultat = [nodeActuel];

    // Récursivement construire les chaînes suivantes
    for (const relation of relationsSuivantes) {
      if (relation.beneficiaire_cible_id && !visitedIds.has(relation.beneficiaire_cible_id)) {
        const chainesSuivantes = await construireChaineRecursive(
          relation.beneficiaire_cible_id,
          niveauActuel + 1,
          new Set(visitedIds), // Nouvelle copie pour chaque branche
          profondeurMax,
          relation.description_relation || 'Participation financière'
        );
        resultat.push(...chainesSuivantes);
      }
    }

    visitedIds.delete(beneficiaireId);
    return resultat;
  } catch (error) {
    console.error(`Erreur lors de la construction de la chaîne pour bénéficiaire ${beneficiaireId}:`, error);
    visitedIds.delete(beneficiaireId);
    return [];
  }
}

// Fonction pour enrichir la chaîne avec les marques liées
async function enrichirAvecMarquesLiees(chaineNodes, marqueId) {
  try {
    // Créer un map des bénéficiaires avec leurs marques liées
    const beneficiairesEnrichis = new Map();

    // Traiter chaque bénéficiaire de la chaîne
    for (const node of chaineNodes) {
      const beneficiaireId = node.beneficiaire.id;

      // Récupérer toutes les marques pour ce bénéficiaire
      const { data: toutesMarquesDuBeneficiaire, error: marquesError } = await supabase
        .from('Marque_beneficiaire')
        .select(`
          Marque!marque_id (id, nom)
        `)
        .eq('beneficiaire_id', beneficiaireId);

      if (marquesError) {
        console.error(`Erreur récupération marques pour bénéficiaire ${beneficiaireId}:`, marquesError);
        continue;
      }

      const toutesMarques = toutesMarquesDuBeneficiaire?.map(m => ({
        id: m.Marque.id,
        nom: m.Marque.nom
      })) || [];

      // Calculer les marques directes (exclure la marque actuelle de recherche)
      const marques_directes = toutesMarques.filter(m => m.id !== marqueId);

      // Utiliser la fonction récursive partagée
      const marquesTransitives = await recupererToutesMarquesTransitives(
        supabase,
        beneficiaireId,
        marqueId,
        new Set(),
        5
      );

      const marques_indirectes = marquesTransitives.marquesIndirectes;

      beneficiairesEnrichis.set(beneficiaireId, {
        marques_directes,
        marques_indirectes
      });
    }

    // Enrichir chaque node de la chaîne avec les marques liées
    return chaineNodes.map(node => {
      const enrichissement = beneficiairesEnrichis.get(node.beneficiaire.id);
      if (enrichissement) {
        return {
          ...node,
          marques_directes: enrichissement.marques_directes,
          marques_indirectes: enrichissement.marques_indirectes
        };
      }
      // Fallback avec tableaux vides
      return {
        ...node,
        marques_directes: [],
        marques_indirectes: {}
      };
    });

  } catch (error) {
    console.error('Erreur lors de l\'enrichissement avec les marques liées:', error);
    return chaineNodes.map(node => ({
      ...node,
      marques_directes: [],
      marques_indirectes: {}
    }));
  }
}

// Fonction pour construire la chaîne complète de bénéficiaires pour une marque
async function construireChaineCompletePourMarque(marqueId, profondeurMax = 5) {
  try {
    // Récupérer les bénéficiaires directs de cette marque
    const { data: liaisonsBeneficiaires, error: liaisonsError } = await supabase
      .from('Marque_beneficiaire')
      .select(`
        beneficiaire_id,
        lien_financier,
        impact_specifique
      `)
      .eq('marque_id', parseInt(marqueId));

    if (liaisonsError || !liaisonsBeneficiaires || liaisonsBeneficiaires.length === 0) {
      return {
        chaine_beneficiaires: [],
        total_beneficiaires_chaine: 0,
        profondeur_max_chaine: 0
      };
    }

    // Construire les chaînes complètes
    const chaineFusionnee = [];

    for (const liaison of liaisonsBeneficiaires) {
      if (!liaison.beneficiaire_id) continue;

      const chaine = await construireChaineRecursive(
        liaison.beneficiaire_id,
        0, // Niveau 0 pour le bénéficiaire direct
        new Set(),
        profondeurMax,
        liaison.lien_financier || 'Lien financier direct'
      );

      chaineFusionnee.push(...chaine);
    }

    // Supprimer les doublons par ID de bénéficiaire
    const chaineUnique = chaineFusionnee.filter((node, index, array) =>
      array.findIndex(n => n.beneficiaire.id === node.beneficiaire.id) === index
    );

    // Trier par niveau puis par nom
    chaineUnique.sort((a, b) => {
      if (a.niveau !== b.niveau) return a.niveau - b.niveau;
      return a.beneficiaire.nom.localeCompare(b.beneficiaire.nom);
    });

    // Enrichir avec les marques liées
    const chaineEnrichie = await enrichirAvecMarquesLiees(chaineUnique, marqueId);

    return {
      chaine_beneficiaires: chaineEnrichie,
      total_beneficiaires_chaine: chaineEnrichie.length,
      profondeur_max_chaine: chaineEnrichie.length > 0 ? Math.max(...chaineEnrichie.map(node => node.niveau)) : 0
    };

  } catch (error) {
    console.error('Erreur lors de la construction de la chaîne complète:', error);
    return {
      chaine_beneficiaires: [],
      total_beneficiaires_chaine: 0,
      profondeur_max_chaine: 0
    };
  }
}

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
    
    // Déterminer le type de cache selon la requête
    const endpointType = search ? 'marques_search' : 'marques_all';
    const params = { search: search || null, limit, offset };
    const cached = cache.get(endpointType, params);

    if (cached) {
      MetricsLogger.logCache(functionName, true);
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'X-Data-Source': 'odm-api-marques-cache-unified',
          'X-Cache': 'HIT',
          'X-Cache-Type': endpointType
        },
        body: JSON.stringify(cached)
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
      // Order embedded events by their event date (newest first)
      .order('date', { ascending: false, referencedTable: 'Evenement' })
      .order('nom');

    // Apply search filter if provided
    if (search) {
      // Exact brand match (case-insensitive) - no wildcards
      query = query.ilike('nom', search);
    }

    // Apply pagination
    const { data: marques, error } = await query
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) throw error;

    // Transformation simplifiée utilisant les données des JOINs
    const transformedBrands = await Promise.all(
      (marques || []).map(async (marque) => {
        const liaisonsDirectes = marque.Marque_beneficiaire || [];

        // Construire les données selon le type de requête
        let donneesChaine = {
          chaine_beneficiaires: [],
          total_beneficiaires_chaine: 0,
          profondeur_max_chaine: 0
        };
        let beneficiaires_marque = [];

        if (search) {
          // Pour les recherches : utiliser la nouvelle logique de chaîne complète
          donneesChaine = await construireChaineCompletePourMarque(marque.id, 5);
        } else {
          // Pour les listes : utiliser l'ancienne logique simplifiée (compatible avec l'extension)
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
                beneficiaire: {
                  ...beneficiaireClean,
                  controverses: controverses,
                  marques_directes: marques_directes,
                  marques_indirectes: marques_indirectes
                }
              });
            }
          }
        }

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
          condamnation_judiciaire: ev.condamnation_judiciaire === true,
          categorie: ev.Categorie || null
        }));

        return {
          id: marqueClean.id,
          nom: marqueClean.nom,
          // Événements simplifiés
          evenements: evenementsTransformed,
          // Secteur (seulement si nécessaire pour BoycottTips)
          message_boycott_tips: marqueClean.message_boycott_tips,
          secteur_marque: SecteurMarque ? {
            nom: SecteurMarque.nom,
            message_boycott_tips: SecteurMarque.message_boycott_tips
          } : null,
          // Données de chaîne (seulement pour recherche)
          ...donneesChaine
        };
      })
    );

    // Cache unifié avec TTL automatique
    cache.set(endpointType, transformedBrands, params);

    MetricsLogger.logCache(functionName, false);

    console.log(`Brands loaded: ${transformedBrands.length} brands (search: ${search || 'none'})`);
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'X-Data-Source': 'odm-api-marques-fresh-unified',
        'X-Cache': 'MISS',
        'X-Cache-Type': endpointType,
        'X-Cache-Metrics': JSON.stringify(cache.getMetrics())
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