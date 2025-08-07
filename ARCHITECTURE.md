# Architecture de l'Extension API

## 📁 Structure du Projet

```
extension-api/
├── netlify/                 # Netlify Functions (Serverless)
│   └── functions/          
│       ├── health.js        # Health check et monitoring
│       ├── brands-version.js # Métadonnées de version
│       ├── brands-updates.js # Synchronisation incrémentale
│       └── brands-full.js   # Récupération complète (fallback)
├── public/
│   └── index.html          # Interface de documentation et tests
├── netlify.toml            # Configuration déploiement et routage
├── package.json            # Dépendances et configuration ESM
└── README.md               # Documentation utilisateur
```

## 🏗️ Architecture Générale

### Paradigme Serverless
Cette API utilise **Netlify Functions** pour une architecture entièrement serverless :
- **Auto-scaling** : Gestion automatique de la charge
- **Coût optimisé** : Paiement à l'usage uniquement
- **Distribution globale** : Edge computing via CDN Netlify
- **Déploiement simple** : Git-based deployment

### Pipeline de Données
```
Supabase (Source) → Netlify Functions (Transform) → Extensions (Consumer)
     ↓                        ↓                          ↓
PostgreSQL              Cache + CORS               Chrome/Firefox
  Relations             JSON Transform              Local Storage
```

## 🚀 Fonctions Netlify - Architecture Détaillée

### health.js - Monitoring & Diagnostics
```javascript
export const handler = async (event, context) => {
  // Pattern: Stateless health check
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      status: 'OK',
      timestamp: new Date().toISOString(),
      service: 'Extension API - Netlify',
      version: '1.0.0',
      environment: process.env.NODE_ENV
    })
  }
}
```
**Patterns utilisés :**
- Simple stateless function
- Structured logging
- Standard HTTP status codes

### brands-version.js - Version Management
```javascript
// Architecture: Cache Map + Graceful Fallback
const cache = new Map()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export const handler = async (event, context) => {
  const cacheKey = 'version-data'
  
  // Cache hit
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey)
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return successResponse(cached.data)
    }
  }
  
  // Cache miss - Fetch from Supabase
  const versionData = await calculateVersion()
  cache.set(cacheKey, { data: versionData, timestamp: Date.now() })
  
  return successResponse(versionData)
}
```
**Patterns utilisés :**
- In-memory caching avec TTL
- Graceful degradation (updated_at → created_at → current timestamp)
- Composite checksum pour comparaison rapide
- Error masking en production

