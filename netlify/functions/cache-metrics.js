/**
 * Cache Metrics Endpoint
 * Endpoint pour surveiller les performances du cache unifié
 */
import { createServerlessCache } from './utils/serverlessCache.js';

// Cache pour cette fonction de métriques
const cache = createServerlessCache('cache-metrics');

const cacheMetricsHandler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const metrics = cache.getMetrics();

    // Note: En architecture serverless, chaque fonction a son propre cache
    const serverlessNote = {
      architecture: 'serverless',
      note: 'Each function maintains its own cache instance',
      function_name: 'cache-metrics'
    };

    // Analyse des performances
    const analysis = {
      performance: metrics.hitRate >= 70 ? 'excellent' :
                  metrics.hitRate >= 50 ? 'good' :
                  metrics.hitRate >= 30 ? 'fair' : 'poor',

      cacheHealth: metrics.cacheSize < 1000 ? 'optimal' :
                   metrics.cacheSize < 2000 ? 'moderate' : 'high',

      recommendations: []
    };

    // Recommandations basées sur les métriques
    if (metrics.hitRate < 50) {
      analysis.recommendations.push('Consider increasing TTL for stable endpoints');
    }

    if (metrics.cacheSize > 1500) {
      analysis.recommendations.push('Cache size is high, cleanup cycles are working');
    }

    const totalRequests = metrics.hitCount + metrics.missCount;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        serverless_info: serverlessNote,
        cache_metrics: metrics,
        performance_analysis: analysis,
        cache_efficiency: {
          total_requests: totalRequests,
          memory_usage: `${metrics.cacheSize}/${metrics.maxSize} entries`,
          hit_ratio: `${metrics.hitRate}%`,
          miss_ratio: `${(100 - metrics.hitRate).toFixed(2)}%`,
          utilization: `${metrics.utilizationRate}%`
        }
      })
    };

  } catch (error) {
    console.error('Error retrieving cache metrics:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to retrieve cache metrics',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};

export const handler = cacheMetricsHandler;