/**
 * Serverless Cache System
 * Cache optimisé pour l'architecture Netlify Functions (processus isolés)
 */

// Configuration TTL unifiée et optimisée
const UNIFIED_TTL = {
  // Endpoints optimisés (Solutions 1, 2, 3)
  suggestions: 5 * 60 * 1000,        // 5 minutes - auto-complétion ultra-rapide
  marques_search: 10 * 60 * 1000,    // 10 minutes - recherche déléguée
  marques_all: 20 * 60 * 1000,       // 20 minutes - liste complète avec SQL JOINs

  // Endpoints existants optimisés
  version: 5 * 60 * 1000,            // 5 minutes - frequently accessed
  health: 2 * 60 * 1000,             // 2 minutes - monitoring rapide
  updates: 10 * 60 * 1000,           // 10 minutes - moderate frequency
  full: 30 * 60 * 1000,              // 30 minutes - heavy payload
  beneficiaires_chaine: 15 * 60 * 1000,  // 15 minutes - chaîne avec marques optimisée
  evenements: 15 * 60 * 1000,        // 15 minutes - événements avec pagination
  categories: 60 * 60 * 1000,         // 1 heure - catégories quasi-statiques
  secteurs: 60 * 60 * 1000,          // 1 heure - secteurs marques stables
  marques_stats: 30 * 60 * 1000      // 30 minutes - statistiques calculées
};

class ServerlessCache {
  constructor(functionName) {
    this.functionName = functionName;
    this.cache = new Map();
    this.hitCount = 0;
    this.missCount = 0;
    this.lastCleanup = Date.now();
    this.cleanupInterval = 10 * 60 * 1000; // Nettoyage toutes les 10 minutes

    // Cache spécialisé selon la fonction
    this.maxSize = this.getMaxSizeForFunction(functionName);
  }

  /**
   * Détermine la taille max du cache selon le type de fonction
   */
  getMaxSizeForFunction(functionName) {
    const sizeConfig = {
      suggestions: 200,        // Beaucoup de queries différentes
      marques: 100,           // Searches + all
      beneficiaires_chaine: 50, // Moins de variété mais plus gros
      evenements: 30,         // Relativement stable
      categories: 10,         // Très stable
      secteurs: 10,           // Très stable
      default: 50
    };

    return sizeConfig[functionName] || sizeConfig.default;
  }

  /**
   * Génère une clé de cache standardisée pour éviter la fragmentation
   */
  generateKey(endpoint, params = {}) {
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}:${params[key]}`)
      .join('|');

    return sortedParams ? `${endpoint}::${sortedParams}` : endpoint;
  }

  /**
   * Récupère une valeur du cache avec vérification TTL
   */
  get(endpoint, params = {}) {
    const key = this.generateKey(endpoint, params);
    const cached = this.cache.get(key);

    if (!cached) {
      this.missCount++;
      return null;
    }

    const ttl = UNIFIED_TTL[endpoint] || UNIFIED_TTL.marques_all; // TTL par défaut
    const isExpired = Date.now() - cached.timestamp > ttl;

    if (isExpired) {
      this.cache.delete(key);
      this.missCount++;
      return null;
    }

    this.hitCount++;
    return cached.data;
  }

  /**
   * Stocke une valeur dans le cache avec timestamp
   */
  set(endpoint, data, params = {}) {
    const key = this.generateKey(endpoint, params);

    // Nettoyage préventif si on approche de la limite
    if (this.cache.size >= this.maxSize) {
      this.performSmartCleanup();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      endpoint,
      params,
      accessCount: 1
    });

    // Nettoyage périodique pour éviter la croissance illimitée
    this.performCleanupIfNeeded();
  }

  /**
   * Nettoyage intelligent basé sur l'usage et l'expiration
   */
  performSmartCleanup() {
    const now = Date.now();
    const entries = Array.from(this.cache.entries());

    // Trier par : expirées d'abord, puis par fréquence d'accès
    entries.sort((a, b) => {
      const [keyA, valueA] = a;
      const [keyB, valueB] = b;

      const ttlA = UNIFIED_TTL[valueA.endpoint] || UNIFIED_TTL.marques_all;
      const ttlB = UNIFIED_TTL[valueB.endpoint] || UNIFIED_TTL.marques_all;

      const expiredA = now - valueA.timestamp > ttlA;
      const expiredB = now - valueB.timestamp > ttlB;

      // Prioriser les entrées expirées
      if (expiredA && !expiredB) return -1;
      if (!expiredA && expiredB) return 1;

      // Ensuite, trier par fréquence d'accès (moins utilisées d'abord)
      return (valueA.accessCount || 1) - (valueB.accessCount || 1);
    });

    // Supprimer la moitié des entrées les moins importantes
    const toDelete = Math.floor(this.maxSize / 2);
    let deletedCount = 0;

    for (const [key, value] of entries) {
      if (deletedCount >= toDelete) break;
      this.cache.delete(key);
      deletedCount++;
    }

    console.log(`[${this.functionName}] Smart cleanup: removed ${deletedCount} entries`);
  }

  /**
   * Nettoyage automatique des entrées expirées
   */
  performCleanupIfNeeded() {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupInterval) {
      return; // Nettoyage récent, pas besoin
    }

    let deletedCount = 0;
    for (const [key, cached] of this.cache.entries()) {
      const ttl = UNIFIED_TTL[cached.endpoint] || UNIFIED_TTL.marques_all;
      const isExpired = now - cached.timestamp > ttl;

      if (isExpired) {
        this.cache.delete(key);
        deletedCount++;
      }
    }

    this.lastCleanup = now;

    if (deletedCount > 0) {
      console.log(`[${this.functionName}] Periodic cleanup: removed ${deletedCount} expired entries`);
    }
  }

  /**
   * Métriques de performance du cache pour cette fonction
   */
  getMetrics() {
    const totalRequests = this.hitCount + this.missCount;
    const hitRate = totalRequests > 0 ? (this.hitCount / totalRequests) * 100 : 0;

    return {
      functionName: this.functionName,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: Math.round(hitRate * 100) / 100,
      cacheSize: this.cache.size,
      maxSize: this.maxSize,
      lastCleanup: new Date(this.lastCleanup).toISOString(),
      utilizationRate: Math.round((this.cache.size / this.maxSize) * 100)
    };
  }

  /**
   * Warmup cache avec données fréquemment utilisées (optionnel)
   */
  async warmup(supabase, endpoint) {
    if (endpoint === 'categories') {
      try {
        console.log(`[${this.functionName}] Starting cache warmup for categories...`);

        const { data: categories } = await supabase
          .from('Categorie')
          .select('*')
          .eq('actif', true)
          .order('ordre');

        if (categories) {
          this.set('categories', categories);
        }

        console.log(`[${this.functionName}] Cache warmup completed`);
      } catch (error) {
        console.warn(`[${this.functionName}] Warmup failed:`, error.message);
      }
    }
  }
}

/**
 * Factory pour créer des instances de cache par fonction
 */
function createServerlessCache(functionName) {
  return new ServerlessCache(functionName);
}

export { createServerlessCache, UNIFIED_TTL };