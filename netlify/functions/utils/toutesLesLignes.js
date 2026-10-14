const TAILLE_PAGE = 1000; // limite de lignes par requête Supabase

/**
 * Toutes les lignes d'une table, page par page ; une erreur arrête tout,
 * pour ne jamais servir ni mettre en cache des données incomplètes
 */
export async function toutesLesLignes(supabase, table, colonnes) {
  const lignes = [];
  for (let debut = 0; ; debut += TAILLE_PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(colonnes)
      .order('id')
      .range(debut, debut + TAILLE_PAGE - 1);
    if (error) throw error;
    lignes.push(...data);
    if (data.length < TAILLE_PAGE) return lignes;
  }
}
