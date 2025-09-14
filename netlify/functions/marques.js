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
    const { search, limit = '100', offset = '0' } = event.queryStringParameters || {};
    
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

    // Build query - Architecture V2 avec Marque_beneficiaire et controverses structurées + événements et catégories
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
            updated_at
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

    // Transform for frontend compatibility avec relations transitives
    const transformedBrands = await Promise.all(
      (marques || []).map(async (marque) => {
        // 1. Récupérer les bénéficiaires directement liés à la marque
        const liaisonsDirectes = marque.Marque_beneficiaire || [];
        
        // 2. Pour chaque bénéficiaire direct, récupérer ses relations transitives
        const beneficiairesTransitifs = [];
        
        for (const liaison of liaisonsDirectes) {
          if (liaison.Beneficiaires) {
            // Récupérer les bénéficiaires qui bénéficient DE ce bénéficiaire (relations sortantes)
            // Logique: si Nestlé → BlackRock, alors pour Herta (qui va vers Nestlé), BlackRock est transitif
            const { data: relationsTransitives, error: transError } = await supabase
              .from('beneficiaire_relation')
              .select(`
                id,
                beneficiaire_source_id,
                beneficiaire_cible_id,
                description_relation,
                beneficiaire_cible:Beneficiaires!beneficiaire_relation_beneficiaire_cible_id_fkey (
                  id,
                  nom,
                  impact_generique,
                  type_beneficiaire
                )
              `)
              .eq('beneficiaire_source_id', liaison.Beneficiaires.id);

            if (!transError && relationsTransitives?.length > 0) {
              beneficiairesTransitifs.push(...relationsTransitives.map(rel => ({
                ...rel,
                marque_cible_id: marque.id,
                nom_source: liaison.Beneficiaires.nom // Nom du bénéficiaire source (intermédiaire)
              })));
            }
          }
        }
        
        // 3. Transformation des bénéficiaires directs
        const beneficiaires_marque = [];
        
        for (const liaison of liaisonsDirectes) {
          if (liaison.Beneficiaires) {
            // Récupérer toutes les marques pour ce bénéficiaire
            const { data: toutesMarquesDuBeneficiaire } = await supabase
              .from('Marque_beneficiaire')
              .select(`
                Marque!marque_id (id, nom)
              `)
              .eq('beneficiaire_id', liaison.Beneficiaires.id);
            
            const toutesMarques = toutesMarquesDuBeneficiaire?.map(m => {
              return { id: m.Marque.id, nom: m.Marque.nom };
            }) || [];

            // Calculer les marques directes (exclure la marque actuelle)
            const marques_directes = toutesMarques.filter(m => m.id !== marque.id);

            // ✅ NOUVELLE LOGIQUE : Calculer TOUTES les marques transitives récursivement (bénéficiaires directs)
            const marquesTransitivesDirect = await recupererToutesMarquesTransitives(
              supabase,
              liaison.Beneficiaires.id,
              marque.id,
              new Set(),
              5
            );
            
            const marques_indirectes = marquesTransitivesDirect.marquesIndirectes;

            // Récupérer les controverses structurées pour ce bénéficiaire
            const { data: controverses } = await supabase
              .from('controverse_beneficiaire')
              .select('*,Categorie!controverse_beneficiaire_categorie_id_fkey(*)')
              .eq('beneficiaire_id', liaison.Beneficiaires.id)
              .order('date', { ascending: false, nullsFirst: false });
            
            beneficiaires_marque.push({
              id: liaison.id,
              lien_financier: liaison.lien_financier,
              impact_specifique: liaison.impact_specifique,
              source_lien: 'direct',
              beneficiaire: {
                ...liaison.Beneficiaires,
                controverses: controverses || [], // ✅ Nouvelles controverses structurées
                toutes_marques: toutesMarques,
                marques_directes: marques_directes, // ✅ Nouvelles propriétés
                marques_indirectes: marques_indirectes // ✅ Nouvelles propriétés
              }
            });
          }
        }
        
        // 4. Transformation des bénéficiaires transitifs
        for (const relation of beneficiairesTransitifs) {
          // Récupérer toutes les marques pour ce bénéficiaire transitif (cible de la relation)
          const { data: toutesMarquesDuBeneficiaire } = await supabase
            .from('Marque_beneficiaire')
            .select(`
              Marque!marque_id (id, nom)
            `)
            .eq('beneficiaire_id', relation.beneficiaire_cible.id);
          
          const toutesMarques = toutesMarquesDuBeneficiaire?.map(m => {
            return { id: m.Marque.id, nom: m.Marque.nom };
          }) || [];

          // Calculer les marques directes (exclure la marque actuelle)
          const marques_directes = toutesMarques.filter(m => m.id !== marque.id);

          // ✅ NOUVELLE LOGIQUE : Calculer TOUTES les marques transitives récursivement
          // Résout le bug : BlackRock doit voir les marques de L'Oréal via Nestlé
          const marquesTransitives = await recupererToutesMarquesTransitives(
            supabase,
            relation.beneficiaire_cible.id, // ID du bénéficiaire transitif (ex: BlackRock)
            marque.id, // ID de la marque actuelle (à exclure)
            new Set(),
            5 // Profondeur max
          );
          
          const marques_indirectes = marquesTransitives.marquesIndirectes;

          // Récupérer les controverses structurées pour ce bénéficiaire transitif (cible)
          const { data: controverses } = await supabase
            .from('controverse_beneficiaire')
            .select('*,Categorie!controverse_beneficiaire_categorie_id_fkey(*)')
            .eq('beneficiaire_id', relation.beneficiaire_cible.id)
            .order('date', { ascending: false, nullsFirst: false });
          
          beneficiaires_marque.push({
            id: `transitif-${relation.id}`, // ID unique pour éviter les doublons
            lien_financier: `${relation.description_relation}`,
            impact_specifique: relation.beneficiaire_cible.impact_generique || undefined,
            source_lien: 'transitif',
            beneficiaire_parent_nom: relation.nom_source, // ✅ NOUVEAU : nom du bénéficiaire intermédiaire
            beneficiaire: {
              ...relation.beneficiaire_cible,
              controverses: controverses || [],
              toutes_marques: toutesMarques,
              marques_directes: marques_directes, // ✅ Nouvelles propriétés
              marques_indirectes: marques_indirectes // ✅ Nouvelles propriétés
            }
          });
        }
        
        // Compatibility: Premier bénéficiaire pour dirigeant_controverse avec transformation legacy
        let dirigeant_controverse = null;
        if (beneficiaires_marque.length > 0) {
          const premierBeneficiaire = beneficiaires_marque[0];
          const controversesStructurees = premierBeneficiaire.beneficiaire.controverses || [];
          
          dirigeant_controverse = {
            id: premierBeneficiaire.id,
            marque_id: marque.id,
            beneficiaire_id: premierBeneficiaire.beneficiaire.id,
            dirigeant_nom: premierBeneficiaire.beneficiaire.nom,
            // ✅ Transformation legacy : concaténer les titres
            controverses: controversesStructurees
              .map(c => c.titre)
              .join(' | ') || '',
            lien_financier: premierBeneficiaire.lien_financier,
            impact_description: premierBeneficiaire.impact_specifique || premierBeneficiaire.beneficiaire.impact_generique || '',
            // ✅ Transformation legacy : extraire les URLs
            sources: controversesStructurees
              .map(c => c.source_url) || [],
            created_at: premierBeneficiaire.beneficiaire.created_at,
            updated_at: premierBeneficiaire.beneficiaire.updated_at,
            toutes_marques: premierBeneficiaire.beneficiaire.toutes_marques,
            type_beneficiaire: premierBeneficiaire.beneficiaire.type_beneficiaire,
            source_lien: premierBeneficiaire.source_lien || 'direct'
          };
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
        
        return {
          ...marque,
          // Événements et catégories
          evenements,
          categories,
          // Statistiques
          nbControverses,
          nbCondamnations,
          nbDirigeantsControverses,
          // Nouvelles structures
          beneficiaires_marque, // ✅ Nouvelle structure V2
          dirigeant_controverse, // ✅ Rétrocompatibilité
          secteur_marque: marque.SecteurMarque || null
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