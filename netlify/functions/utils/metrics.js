/**
 * Système de métriques et logs structurés pour ODM API
 * Enrichit le système de logs existant avec métriques performance
 */

export class MetricsLogger {
  /**
   * Log une requête complétée avec métriques de performance
   */
  static logRequest(functionName, event, responseTime, success = true, cacheStatus = null) {
    const logData = {
      type: 'request_completed',
      timestamp: new Date().toISOString(),
      function: functionName,
      method: event.httpMethod,
      path: event.path,
      responseTime: `${responseTime}ms`,
      success,
      userAgent: this.categorizeUserAgent(event.headers['user-agent']),
      cacheStatus // 'HIT', 'MISS', null
    };

    console.log(JSON.stringify(logData));
  }

  /**
   * Log les accès au cache (hit/miss)
   */
  static logCacheAccess(functionName, cacheKey, hit = true) {
    const logData = {
      type: 'cache_access',
      timestamp: new Date().toISOString(),
      function: functionName,
      cacheKey: this.sanitizeCacheKey(cacheKey),
      hit,
      source: hit ? 'cache' : 'database'
    };

    console.log(JSON.stringify(logData));
  }

  /**
   * Log des métriques spécifiques aux TTL de cache
   */
  static logCacheStats(functionName, ttlUsed, itemCount = null) {
    // TTL configurés selon l'architecture existante (MONITORING.md lignes 425-432)
    const ttlMapping = {
      'health': 5 * 60 * 1000,           // 5min
      'marques': 20 * 60 * 1000,         // 20min  
      'evenements': 15 * 60 * 1000,      // 15min
      'beneficiaires-chaine': 10 * 60 * 1000, // 10min
      'categories': 60 * 60 * 1000,      // 60min
      'secteurs-marque': 60 * 60 * 1000, // 60min
      'brands-version': 5 * 60 * 1000,   // 5min (extension)
      'brands-full': 30 * 60 * 1000,     // 30min (extension)
      'brands-updates': 10 * 60 * 1000   // 10min (extension)
    };
    
    const logData = {
      type: 'cache_ttl_info',
      timestamp: new Date().toISOString(),
      function: functionName,
      ttl_configured: ttlMapping[functionName] || 'unknown',
      ttl_used: ttlUsed,
      itemCount
    };

    console.log(JSON.stringify(logData));
  }

  /**
   * Log des erreurs avec contexte
   */
  static logError(functionName, error, context = {}) {
    const logData = {
      type: 'error',
      timestamp: new Date().toISOString(),
      function: functionName,
      error: error.message,
      errorType: error.constructor.name,
      context: this.sanitizeContext(context)
    };

    console.error(JSON.stringify(logData));
  }

  /**
   * Catégorise les user agents de façon anonyme
   */
  static categorizeUserAgent(userAgent) {
    if (!userAgent) return 'unknown';
    
    const ua = userAgent.toLowerCase();
    if (ua.includes('bot') || ua.includes('crawler') || ua.includes('spider')) {
      return 'bot';
    }
    if (ua.includes('mobile') || ua.includes('iphone') || ua.includes('android')) {
      return 'mobile';
    }
    if (ua.includes('chrome') || ua.includes('firefox') || ua.includes('safari')) {
      return 'desktop';
    }
    return 'other';
  }

  /**
   * Sanitize cache key pour éviter d'exposer des données sensibles
   */
  static sanitizeCacheKey(cacheKey) {
    if (!cacheKey) return 'unknown';
    
    // Garder seulement la structure, pas le contenu
    if (cacheKey.includes('_')) {
      const parts = cacheKey.split('_');
      return `${parts[0]}_${parts.length > 1 ? '[sanitized]' : ''}`;
    }
    return cacheKey.substring(0, 20) + (cacheKey.length > 20 ? '...' : '');
  }

  /**
   * Sanitize contexte pour éviter d'exposer des données sensibles
   */
  static sanitizeContext(context) {
    const sanitized = { ...context };
    
    // Supprimer les champs potentiellement sensibles
    delete sanitized.ip;
    delete sanitized.userAgent;
    delete sanitized.cookies;
    delete sanitized.authorization;
    
    return sanitized;
  }

  /**
   * Log métriques de performance générale
   */
  static logPerformanceMetrics(functionName, metrics) {
    const logData = {
      type: 'performance_metrics',
      timestamp: new Date().toISOString(),
      function: functionName,
      metrics: {
        memoryUsage: process.memoryUsage ? {
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
        } : null,
        ...metrics
      }
    };

    console.log(JSON.stringify(logData));
  }
}