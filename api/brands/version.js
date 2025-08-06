import { createClient } from '@supabase/supabase-js';

// Configuration Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL et SUPABASE_ANON_KEY sont requis');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

// Cache simple en mémoire (limité mais suffisant pour serverless)
let cache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get data version endpoint
 */
export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    // Vérifier le cache
    const cacheKey = 'brands_version';
    const now = Date.now();
    
    if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_TTL) {
      console.log('Cache hit for version');
      return res.status(200).json(cache[cacheKey].data);
    }

    // Récupérer les timestamps de dernière modification
    const { data: brandStats, error: brandError } = await supabase
      .from('Marque')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1);

    const { data: eventStats, error: eventError } = await supabase
      .from('Evenement')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1);

    if (brandError) {
      console.error('Brand stats error:', brandError);
      throw brandError;
    }
    if (eventError) {
      console.error('Event stats error:', eventError);
      throw eventError;
    }

    // Compter le nombre total d'éléments
    const { count: totalBrands } = await supabase
      .from('Marque')
      .select('*', { count: 'exact', head: true });

    const { count: totalEvents } = await supabase
      .from('Evenement')
      .select('*', { count: 'exact', head: true });

    // Calculer la version basée sur les timestamps les plus récents
    const lastBrandUpdate = brandStats?.[0]?.updated_at || new Date().toISOString();
    const lastEventUpdate = eventStats?.[0]?.updated_at || new Date().toISOString();
    const mostRecent = new Date(Math.max(
      new Date(lastBrandUpdate).getTime(),
      new Date(lastEventUpdate).getTime()
    ));

    // Générer un checksum simple basé sur les counts et la date
    const checksum = `${totalBrands}-${totalEvents}-${mostRecent.getTime()}`;

    const versionData = {
      version: mostRecent.toISOString(),
      lastUpdated: mostRecent.toISOString(),
      totalBrands: totalBrands || 0,
      totalEvents: totalEvents || 0,
      checksum
    };

    // Mettre en cache
    cache[cacheKey] = {
      data: versionData,
      timestamp: now
    };

    console.log('Version data generated:', versionData);
    res.status(200).json(versionData);

  } catch (error) {
    console.error('Version endpoint error:', error);
    res.status(500).json({
      error: 'Erreur serveur lors de la récupération de la version',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}