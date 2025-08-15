/**
 * Netlify Function - Brands data with search capabilities
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
const CACHE_TTL = 20 * 60 * 1000; // 20 minutes

export const handler = async (event, context) => {
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
      console.log('Cache hit for brands');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(cached.data)
      };
    }

    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    // Build query - Architecture V2 avec Marque_beneficiaire
    let query = supabase
      .from('Marque')
      .select(`
        *,
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
            controverses,
            sources,
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

    // Transform for frontend compatibility (similar to brands-full but with pagination)
    const transformedBrands = await Promise.all(
      (marques || []).map(async (marque) => {
        // Transformation V2 - Marque_beneficiaire au lieu de marque_dirigeant
        const beneficiaires_marque = [];
        
        if (marque.Marque_beneficiaire && marque.Marque_beneficiaire.length > 0) {
          for (const liaison of marque.Marque_beneficiaire) {
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
              
              beneficiaires_marque.push({
                id: liaison.id,
                lien_financier: liaison.lien_financier,
                impact_specifique: liaison.impact_specifique,
                beneficiaire: {
                  ...liaison.Beneficiaires,
                  toutes_marques: toutesMarques // ✅ Ajout des toutes_marques
                }
              });
            }
          }
        }
        
        // Compatibility: Premier bénéficiaire pour dirigeant_controverse
        let dirigeant_controverse = null;
        if (beneficiaires_marque.length > 0) {
          const premierBeneficiaire = beneficiaires_marque[0];
          dirigeant_controverse = {
            id: premierBeneficiaire.id,
            marque_id: marque.id,
            beneficiaire_id: premierBeneficiaire.beneficiaire.id,
            dirigeant_nom: premierBeneficiaire.beneficiaire.nom,
            controverses: premierBeneficiaire.beneficiaire.controverses,
            lien_financier: premierBeneficiaire.lien_financier,
            impact_description: premierBeneficiaire.impact_specifique || premierBeneficiaire.beneficiaire.impact_generique || '',
            sources: premierBeneficiaire.beneficiaire.sources,
            created_at: premierBeneficiaire.beneficiaire.created_at,
            updated_at: premierBeneficiaire.beneficiaire.updated_at,
            toutes_marques: premierBeneficiaire.beneficiaire.toutes_marques,
            type_beneficiaire: premierBeneficiaire.beneficiaire.type_beneficiaire
          };
        }
        
        return {
          ...marque,
          beneficiaires_marque, // ✅ Nouvelle structure V2
          dirigeant_controverse, // ✅ Rétrocompatibilité
          secteur_marque: marque.SecteurMarque?.[0] || null
        };
      })
    );

    // Cache the result
    cache.set(cacheKey, {
      data: transformedBrands,
      timestamp: now
    });

    console.log(`Brands loaded: ${transformedBrands.length} brands (search: ${search || 'none'})`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(transformedBrands)
    };

  } catch (error) {
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