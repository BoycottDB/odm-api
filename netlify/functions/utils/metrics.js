/**
 * Métriques essentielles pour ODM API
 */

export class MetricsLogger {
  /**
   * Log des erreurs essentielles
   */
  static logError(functionName, error) {
    console.error(`[${functionName}] Error:`, error.message);
  }

  /**
   * Log cache hit/miss basique
   */
  static logCache(functionName, hit = true) {
    console.log(`[${functionName}] Cache ${hit ? 'HIT' : 'MISS'}`);
  }
}