import { supabase, TABLES, formatSupabaseError } from '../config/supabase.js';

/**
 * Service pour gérer les opérations sur les marques et événements
 */
export class BrandService {
  
  /**
   * Récupère toutes les marques avec leurs événements et catégories
   */
  async getAllBrands() {
    try {
      const { data: marques, error } = await supabase
        .from(TABLES.MARQUES)
        .select(`
          id,
          nom,
          imagePath,
          category,
          shortDescription,
          description,
          nbControverses,
          nbCondamnations,
          nbDirigeantsControverses,
          evenements:Evenement(
            id,
            titre,
            date,
            source_url,
            condamnation_judiciaire,
            categorie:Categorie(
              id,
              nom,
              emoji,
              couleur
            )
          )
        `)
        .order('nom');

      if (error) {
        throw error;
      }

      // Transformation des données pour correspondre au format de l'extension
      const transformedBrands = marques.map(marque => ({
        id: marque.id,
        name: marque.nom,
        nbControverses: marque.nbControverses || 0,
        nbCondamnations: marque.nbCondamnations || 0,
        nbDirigeantsControverses: marque.nbDirigeantsControverses || 0,
        
        // Extraction des catégories uniques depuis les événements
        categories: this.extractUniqueCategories(marque.evenements),
        
        // Événements avec catégorie intégrée
        evenements: marque.evenements.map(evt => ({
          id: evt.id,
          titre: evt.titre,
          date: evt.date,
          source_url: evt.source_url,
          condamnation_judiciaire: evt.condamnation_judiciaire,
          categorie: evt.categorie
        })),
        
        // Champs de compatibilité avec l'ancien format
        category: marque.category,
        shortDescription: marque.shortDescription,
        description: marque.description,
        imagePath: marque.imagePath
      }));

      return transformedBrands;
    } catch (error) {
      console.error('Erreur lors de la récupération des marques:', error);
      throw formatSupabaseError(error);
    }
  }

  /**
   * Récupère les marques mises à jour depuis une date donnée
   */
  async getBrandsUpdatedSince(since) {
    try {
      // Récupérer les marques mises à jour
      const { data: updatedBrands, error: brandsError } = await supabase
        .from(TABLES.MARQUES)
        .select(`
          id,
          nom,
          imagePath,
          category,
          shortDescription,
          description,
          nbControverses,
          nbCondamnations,
          nbDirigeantsControverses,
          updated_at,
          evenements:Evenement(
            id,
            titre,
            date,
            source_url,
            condamnation_judiciaire,
            updated_at,
            categorie:Categorie(
              id,
              nom,
              emoji,
              couleur
            )
          )
        `)
        .gte('updated_at', since)
        .order('updated_at', { ascending: false });

      if (brandsError) {
        throw brandsError;
      }

      // Récupérer les événements mis à jour (même si la marque n'a pas changé)
      const { data: updatedEvents, error: eventsError } = await supabase
        .from(TABLES.EVENEMENTS)
        .select(`
          id,
          titre,
          date,
          source_url,
          condamnation_judiciaire,
          marqueId,
          updated_at,
          categorie:Categorie(
            id,
            nom,
            emoji,
            couleur
          )
        `)
        .gte('updated_at', since)
        .order('updated_at', { ascending: false });

      if (eventsError) {
        throw eventsError;
      }

      return {
        updatedBrands: updatedBrands.map(marque => ({
          id: marque.id,
          name: marque.nom,
          categories: this.extractUniqueCategories(marque.evenements),
          evenements: marque.evenements,
          category: marque.category,
          shortDescription: marque.shortDescription,
          description: marque.description,
          imagePath: marque.imagePath,
          lastUpdated: marque.updated_at
        })),
        updatedEvents: updatedEvents
      };

    } catch (error) {
      console.error('Erreur lors de la récupération des mises à jour:', error);
      throw formatSupabaseError(error);
    }
  }

  /**
   * Calcule la version/checksum des données actuelles
   */
  async getDataVersion() {
    try {
      // Récupérer les timestamps de dernière modification
      const { data: brandStats, error: brandError } = await supabase
        .from(TABLES.MARQUES)
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1);

      const { data: eventStats, error: eventError } = await supabase
        .from(TABLES.EVENEMENTS)
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1);

      if (brandError || eventError) {
        throw brandError || eventError;
      }

      // Compter le nombre total d'éléments
      const { count: totalBrands } = await supabase
        .from(TABLES.MARQUES)
        .select('*', { count: 'exact', head: true });

      const { count: totalEvents } = await supabase
        .from(TABLES.EVENEMENTS)
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

      return {
        version: mostRecent.toISOString(),
        lastUpdated: mostRecent.toISOString(),
        totalBrands: totalBrands || 0,
        totalEvents: totalEvents || 0,
        checksum
      };

    } catch (error) {
      console.error('Erreur lors du calcul de la version:', error);
      throw formatSupabaseError(error);
    }
  }

  /**
   * Extrait les catégories uniques depuis une liste d'événements
   */
  extractUniqueCategories(evenements) {
    if (!evenements || !Array.isArray(evenements)) {
      return [];
    }

    const categoriesMap = new Map();
    
    evenements.forEach(evt => {
      if (evt.categorie && evt.categorie.id) {
        categoriesMap.set(evt.categorie.id, {
          id: evt.categorie.id,
          nom: evt.categorie.nom,
          emoji: evt.categorie.emoji,
          couleur: evt.categorie.couleur
        });
      }
    });

    return Array.from(categoriesMap.values());
  }

  /**
   * Recherche de marques par nom (pour les suggestions)
   */
  async searchBrands(query, limit = 10) {
    try {
      const { data, error } = await supabase
        .from(TABLES.MARQUES)
        .select('id, nom, category, shortDescription')
        .ilike('nom', `%${query}%`)
        .limit(limit)
        .order('nom');

      if (error) {
        throw error;
      }

      return data.map(marque => ({
        id: marque.id,
        name: marque.nom,
        category: marque.category,
        shortDescription: marque.shortDescription
      }));

    } catch (error) {
      console.error('Erreur lors de la recherche:', error);
      throw formatSupabaseError(error);
    }
  }
}