### brands-updates.js - Incremental Sync
```javascript
// Architecture: Delta Sync avec Schema Tolerance
export const handler = async (event, context) => {
  const since = event.queryStringParameters?.since
  
  // Validation stricte ISO date
  if (!since || !isValidISODate(since)) {
    return errorResponse(400, 'Invalid date format')
  }
  
  // Pattern: Try-catch avec fallback gracieux
  try {
    // Requête optimisée avec updated_at
    const brands = await supabase
      .from('Marque')
      .select('*')
      .gte('updated_at', since)
  } catch (error) {
    // Fallback: récupération complète si colonne manquante
    const brands = await supabase
      .from('Marque')
      .select('*')
      .order('nom')
  }
}
```
**Patterns utilisés :**
- Schema-agnostic queries (gère l'évolution DB)
- Delta synchronization
- Fallback strategy pour compatibilité
- Cache par paramètre `since`

### brands-full.js - Complete Data Fallback
```javascript
// Architecture: Separated Queries + In-Memory Join
export const handler = async (event, context) => {
  // Pattern: Éviter les JOINs Supabase coûteux
  const [brands, events] = await Promise.all([
    supabase.from('Marque').select('*'),
    supabase.from('Evenement').select('*')
  ])
  
  // Transformation en mémoire
  const transformedBrands = transformBrandsForExtension(brands, events)
  
  return successResponse({
    brands: transformedBrands,
    version: latestVersion,
    totalBrands: brands.length,
    checksum: generateChecksum(brands, events, latestVersion)
  })
}
```
**Patterns utilisés :**
- Separated queries (évite JOINs complexes)
- In-memory data joining avec Map
- Data transformation pipeline
- Long TTL cache (30 minutes)

## 🎯 Patterns Architecturaux Principaux

### 1. Resilient Serverless Pattern
```javascript
// Fallback cascade pour robustesse
const getTimestamp = (item) => {
  return item.updated_at || item.created_at || new Date().toISOString()
}

// Cache avec graceful degradation
const getCachedData = (key, fallbackFn) => {
  const cached = cache.get(key)
  if (cached && !isExpired(cached)) return cached.data
  
  try {
    const fresh = await fallbackFn()
    cache.set(key, { data: fresh, timestamp: Date.now() })
    return fresh
  } catch (error) {
    // Return stale data if available
    return cached?.data || null
  }
}
```

### 2. API Gateway Pattern
```toml
# netlify.toml - Routing transparent
[[redirects]]
  from = "/api/brands/version"
  to = "/.netlify/functions/brands-version"
  status = 200
  force = true
  
[build.environment]
  FUNCTIONS_SRC = "netlify/functions"
  
[[headers]]
  for = "/api/*"
  [headers.values]
    Cache-Control = "public, s-maxage=300, stale-while-revalidate=3600"
    Access-Control-Allow-Origin = "*"
```

### 3. Data Transformation Pipeline
```javascript
// Extension-specific data format
const transformBrandsForExtension = (brands, events) => {
  const eventsByBrand = groupBy(events, 'marqueId')
  
  return brands.map(brand => ({
    id: brand.id,
    name: brand.nom,
    nbControverses: eventsByBrand[brand.id]?.length || 0,
    nbCondamnations: eventsByBrand[brand.id]?.filter(e => e.condamnationJudiciaire).length || 0,
    categories: extractCategories(eventsByBrand[brand.id] || []),
    evenements: eventsByBrand[brand.id] || [],
    // Extension-specific fields
    category: 'consumer_goods', // Default category
    shortDescription: generateShortDesc(eventsByBrand[brand.id]),
    imagePath: null // Extensions handle logos separately
  }))
}
```

## 🔄 Cache Strategy - Multi-Layer

### Niveau 1 : In-Memory Function Cache
```javascript
const cache = new Map()
const TTL = {
  VERSION: 5 * 60 * 1000,    // 5 minutes - frequently accessed
  UPDATES: 10 * 60 * 1000,   // 10 minutes - moderate frequency  
  FULL: 30 * 60 * 1000       // 30 minutes - heavy payload
}
```

### Niveau 2 : CDN Edge Cache
```
Cache-Control: public, s-maxage=300, stale-while-revalidate=3600
```
- 5 minutes cache fresh
- 1 hour stale acceptable
- Background revalidation

### Niveau 3 : Extension Local Cache
- Extensions cachent localement
- Vérification périodique via `/version`
- Sync incrémentale via `/updates`

## 🛡️ Sécurité et Performance

### Sécurité
```javascript
// CORS headers pour extensions
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Acceptable pour API publique
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
}

// Error masking en production
const handleError = (error, context) => {
  console.error(`Function ${context.functionName}:`, error)
  
  if (process.env.NODE_ENV === 'production') {
    return errorResponse(500, 'Internal server error')
  } else {
    return errorResponse(500, error.message)
  }
}
```

### Performance
- **Cold start optimization** : ESM modules, minimal imports
- **Memory efficiency** : Streaming JSON, garbage collection awareness
- **Network optimization** : Compression automatique Netlify
- **Edge distribution** : Déploiement global automatique

## 🔧 Configuration et Déploiement

### Variables d'Environnement
```javascript
// Configuration centralisée
const config = {
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY
  },
  cache: {
    ttl: {
      version: parseInt(process.env.CACHE_VERSION_TTL) || 300,
      updates: parseInt(process.env.CACHE_UPDATES_TTL) || 600,
      full: parseInt(process.env.CACHE_FULL_TTL) || 1800
    }
  },
  cors: {
    origins: process.env.ALLOWED_ORIGINS?.split(',') || ['*']
  }
}
```

### Build et Déploiement
```toml
[build]
  functions = "netlify/functions"
  command = "echo 'No build needed for pure functions'"
  
[build.environment]
  NODE_VERSION = "22"
  NPM_FLAGS = "--production=false"
```

## 📊 Monitoring et Observabilité

### Logging Structure
```javascript
const log = {
  info: (message, meta = {}) => {
    console.log(JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      message,
      ...meta
    }))
  },
  error: (message, error, meta = {}) => {
    console.error(JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      message,
      error: error.message,
      stack: error.stack,
      ...meta
    }))
  }
}
```

### Métriques Automatiques
- **Function execution time** : Via Netlify dashboard
- **Error rates** : Automatic monitoring
- **Cache hit rates** : Custom metrics in logs
- **Memory usage** : Runtime metrics

## 🚀 Évolutivité et Roadmap

### Optimisations Futures
1. **Redis Cache** : Cache externe pour sessions partagées
2. **GraphQL Endpoint** : Requêtes flexibles pour extensions avancées
3. **Webhook System** : Push notifications pour mises à jour temps réel
4. **Rate Limiting** : Protection avancée par extension ID
5. **Analytics** : Tracking usage et performance par endpoint

### Migration Path
- **Phase 1** : Functions actuelles (✅ Actuel)
- **Phase 2** : Redis cache + analytics
- **Phase 3** : GraphQL + webhooks
- **Phase 4** : Microservices si nécessaire

Cette architecture privilégie la **simplicité opérationnelle**, la **performance** et la **fiabilité** tout en restant **évolutive** pour les besoins futurs du projet.