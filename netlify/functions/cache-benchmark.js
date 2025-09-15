/**
 * Cache Benchmark - Test Performance
 * Endpoint pour tester et comparer les performances du cache
 */
import { createServerlessCache } from './utils/serverlessCache.js';

const cache = createServerlessCache('cache-benchmark');

const cacheBenchmarkHandler = async (event) => {
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
    const { action = 'test', iterations = '10' } = event.queryStringParameters || {};
    const iterationCount = parseInt(iterations);

    if (action === 'test') {
      // Test des performances cache HIT vs MISS
      const testResults = [];

      // Phase 1: Test MISS (données pas en cache)
      const missTests = [];
      for (let i = 0; i < iterationCount; i++) {
        const startTime = Date.now();

        // Simuler une requête coûteuse
        const mockData = {
          id: i,
          name: `Test Item ${i}`,
          data: new Array(100).fill(0).map((_, idx) => `data-${i}-${idx}`),
          timestamp: new Date().toISOString()
        };

        // Mesurer le temps de "traitement"
        await new Promise(resolve => setTimeout(resolve, 10)); // Simuler 10ms de traitement

        const duration = Date.now() - startTime;
        missTests.push(duration);

        // Mettre en cache pour les tests suivants
        cache.set('benchmark', mockData, { id: i });
      }

      // Phase 2: Test HIT (données en cache)
      const hitTests = [];
      for (let i = 0; i < iterationCount; i++) {
        const startTime = Date.now();

        // Récupérer du cache
        const cached = cache.get('benchmark', { id: i });

        const duration = Date.now() - startTime;
        hitTests.push(duration);
      }

      const avgMiss = missTests.reduce((a, b) => a + b, 0) / missTests.length;
      const avgHit = hitTests.reduce((a, b) => a + b, 0) / hitTests.length;
      const improvement = Math.round((avgMiss / avgHit) * 100) / 100;

      const metrics = cache.getMetrics();

      return {
        statusCode: 200,
        headers: {
          ...headers,
          'X-Benchmark': 'cache-performance-test'
        },
        body: JSON.stringify({
          test_config: {
            iterations: iterationCount,
            simulation: 'database-like operations'
          },
          performance_results: {
            cache_miss_avg_ms: Math.round(avgMiss * 100) / 100,
            cache_hit_avg_ms: Math.round(avgHit * 100) / 100,
            improvement_factor: `${improvement}x faster`,
            cache_efficiency: `${Math.round((1 - avgHit/avgMiss) * 100)}% faster`
          },
          cache_metrics: metrics,
          benchmark_summary: {
            cache_working: avgHit < avgMiss,
            performance_gain: improvement > 1 ? 'excellent' : 'needs investigation',
            recommendation: improvement > 10 ? 'Cache is highly effective' :
                           improvement > 5 ? 'Cache is effective' :
                           improvement > 2 ? 'Cache is moderately effective' :
                           'Cache needs optimization'
          }
        })
      };

    } else if (action === 'stress') {
      // Test de stress pour vérifier la gestion de la mémoire
      const startTime = Date.now();
      const stressResults = [];

      for (let i = 0; i < iterationCount * 10; i++) {
        const key = `stress-${i % 50}`; // Réutiliser quelques clés pour tester l'éviction

        const data = {
          id: i,
          data: new Array(50).fill(0).map((_, idx) => `stress-data-${i}-${idx}`)
        };

        cache.set('stress', data, { key });

        if (i % 100 === 0) {
          const currentMetrics = cache.getMetrics();
          stressResults.push({
            iteration: i,
            cache_size: currentMetrics.cacheSize,
            utilization: currentMetrics.utilizationRate,
            hit_rate: currentMetrics.hitRate
          });
        }
      }

      const duration = Date.now() - startTime;
      const finalMetrics = cache.getMetrics();

      return {
        statusCode: 200,
        headers: {
          ...headers,
          'X-Benchmark': 'cache-stress-test'
        },
        body: JSON.stringify({
          stress_test: {
            total_operations: iterationCount * 10,
            duration_ms: duration,
            operations_per_second: Math.round((iterationCount * 10) / (duration / 1000))
          },
          memory_management: {
            max_size_respected: finalMetrics.cacheSize <= finalMetrics.maxSize,
            final_utilization: `${finalMetrics.utilizationRate}%`,
            cache_working: finalMetrics.cacheSize > 0
          },
          performance_checkpoints: stressResults,
          final_metrics: finalMetrics
        })
      };

    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Invalid action',
          available_actions: ['test', 'stress'],
          usage: {
            test: '/cache-benchmark?action=test&iterations=10',
            stress: '/cache-benchmark?action=stress&iterations=50'
          }
        })
      };
    }

  } catch (error) {
    console.error('Benchmark error:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Benchmark failed',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};

export const handler = cacheBenchmarkHandler;