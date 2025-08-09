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
// Architecture: Delta Sync avec Schema Tolerance + Relations V2
export const handler = async (event, context) => {
  const since = event.queryStringParameters?.since
  
  // Validation stricte ISO date
  if (!since || !isValidISODate(since)) {
    return errorResponse(400, 'Invalid date format')
  }
  
  // Pattern: Try-catch avec fallback gracieux
  try {
    // Requête optimisée avec updated_at + dirigeants normalisés
    const brands = await supabase
      .from('Marque')
      .select(`
        *,
        marque_dirigeant!marque_id (
          id,
          dirigeant_id,
          lien_financier,
          impact_specifique,
          dirigeant:dirigeant_id (
            id, nom, controverses, sources, impact_generique
          )
        )
      `)
      .gte('updated_at', since)
  } catch (error) {
    // Fallback: récupération complète si colonne manquante
    const brands = await supabase
      .from('Marque')
      .select(`
        *,
        marque_dirigeant!marque_id (
          id, dirigeant_id, lien_financier, impact_specifique,
          dirigeant:dirigeant_id (id, nom, controverses, sources, impact_generique)
        )
      `)
      .order('nom')
  }
  
  // Transformation pour compatibilité extension
  const transformedBrands = brands.map(transformBrandWithLeaders)
}
```
**Patterns utilisés :**
- Schema-agnostic queries (gère l'évolution DB)
- Delta synchronization
- Fallback strategy pour compatibilité
- Cache par paramètre `since`
- **Relations normalisées** dirigeants (V2)
- **Transformation de données** pour rétrocompatibilité extension

### brands-full.js - Complete Data Fallback
```javascript
// Architecture: Relations Complexes + Data Transformation V2
export const handler = async (event, context) => {
  // Pattern: Relations normalisées avec dirigeants
  const { data: brands, error } = await supabase
    .from('Marque')
    .select(`
      *,
      marque_dirigeant!marque_id (
        id, dirigeant_id, lien_financier, impact_specifique,
        dirigeant:dirigeant_id (
          id, nom, controverses, sources, impact_generique
        )
      )
    `)
    .order('nom')
  
  // Événements avec catégories
  const { data: events } = await supabase
    .from('Evenement')
    .select(`
      *,
      Categorie!Evenement_categorie_id_fkey (
        id, nom, emoji, couleur, ordre
      )
    `)
  
  // Transformation complexe dirigeants + événements
  const transformedBrands = transformBrandsWithLeadersForExtension(brands, events)
  
  return successResponse({
    brands: transformedBrands,
    version: latestVersion,
    totalBrands: brands.length,
    checksum: generateChecksum(brands, events, latestVersion)
  })
}
```
**Patterns utilisés :**
- **Relations normalisées** (marque_dirigeant ← dirigeant)
- **Data transformation complexe** dirigeants + événements
- **Rétrocompatibilité** format extension Chrome/Firefox
- **Cache longue durée** (30 minutes)
- **Gestion d'erreurs** gracieuse par section

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

### 3. Data Transformation Pipeline V2 - Relations Normalisées
```javascript
// Extension-specific data format avec dirigeants normalisés
const transformBrandsWithLeadersForExtension = (brands, events) => {
  const eventsByBrand = groupBy(events, 'marque_id')
  
  return brands.map(brand => {
    // Gestion dirigeants normalisés (V2)
    let dirigeants = brand.marque_dirigeant || []
    if (!Array.isArray(dirigeants)) {
      dirigeants = dirigeants ? [dirigeants] : []
    }
    
    // Transformation dirigeants avec toutes les marques liées (enrichissement 2025)
    const transformedDirigeants = await Promise.all(dirigeants.map(async (liaison) => {
      // Récupérer toutes les marques pour ce dirigeant
      const { data: toutesMarquesDuDirigeant } = await supabase
        .from('marque_dirigeant')
        .select('marque:Marque!marque_id (id, nom)')
        .eq('dirigeant_id', liaison.dirigeant_id);
      
      const toutesMarques = toutesMarquesDuDirigeant?.map(m => ({
        id: m.marque.id, 
        nom: m.marque.nom 
      })) || [];

      return {
        id: liaison.id,
        dirigeant_id: liaison.dirigeant_id,
        dirigeant_nom: liaison.dirigeant?.nom || '',
        controverses: liaison.dirigeant?.controverses || '',
        sources: liaison.dirigeant?.sources || [],
        lien_financier: liaison.lien_financier,
        impact_description: liaison.impact_specifique || liaison.dirigeant?.impact_generique || '',
        toutes_marques: toutesMarques // 🆕 Enrichissement pour navigation web
      };
    }));
    
    return {
      id: brand.id,
      name: brand.nom,
      nbControverses: eventsByBrand[brand.id]?.length || 0,
      nbCondamnations: eventsByBrand[brand.id]?.filter(e => e.condamnation_judiciaire).length || 0,
      nbDirigeantsControverses: transformedDirigeants.length,
      categories: extractCategories(eventsByBrand[brand.id] || []),
      evenements: transformEventsWithCategories(eventsByBrand[brand.id] || []),
      // Extension-specific fields
      category: brand.category || 'consumer_goods',
      shortDescription: brand.shortDescription,
      description: brand.description,
      imagePath: brand.imagePath,
      // Dirigeants controversés pour extension avec marques liées
      dirigeants_controverses: transformedDirigeants
    }
  })
}
```

## 📊 Structures de Données V2 - Dirigeants Normalisés

### Base de Données - Relations
```sql
-- Table dirigeants centralisée (V2)
dirigeants (
  id SERIAL PRIMARY KEY,
  nom VARCHAR NOT NULL,
  controverses TEXT NOT NULL,
  sources JSON NOT NULL,
  impact_generique TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Table de liaison marque-dirigeant (V2)  
marque_dirigeant (
  id SERIAL PRIMARY KEY,
  marque_id INT REFERENCES Marque(id),
  dirigeant_id INT REFERENCES dirigeants(id),
  lien_financier VARCHAR(500) NOT NULL,
  impact_specifique TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

### API Response Format - Extension Compatible
```javascript
// Format retourné par l'API (compatibilité extension)
{
  "brands": [
    {
      "id": 123,
      "name": "MarqueExample",
      "nbControverses": 2,
      "nbCondamnations": 1,
      "nbDirigeantsControverses": 1,
      "categories": [
        { "id": 1, "nom": "Géopolitique", "emoji": "🌍", "couleur": "#red" }
      ],
      "evenements": [...],
      "dirigeants_controverses": [
        {
          "id": 45,                           // ID liaison marque_dirigeant
          "dirigeant_id": 12,                 // ID dirigeant dans table centralisée
          "dirigeant_nom": "Jean Dupont",
          "controverses": "Description des controverses...",
          "sources": ["url1", "url2"],
          "lien_financier": "Co-fondateur et actionnaire via Otium Capital (100%)",
          "impact_description": "Impact spécifique ou générique"
        }
      ]
    }
  ],
  "version": "2024-08-08T10:30:00.000Z",
  "checksum": "23-45-1691234567890"
}
```

### Migration et Compatibilité
- **Rétrocompatibilité** : Extensions existantes continuent de fonctionner
- **Format unifié** : `dirigeants_controverses` standardisé
- **Performance** : Requêtes optimisées avec relations normalisées
- **Évolutivité** : Ajout de nouveaux dirigeants sans duplication

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