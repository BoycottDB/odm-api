/**
 * Module utilitaire pour calculer les marques transitives des bénéficiaires
 * Utilisé par marques.js et beneficiaires-chaine.js
 * 
 * Résout le bug : BlackRock doit voir les marques de L'Oréal via Nestlé
 */

// Cache partagé pour les marques transitives
const marquesTransitivesCache = new Map();
const MARQUES_TRANSITIVES_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Fonction récursive pour récupérer TOUTES les marques transitives d'un bénéficiaire
 * @param {Object} supabase - Client Supabase
 * @param {number} beneficiaireId - ID du bénéficiaire
 * @param {number} marqueActuelleId - ID de la marque actuelle (à exclure)
 * @param {Set} visited - Set des bénéficiaires déjà visités (protection anti-cycles)
 * @param {number} profondeurMax - Profondeur maximale de récursion
 * @returns {Object} { marquesDirectes: Array, marquesIndirectes: Object }
 */
export async function recupererToutesMarquesTransitives(supabase, beneficiaireId, marqueActuelleId, visited = new Set(), profondeurMax = 5) {
  // Protection anti-cycles et limitation profondeur
  if (visited.has(beneficiaireId) || visited.size >= profondeurMax) {
    return { marquesDirectes: [], marquesIndirectes: {} };
  }

  // Vérifier le cache
  const cacheKey = `marques-transitives-${beneficiaireId}-${marqueActuelleId}`;
  const cached = marquesTransitivesCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < MARQUES_TRANSITIVES_TTL) {
    return cached.data;
  }

  visited.add(beneficiaireId);

  try {
    // 1. Récupérer toutes les marques directes du bénéficiaire
    const { data: marquesDirectesBrutes } = await supabase
      .from('Marque_beneficiaire')
      .select(`
        Marque!marque_id (id, nom)
      `)
      .eq('beneficiaire_id', beneficiaireId);

    const marquesDirectes = (marquesDirectesBrutes || [])
      .map(m => ({ id: m.Marque.id, nom: m.Marque.nom }))
      .filter(m => m.id !== marqueActuelleId); // Exclure la marque de recherche

    // 2. Récupérer les relations entrantes (bénéficiaires qui profitent À ce bénéficiaire)
    const { data: relationsEntrantes } = await supabase
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

    let marquesIndirectes = {};

    // 3. Pour chaque relation entrante, récupérer récursivement TOUTES ses marques
    if (relationsEntrantes?.length > 0) {
      for (const relation of relationsEntrantes) {
        if (!relation.beneficiaire_source_id || visited.has(relation.beneficiaire_source_id)) {
          continue;
        }

        // Récursion : récupérer TOUTES les marques du bénéficiaire source
        const marquesSource = await recupererToutesMarquesTransitives(
          supabase,
          relation.beneficiaire_source_id,
          marqueActuelleId,
          new Set(visited), // Nouvelle copie pour chaque branche
          profondeurMax
        );

        const nomBeneficiaireSource = relation.beneficiaire_source.nom;
        
        // Ajouter les marques directes du bénéficiaire source
        if (marquesSource.marquesDirectes.length > 0) {
          if (!marquesIndirectes[nomBeneficiaireSource]) {
            marquesIndirectes[nomBeneficiaireSource] = [];
          }
          marquesIndirectes[nomBeneficiaireSource].push(...marquesSource.marquesDirectes);
        }

        // Ajouter les marques indirectes du bénéficiaire source (transitives complètes)
        for (const [intermediaire, marques] of Object.entries(marquesSource.marquesIndirectes)) {
          const cle = `${nomBeneficiaireSource} → ${intermediaire}`;
          if (marques.length > 0) {
            marquesIndirectes[cle] = marques;
          }
        }
      }

      // Supprimer les doublons dans chaque groupe
      for (const [cle, marques] of Object.entries(marquesIndirectes)) {
        marquesIndirectes[cle] = marques.filter((marque, index, array) => 
          array.findIndex(m => m.id === marque.id) === index
        );
      }
    }

    const resultat = {
      marquesDirectes,
      marquesIndirectes
    };

    // Mise en cache
    marquesTransitivesCache.set(cacheKey, {
      data: resultat,
      timestamp: Date.now()
    });

    return resultat;

  } catch (error) {
    console.error(`Erreur récupération marques transitives pour bénéficiaire ${beneficiaireId}:`, error);
    return { marquesDirectes: [], marquesIndirectes: {} };
  } finally {
    visited.delete(beneficiaireId);
  }
}

/**
 * Nettoyer le cache (utile pour les tests ou la maintenance)
 */
export function clearMarquesTransitivesCache() {
  marquesTransitivesCache.clear();
}

/**
 * Obtenir les stats du cache (pour monitoring)
 */
export function getMarquesTransitivesCacheStats() {
  return {
    size: marquesTransitivesCache.size,
    entries: Array.from(marquesTransitivesCache.keys())
  };
}