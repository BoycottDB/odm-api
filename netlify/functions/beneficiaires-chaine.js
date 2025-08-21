import { createClient } from '@supabase/supabase-js';

// Configuration Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Variables d\'environnement Supabase manquantes');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Cache in-memory pour les chaînes de bénéficiaires
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes - données relativement stables

// Headers CORS et cache
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800', // 10min cache + 30min stale
  'X-Data-Source': 'extension-api-chaine'
};

// Fonction utilitaire pour les réponses
const successResponse = (data) => ({
  statusCode: 200,
  headers: corsHeaders,
  body: JSON.stringify(data)
});

const errorResponse = (statusCode, message) => ({
  statusCode,
  headers: corsHeaders,
  body: JSON.stringify({ error: message })
});

// Fonction pour enrichir la chaîne avec les marques liées - traite TOUS les bénéficiaires de la chaîne
async function enrichirAvecMarquesLiees(chaineNodes, marqueId) {
  try {
    // Créer un map des bénéficiaires avec leurs marques liées
    const beneficiairesEnrichis = new Map();
    
    // Traiter chaque bénéficiaire de la chaîne (pas seulement ceux liés à la marque de recherche)
    for (const node of chaineNodes) {
      const beneficiaireId = node.beneficiaire.id;
      
      console.log(`Enrichissement du bénéficiaire ${beneficiaireId}: ${node.beneficiaire.nom}`);
      
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

      console.log(`Bénéficiaire ${node.beneficiaire.nom} - Toutes marques:`, toutesMarques.length);

      // Calculer les marques directes (exclure la marque actuelle de recherche)
      const marques_directes = toutesMarques.filter(m => m.id !== marqueId);

      // Calculer les marques indirectes via les relations entrantes
      const marques_indirectes = {};
      
      const { data: relationsEntrantes, error: relError } = await supabase
        .from('beneficiaire_relation')
        .select(`
          id,
          beneficiaire_source_id,
          description_relation,
          beneficiaire_source:Beneficiaires!beneficiaire_relation_beneficiaire_source_id_fkey (
            id,
            nom
          )
        `)
        .eq('beneficiaire_cible_id', beneficiaireId);

      if (relError) {
        console.error(`Erreur récupération relations pour bénéficiaire ${beneficiaireId}:`, relError);
      } else {
        console.log(`Bénéficiaire ${node.beneficiaire.nom} - Relations entrantes:`, relationsEntrantes?.length || 0);
      }

      if (relationsEntrantes?.length > 0) {
        for (const relationEntrante of relationsEntrantes) {
          // Pour chaque bénéficiaire source, récupérer toutes ses marques
          const { data: marquesIntermediaires, error: intError } = await supabase
            .from('Marque_beneficiaire')
            .select(`
              Marque!marque_id (id, nom)
            `)
            .eq('beneficiaire_id', relationEntrante.beneficiaire_source_id);

          if (intError) {
            console.error(`Erreur récupération marques intermédiaires:`, intError);
            continue;
          }

          if (marquesIntermediaires?.length > 0) {
            const nomBeneficiaireIntermediaire = relationEntrante.beneficiaire_source.nom;
            // Exclure la marque actuelle de recherche des marques indirectes
            const marquesFiltered = marquesIntermediaires
              .map(m => ({ id: m.Marque.id, nom: m.Marque.nom }))
              .filter(m => m.id !== marqueId);
            
            console.log(`Via ${nomBeneficiaireIntermediaire}: ${marquesFiltered.length} marques`);
            
            if (marquesFiltered.length > 0) {
              marques_indirectes[nomBeneficiaireIntermediaire] = marquesFiltered;
            }
          }
        }
      }

      console.log(`Résultat pour ${node.beneficiaire.nom}:`, {
        marques_directes: marques_directes.length,
        marques_indirectes: Object.keys(marques_indirectes).length
      });

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
        controverses:controverse_beneficiaire(*)
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
      pourcentage_participation: undefined,
      created_at: rel.created_at,
      updated_at: rel.updated_at
    }));

    // Les marques liées seront récupérées plus tard via l'endpoint /marques optimisé
    const marquesDirectesFormattees = [];
    const marquesIndirectes = {};

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
      marques_directes: marquesDirectesFormattees,
      marques_indirectes: marquesIndirectes
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

export const handler = async (event) => {
  // Gestion CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  const { marqueId, profondeur } = event.queryStringParameters || {};
  
  if (!marqueId) {
    return errorResponse(400, 'ID de marque requis');
  }

  const profondeurMax = parseInt(profondeur || '5');
  const cacheKey = `chaine-${marqueId}-${profondeurMax}`;

  try {
    // Vérifier le cache
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`Cache hit pour marque ${marqueId}`);
        return successResponse(cached.data);
      }
    }

    console.log(`Cache miss pour marque ${marqueId}, construction de la chaîne...`);

    // 1. Récupérer la marque
    const { data: marque, error: marqueError } = await supabase
      .from('Marque')
      .select('id, nom')
      .eq('id', parseInt(marqueId))
      .single();

    if (marqueError || !marque) {
      return errorResponse(404, 'Marque non trouvée');
    }

    // 2. Récupérer les bénéficiaires directs de cette marque
    const { data: liaisonsBeneficiaires, error: liaisonsError } = await supabase
      .from('Marque_beneficiaire')
      .select(`
        beneficiaire_id,
        lien_financier,
        impact_specifique,
        Beneficiaires!marque_beneficiaire_beneficiaire_id_fkey (
          id,
          nom,
          impact_generique,
          type_beneficiaire,
          controverses:controverse_beneficiaire(*)
        )
      `)
      .eq('marque_id', parseInt(marqueId));

    if (liaisonsError) {
      console.error('Erreur récupération liaisons bénéficiaires:', liaisonsError);
      return errorResponse(500, 'Erreur lors de la récupération des données');
    }

    if (!liaisonsBeneficiaires || liaisonsBeneficiaires.length === 0) {
      const resultat = {
        marque_nom: marque.nom,
        marque_id: marque.id,
        chaine: [],
        profondeur_max: 0
      };
      
      // Cache même les résultats vides
      cache.set(cacheKey, { data: resultat, timestamp: Date.now() });
      return successResponse(resultat);
    }

    // 3. Construire les chaînes complètes
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

    // Enrichir avec les marques liées en utilisant l'endpoint /marques optimisé
    const chaineEnrichie = await enrichirAvecMarquesLiees(chaineUnique, marque.id);

    const resultat = {
      marque_nom: marque.nom,
      marque_id: marque.id,
      chaine: chaineEnrichie,
      profondeur_max: chaineEnrichie.length > 0 ? Math.max(...chaineEnrichie.map(node => node.niveau)) : 0
    };

    // Mettre en cache
    cache.set(cacheKey, { data: resultat, timestamp: Date.now() });

    console.log(`Chaîne construite pour ${marque.nom}: ${chaineUnique.length} nœuds, profondeur ${resultat.profondeur_max}`);

    return successResponse(resultat);

  } catch (error) {
    console.error('Erreur dans beneficiaires-chaine:', error);
    
    // Masquer l'erreur en production
    if (process.env.NODE_ENV === 'production') {
      return errorResponse(500, 'Erreur serveur');
    } else {
      return errorResponse(500, error.message);
    }
  }
};