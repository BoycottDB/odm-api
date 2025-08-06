import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';
import NodeCache from 'node-cache';
import { BrandService } from './services/brandService.js';
import { testConnection } from './config/supabase.js';

// Configuration
config();

const app = express();
const port = process.env.PORT || 3001;

// Cache global pour les données
const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL_SECONDS) || 3600, // 1 heure par défaut
  maxKeys: parseInt(process.env.CACHE_MAX_KEYS) || 1000
});

// Initialisation du service
const brandService = new BrandService();

// Middleware de sécurité
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Compression pour optimiser les réponses
app.use(compression());

// Configuration CORS pour les extensions
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'chrome-extension://',
  'moz-extension://',
  'https://localhost:3000'
];

app.use(cors({
  origin: (origin, callback) => {
    // Autoriser les requêtes sans origine (extensions)
    if (!origin) return callback(null, true);
    
    // Vérifier si l'origine correspond à un pattern autorisé
    const isAllowed = allowedOrigins.some(pattern => 
      origin.startsWith(pattern.replace('*', ''))
    );
    
    callback(null, isAllowed);
  },
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limite à 100 requêtes par IP
  message: {
    error: 'Trop de requêtes depuis cette IP, réessayez plus tard.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(limiter);

// Middleware pour parser le JSON
app.use(express.json({ limit: '1mb' }));

// Middleware de logging simple
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Route de santé
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0'
  });
});

// Route pour obtenir la version actuelle des données
app.get('/api/brands/version', async (req, res) => {
  try {
    const cached = cache.get('brands_version');
    if (cached) {
      return res.json(cached);
    }

    const version = await brandService.getDataVersion();
    cache.set('brands_version', version, 300); // Cache 5 minutes
    res.json(version);
  } catch (error) {
    console.error('Erreur version:', error);
    res.status(500).json({
      error: 'Erreur serveur lors de la récupération de la version',
      details: process.env.NODE_ENV === 'development' ? error : undefined
    });
  }
});

// Route pour les mises à jour incrémentales
app.get('/api/brands/updates', async (req, res) => {
  try {
    const { since } = req.query;
    
    if (!since) {
      return res.status(400).json({
        error: 'Paramètre "since" requis (timestamp ISO)'
      });
    }

    // Validation du format de date
    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) {
      return res.status(400).json({
        error: 'Format de date invalide pour "since"'
      });
    }

    const cacheKey = `updates_since_${since}`;
    const cached = cache.get(cacheKey);
    
    if (cached) {
      return res.json(cached);
    }

    const { updatedBrands, updatedEvents } = await brandService.getBrandsUpdatedSince(since);
    
    const updates = {
      hasUpdates: updatedBrands.length > 0 || updatedEvents.length > 0,
      updatedBrands,
      updatedEvents,
      timestamp: new Date().toISOString()
    };

    cache.set(cacheKey, updates, 600); // Cache 10 minutes
    res.json(updates);
  } catch (error) {
    console.error('Erreur mises à jour:', error);
    res.status(500).json({
      error: 'Erreur serveur lors de la récupération des mises à jour',
      details: process.env.NODE_ENV === 'development' ? error : undefined
    });
  }
});

// Route pour obtenir toutes les données (fallback)
app.get('/api/brands/full', async (req, res) => {
  try {
    const cached = cache.get('brands_full');
    if (cached) {
      return res.json(cached);
    }

    const brands = await brandService.getAllBrands();
    const version = await brandService.getDataVersion();
    
    const fullData = {
      brands,
      version: version.version,
      lastUpdated: version.lastUpdated,
      totalBrands: version.totalBrands,
      checksum: version.checksum
    };

    cache.set('brands_full', fullData, 1800); // Cache 30 minutes
    res.json(fullData);
  } catch (error) {
    console.error('Erreur données complètes:', error);
    res.status(500).json({
      error: 'Erreur serveur lors de la récupération des données',
      details: process.env.NODE_ENV === 'development' ? error : undefined
    });
  }
});

// Route pour les statistiques (optionnel)
app.get('/api/stats', (req, res) => {
  const stats = cache.getStats();
  res.json({
    cache: {
      keys: stats.keys,
      hits: stats.hits,
      misses: stats.misses,
      hitRate: stats.hits / (stats.hits + stats.misses) * 100
    },
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      pid: process.pid
    }
  });
});

// Gestion des erreurs 404
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route non trouvée',
    path: req.originalUrl
  });
});

// Gestion des erreurs globales
app.use((err, req, res, next) => {
  console.error('Erreur serveur:', err);
  res.status(500).json({
    error: 'Erreur interne du serveur',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Gestion propre de l'arrêt
process.on('SIGTERM', () => {
  console.log('Signal SIGTERM reçu, arrêt du serveur...');
  cache.flushAll();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Signal SIGINT reçu, arrêt du serveur...');
  cache.flushAll();
  process.exit(0);
});

// Démarrage du serveur
app.listen(port, async () => {
  console.log(`🚀 API Extension démarrée sur le port ${port}`);
  console.log(`📊 Environnement: ${process.env.NODE_ENV || 'development'}`);
  console.log(`💾 Cache TTL: ${cache.options.stdTTL}s`);
  console.log(`🌐 CORS autorisé pour: ${allowedOrigins.join(', ')}`);
  
  // Test de la connexion Supabase au démarrage
  await testConnection();
});

export default app;