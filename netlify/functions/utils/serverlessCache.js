/**
 * Serverless Cache System
 * Cache optimisé pour l'architecture Netlify Functions (processus isolés)
 */

// Durée de vie d'une entrée du cache en mémoire
const CACHE_TTL = 20 * 60 * 1000; // 20 minutes
const MAX_SIZE = 50;

class ServerlessCache {
  constructor(functionName) {
    this.functionName = functionName;
    this.cache = new Map();
    this.lastCleanup = Date.now();
    this.cleanupInterval = 10 * 60 * 1000; // Nettoyage toutes les 10 minutes

    this.maxSize = MAX_SIZE;
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
      return null;
    }

    const isExpired = Date.now() - cached.timestamp > CACHE_TTL;

    if (isExpired) {
      this.cache.delete(key);
      return null;
    }

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
      params
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

    // Trier : expirées d'abord
    entries.sort((a, b) => {
      const [keyA, valueA] = a;
      const [keyB, valueB] = b;

      const expiredA = now - valueA.timestamp > CACHE_TTL;
      const expiredB = now - valueB.timestamp > CACHE_TTL;

      if (expiredA && !expiredB) return -1;
      if (!expiredA && expiredB) return 1;
      return 0;
    });

    // Supprimer la moitié des entrées, en commençant par les expirées
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
      const isExpired = now - cached.timestamp > CACHE_TTL;

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
}

/**
 * Factory pour créer des instances de cache par fonction
 */
function createServerlessCache(functionName) {
  return new ServerlessCache(functionName);
}

export { createServerlessCache };