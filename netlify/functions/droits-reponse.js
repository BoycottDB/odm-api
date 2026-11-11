/**
 * Netlify Function - Réponses publiées au titre du droit de réponse (table droit_reponse), les plus récentes d'abord
 * Lues par la page /droit-de-reponse ; publier une réponse ne demande qu'une requête SQL
 */
import { createClient } from '@supabase/supabase-js';
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
    const { data, error } = await supabase
      .from('droit_reponse')
      .select('id, demandeur, fiche_titre, fiche_lien, date_reception, date_publication, texte')
      .order('date_publication', { ascending: false })
      .order('id', { ascending: false });

    if (error) throw error;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(data || [])
    };
  } catch (error) {
    console.error('Error fetching published replies:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
});

export { handler };
