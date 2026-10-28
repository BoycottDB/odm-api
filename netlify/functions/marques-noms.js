/**
 * Netlify Function - Noms de toutes les marques (id, nom, produits et variantes du nom), pour la recherche du site
 * Liste courte, chargée une fois par le navigateur puis filtrée sur place
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
    const [marques, autresNoms] = await Promise.all([
      toutesLesLignes(supabase, 'Marque', 'id, nom'),
      toutesLesLignes(supabase, 'marque_autre_nom', 'marque_id, nom, type'),
    ]);
    marques.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));

    // Gammes vendues sous la marque (ex. Knacki pour Herta) et variantes de son nom (ex. Total pour TotalEnergies) :
    // la recherche les mène à la page de la marque
    const nomsDe = (marque, type) => autresNoms
      .filter((autre) => autre.marque_id === marque.id && autre.type === type)
      .map((autre) => autre.nom);
    const resultat = marques.map((marque) => ({
      ...marque,
      autres_noms: nomsDe(marque, 'produit'),
      variantes: nomsDe(marque, 'variante'),
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(resultat)
    };
  } catch (error) {
    console.error('Error fetching brand names:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
});

export { handler };
