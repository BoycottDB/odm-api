/**
 * Netlify Function - Noms des bénéficiaires controversés (id + nom + type), pour la recherche du site
 * Même critère que le filtre de la page /marques : au moins une controverse documentée
 */
import { createClient } from '@supabase/supabase-js';
import { toutesLesLignes } from './utils/toutesLesLignes.js';
import { initSentry, sentryHandler } from './utils/sentry.js';

initSentry();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase configuration');
}

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
}) : null;

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
    const [beneficiaires, controverses] = await Promise.all([
      toutesLesLignes(supabase, 'Beneficiaires', 'id, nom, type_beneficiaire'),
      toutesLesLignes(supabase, 'controverse_beneficiaire', 'id, beneficiaire_id'),
    ]);

    const avecControverse = new Set(controverses.map((c) => c.beneficiaire_id));
    const resultat = beneficiaires.filter((b) => avecControverse.has(b.id));
    resultat.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(resultat)
    };
  } catch (error) {
    console.error('Error fetching beneficiary names:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
});

export { handler };
