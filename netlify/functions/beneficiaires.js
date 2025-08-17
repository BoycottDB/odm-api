/**
 * Netlify Function - Beneficiaires data (successeur de dirigeants.js)
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
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export const handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'X-Data-Source': 'extension-api-beneficiaires'
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
    const { id, marqueId } = event.queryStringParameters || {};
    
    // Check cache
    const cacheKey = id ? `beneficiaire_${id}` : marqueId ? `beneficiaires_marque_${marqueId}` : 'beneficiaires_all';
    const now = Date.now();
    const cached = cache.get(cacheKey);
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      console.log('Cache hit for beneficiaires');
      return {
        statusCode: 200,
        headers: { ...headers, 'X-Cache': 'HIT' },
        body: JSON.stringify(cached.data)
      };
    }

    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    if (id) {
      // Get specific beneficiaire with their brand relationships
      const { data: beneficiaire, error } = await supabase
        .from('Beneficiaires')
        .select(`
          id, nom, impact_generique, type_beneficiaire, created_at, updated_at,
          controverses:controverse_beneficiaire(*),
          Marque_beneficiaire!marque_beneficiaire_beneficiaire_id_fkey (
            id,
            marque_id,
            lien_financier,
            impact_specifique,
            Marque!marque_id (
              id,
              nom
            )
          )
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      // Transform to BeneficiaireWithMarques format
      const transformedBeneficiaire = {
        id: beneficiaire.id,
        nom: beneficiaire.nom,
        // ✅ NOUVEAU : Transformer controverses structurées → format legacy
        controverses: beneficiaire.controverses || [],
        impact_generique: beneficiaire.impact_generique,
        type_beneficiaire: beneficiaire.type_beneficiaire || 'individu',
        marques: beneficiaire.Marque_beneficiaire?.map(liaison => ({
          id: liaison.Marque.id,
          nom: liaison.Marque.nom,
          lien_financier: liaison.lien_financier,
          impact_specifique: liaison.impact_specifique,
          liaison_id: liaison.id
        })) || []
      };

      cache.set(cacheKey, {
        data: transformedBeneficiaire,
        timestamp: now
      });

      return {
        statusCode: 200,
        headers: { ...headers, 'X-Cache': 'MISS' },
        body: JSON.stringify(transformedBeneficiaire)
      };

    } else if (marqueId) {
      // Get beneficiaires for specific marque WITH TRANSITIVE RELATIONS
      // 1. Récupérer les bénéficiaires directement liés à la marque
      const { data: liaisonsDirectes, error: directError } = await supabase
        .from('Marque_beneficiaire')
        .select(`
          id,
          marque_id,
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
            controverses:controverse_beneficiaire(*)
          )
        `)
        .eq('marque_id', marqueId)
        .order('created_at', { ascending: false });

      if (directError) throw directError;

      // 2. Pour chaque bénéficiaire direct, récupérer ses relations transitives
      const beneficiairesTransitifs = [];
      
      for (const liaison of liaisonsDirectes || []) {
        // Récupérer les bénéficiaires qui ont des relations vers ce bénéficiaire
        const { data: relationsTransitives, error: transError } = await supabase
          .from('beneficiaire_relation')
          .select(`
            id,
            beneficiaire_source_id,
            beneficiaire_cible_id,
            description_relation,
            beneficiaire_source:Beneficiaires!beneficiaire_relation_beneficiaire_source_id_fkey (
              id,
              nom,
              impact_generique,
              type_beneficiaire,
              controverses:controverse_beneficiaire(*)
            )
          `)
          .eq('beneficiaire_cible_id', liaison.Beneficiaires.id);

        if (!transError && relationsTransitives?.length > 0) {
          beneficiairesTransitifs.push(...relationsTransitives);
        }
      }

      // 3. Combiner liaisons directes et transitives
      const liaisons = liaisonsDirectes || [];

      if (error) throw error;

      // 4. Traiter les liaisons directes
      const transformedDirectes = await Promise.all(
        liaisons.map(async (liaison) => {
          // Récupérer toutes les marques liées à ce bénéficiaire
          const { data: toutesMarques, error: marquesError } = await supabase
            .from('Marque_beneficiaire')
            .select(`
              Marque!marque_id (
                id,
                nom
              )
            `)
            .eq('beneficiaire_id', liaison.Beneficiaires.id);

          if (marquesError) {
            console.warn('Erreur récupération toutes marques:', marquesError);
          }

          // Séparer les marques directes et indirectes
          const marquesDirectes = toutesMarques?.filter(m => m.Marque.id !== parseInt(marqueId))
            .map(m => ({
              id: m.Marque.id,
              nom: m.Marque.nom
            })) || [];

          // Pour les marques indirectes, on collectera plus tard via les relations transitives
          const marquesIndirectes = {};

          return {
            id: liaison.id,
            dirigeant_id: liaison.Beneficiaires.id, // Alias pour compatibilité
            dirigeant_nom: liaison.Beneficiaires.nom,
            // ✅ Transformation pour compatibilité extension : concaténer les titres
            controverses: (liaison.Beneficiaires.controverses || [])
              .map(c => c.titre)
              .join(' | ') || '',
            // ✅ Transformation sources : extraire les URLs
            sources: (liaison.Beneficiaires.controverses || [])
              .map(c => c.source_url) || [],
            lien_financier: liaison.lien_financier,
            impact_description: liaison.impact_specifique || liaison.Beneficiaires.impact_generique || 'Impact à définir',
            type_beneficiaire: liaison.Beneficiaires.type_beneficiaire || 'groupe',
            marque_id: liaison.marque_id,
            // ✅ NOUVEAU : Structure séparée pour marques directes/indirectes
            marques_directes: marquesDirectes,
            marques_indirectes: marquesIndirectes,
            // Garder l'ancien format pour rétrocompatibilité
            toutes_marques: toutesMarques?.map(m => ({
              id: m.Marque.id,
              nom: m.Marque.nom
            })) || [],
            source_lien: 'direct'
          };
        })
      );

      // 5. Note: La logique des marques indirectes est maintenant dans marques.js
      // car l'application utilise l'endpoint /marques, pas /beneficiaires

      // 6. Traiter les bénéficiaires transitifs comme entités séparées
      const transformedTransitifs = await Promise.all(
        beneficiairesTransitifs.map(async (relation) => {
          // Récupérer toutes les marques liées à ce bénéficiaire
          const { data: toutesMarques, error: marquesError } = await supabase
            .from('Marque_beneficiaire')
            .select(`
              Marque!marque_id (
                id,
                nom
              )
            `)
            .eq('beneficiaire_id', relation.beneficiaire_source.id);

          if (marquesError) {
            console.warn('Erreur récupération toutes marques transitif:', marquesError);
          }

          const marquesDirectes = toutesMarques?.filter(m => m.Marque.id !== parseInt(marqueId))
            .map(m => ({
              id: m.Marque.id,
              nom: m.Marque.nom
            })) || [];

          // Trouver le bénéficiaire cible pour le message
          const beneficiaireCible = liaisons.find(l => l.Beneficiaires.id === relation.beneficiaire_cible_id);
          const nomCible = beneficiaireCible?.Beneficiaires.nom || 'inconnu';

          return {
            id: `transitif-${relation.id}`, // ID unique pour éviter les doublons
            dirigeant_id: relation.beneficiaire_source.id,
            dirigeant_nom: relation.beneficiaire_source.nom,
            controverses: (relation.beneficiaire_source.controverses || [])
              .map(c => c.titre)
              .join(' | ') || '',
            sources: (relation.beneficiaire_source.controverses || [])
              .map(c => c.source_url) || [],
            lien_financier: relation.description_relation,
            impact_description: relation.beneficiaire_source.impact_generique || 'Impact à définir',
            type_beneficiaire: relation.beneficiaire_source.type_beneficiaire || 'groupe',
            marque_id: parseInt(marqueId), // Marque d'origine
            // ✅ NOUVEAU : Structure séparée pour marques directes/indirectes
            marques_directes: marquesDirectes,
            marques_indirectes: {}, // Pas de marques indirectes pour les transitifs
            // Garder l'ancien format pour rétrocompatibilité
            toutes_marques: toutesMarques?.map(m => ({
              id: m.Marque.id,
              nom: m.Marque.nom
            })) || [],
            source_lien: 'transitif'
          };
        })
      );

      // 7. Combiner et retourner tous les bénéficiaires
      const allTransformed = [...transformedDirectes, ...transformedTransitifs];

      cache.set(cacheKey, {
        data: allTransformed,
        timestamp: now
      });

      return {
        statusCode: 200,
        headers: { ...headers, 'X-Cache': 'MISS' },
        body: JSON.stringify(allTransformed)
      };

    } else {
      // Get all beneficiaires with their brand relationships
      const { data: beneficiaires, error } = await supabase
        .from('Beneficiaires')
        .select(`
          id, nom, impact_generique, type_beneficiaire, created_at, updated_at,
          controverses:controverse_beneficiaire(*),
          Marque_beneficiaire!marque_beneficiaire_beneficiaire_id_fkey (
            id,
            marque_id,
            lien_financier,
            impact_specifique,
            Marque!marque_id (
              id,
              nom
            )
          )
        `)
        .order('nom');

      if (error) throw error;

      // Transform to BeneficiaireWithMarques format
      const transformedBeneficiaires = beneficiaires?.map(beneficiaire => ({
        id: beneficiaire.id,
        nom: beneficiaire.nom,
        // ✅ NOUVEAU : Controverses structurées
        controverses: beneficiaire.controverses || [],
        impact_generique: beneficiaire.impact_generique,
        type_beneficiaire: beneficiaire.type_beneficiaire || 'individu',
        marques: beneficiaire.Marque_beneficiaire?.map(liaison => ({
          id: liaison.Marque.id,
          nom: liaison.Marque.nom,
          lien_financier: liaison.lien_financier,
          impact_specifique: liaison.impact_specifique,
          liaison_id: liaison.id
        })) || []
      })) || [];

      cache.set(cacheKey, {
        data: transformedBeneficiaires,
        timestamp: now
      });

      console.log(`Beneficiaires loaded: ${transformedBeneficiaires.length} beneficiaires`);
      return {
        statusCode: 200,
        headers: { ...headers, 'X-Cache': 'MISS' },
        body: JSON.stringify(transformedBeneficiaires)
      };
    }

  } catch (error) {
    console.error('Beneficiaires endpoint error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Erreur serveur lors de la récupération des bénéficiaires',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};