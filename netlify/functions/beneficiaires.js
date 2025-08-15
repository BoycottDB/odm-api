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
          *,
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
        controverses: beneficiaire.controverses,
        sources: beneficiaire.sources,
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
      // Get beneficiaires for specific marque (pour compatibilité API dirigeants)
      const { data: liaisons, error } = await supabase
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
            controverses,
            sources,
            impact_generique,
            type_beneficiaire,
            created_at,
            updated_at
          )
        `)
        .eq('marque_id', marqueId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Pour chaque liaison, récupérer toutes les marques liées au même bénéficiaire
      const transformedLiaisons = await Promise.all(
        (liaisons || []).map(async (liaison) => {
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

          const toutesMarquesFormatted = toutesMarques?.map(m => ({
            id: m.Marque.id,
            nom: m.Marque.nom
          })) || [];

          return {
            id: liaison.id,
            dirigeant_id: liaison.Beneficiaires.id, // Alias pour compatibilité
            dirigeant_nom: liaison.Beneficiaires.nom,
            controverses: liaison.Beneficiaires.controverses,
            sources: liaison.Beneficiaires.sources,
            lien_financier: liaison.lien_financier,
            impact_description: liaison.impact_specifique || liaison.Beneficiaires.impact_generique || 'Impact à définir',
            type_beneficiaire: liaison.Beneficiaires.type_beneficiaire || 'individu',
            marque_id: liaison.marque_id,
            toutes_marques: toutesMarquesFormatted
          };
        })
      );

      cache.set(cacheKey, {
        data: transformedLiaisons,
        timestamp: now
      });

      return {
        statusCode: 200,
        headers: { ...headers, 'X-Cache': 'MISS' },
        body: JSON.stringify(transformedLiaisons)
      };

    } else {
      // Get all beneficiaires with their brand relationships
      const { data: beneficiaires, error } = await supabase
        .from('Beneficiaires')
        .select(`
          *,
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
        controverses: beneficiaire.controverses,
        sources: beneficiaire.sources,
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