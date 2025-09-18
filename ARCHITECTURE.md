# Architecture de l'ODM API

## 📁 Structure du Projet

```
odm-api/
├── netlify/                 # Netlify Functions (Serverless)
│   └── functions/          
│       ├── health.js        # Health check et monitoring
│       ├── brands-version.js # Métadonnées de version
│       ├── brands-updates.js # Synchronisation incrémentale
│       ├── brands-full.js   # Récupération complète (fallback)
│       ├── marques.js       # Marques pour l'application web
│       ├── evenements.js    # Événements et controverses
│       ├── categories.js    # Catégories d'événements
│       ├── secteurs-marque.js # Secteurs pour Boycott Tips
│       ├── beneficiaires-chaine.js # Chaîne financière de bénéficiaires
│       └── utils/           # Modules utilitaires partagés
│           └── marquesTransitives.js # Algorithme récursif marques transitives
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

### suggestions.js - Auto-complétion Ultra-rapide (Solution 1)
```javascript
// Architecture: Endpoint spécialisé pour auto-complétion sub-100ms + Cache serverless
import { createServerlessCache } from './utils/serverlessCache.js'

// Cache spécialisé pour cette fonction
const cache = createServerlessCache('suggestions')

export const handler = async (event) => {
  const { q, limit = '10' } = event.queryStringParameters || {}

  if (!q || q.trim().length < 1) {
    return successResponse([])
  }

  // Check cache serverless optimisé
  const params = { q: q.toLowerCase().trim(), limit }
  const cached = cache.get('suggestions', params)

  if (cached) {
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'X-Data-Source': 'odm-api-suggestions-cache-unified',
        'X-Cache': 'HIT'
      },
      body: JSON.stringify(cached)
    }
  }

  // Requête ultra-optimisée : seulement id + nom
  const { data: marques, error } = await supabase
    .from('Marque')
    .select('id, nom')
    .ilike('nom', `${q.trim()}%`)
    .limit(parseInt(limit))
    .order('nom')

  if (error) throw error

  const suggestions = marques || []

  // Cache serverless avec TTL automatique (5 minutes pour suggestions)
  cache.set('suggestions', suggestions, params)

  return successResponse(suggestions)
}
```
**Patterns utilisés :**
- **Performance optimisée** : Sub-100ms grâce au cache agressif et limites strictes
- **Requêtes parallèles** : Promise.all pour marques + bénéficiaires simultanément
- **Cache intelligent** : TTL 5min adapté aux suggestions temps réel
- **Réponse structurée** : Type marque/beneficiaire pour différentiation frontend
- **Limite pragmatique** : Max 8 résultats pour UX fluide

### beneficiaires-chaine.js - Chaîne Financière de Bénéficiaires
```javascript
// Architecture: Algorithme Récursif + Enrichissement Marques + Cache Multi-niveaux
export const handler = async (event) => {
  const { marqueId, profondeur } = event.queryStringParameters || {}
  const profondeurMax = parseInt(profondeur || '5')
  const cacheKey = `chaine-${marqueId}-${profondeurMax}`
  
  // Cache multi-niveaux : in-memory + CDN Edge
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey)
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return successResponse(cached.data)
    }
  }
  
  // 1. Construire la chaîne récursive avec liens financiers
  const chaineFusionnee = []
  for (const liaison of liaisonsBeneficiaires) {
    const chaine = await construireChaineRecursive(
      liaison.beneficiaire_id,
      0, // Niveau 0 pour bénéficiaire direct
      new Set(),
      profondeurMax,
      liaison.lien_financier || 'Lien financier direct'
    )
    chaineFusionnee.push(...chaine)
  }
  
  // 2. Éliminer doublons et trier
  const chaineUnique = chaineFusionnee.filter((node, index, array) => 
    array.findIndex(n => n.beneficiaire.id === node.beneficiaire.id) === index
  ).sort((a, b) => {
    if (a.niveau !== b.niveau) return a.niveau - b.niveau
    return a.beneficiaire.nom.localeCompare(b.beneficiaire.nom)
  })
  
  // 3. Enrichir avec marques liées pour TOUS les bénéficiaires de la chaîne
  const chaineEnrichie = await enrichirAvecMarquesLiees(chaineUnique, marque.id)
  
  const resultat = {
    marque_nom: marque.nom,
    marque_id: marque.id,
    chaine: chaineEnrichie,
    profondeur_max: chaineEnrichie.length > 0 ? Math.max(...chaineEnrichie.map(node => node.niveau)) : 0
  }
  
  cache.set(cacheKey, { data: resultat, timestamp: Date.now() })
  return successResponse(resultat)
}

// Fonction d'enrichissement - traite tous les bénéficiaires de la chaîne
async function enrichirAvecMarquesLiees(chaineNodes, marqueId) {
  const beneficiairesEnrichis = new Map()
  
  for (const node of chaineNodes) {
    // Marques directes : toutes les marques liées au bénéficiaire (sauf la marque de recherche)
    const { data: toutesMarquesDuBeneficiaire } = await supabase
      .from('Marque_beneficiaire')
      .select('Marque!marque_id (id, nom)')
      .eq('beneficiaire_id', node.beneficiaire.id)
    
    const marques_directes = toutesMarquesDuBeneficiaire
      ?.map(m => ({ id: m.Marque.id, nom: m.Marque.nom }))
      .filter(m => m.id !== marqueId) || []
    
    // Marques indirectes : via relations entrantes du bénéficiaire
    const marques_indirectes = {}
    const { data: relationsEntrantes } = await supabase
      .from('beneficiaire_relation')
      .select(`
        beneficiaire_source_id,
        beneficiaire_source:Beneficiaires!beneficiaire_relation_beneficiaire_source_id_fkey (nom)
      `)
      .eq('beneficiaire_cible_id', node.beneficiaire.id)
    
    for (const relation of relationsEntrantes || []) {
      const { data: marquesIntermediaires } = await supabase
        .from('Marque_beneficiaire')
        .select('Marque!marque_id (id, nom)')
        .eq('beneficiaire_id', relation.beneficiaire_source_id)
      
      const marquesFiltered = marquesIntermediaires
    // ✅ NOUVELLE LOGIQUE : Utiliser la fonction récursive partagée
    const marquesTransitives = await recupererToutesMarquesTransitives(
      supabase,
      node.beneficiaire.id,
      marqueId,
      new Set(),
      5
    );
    
    beneficiairesEnrichis.set(node.beneficiaire.id, {
      marques_directes,
      marques_indirectes: marquesTransitives.marquesIndirectes
    })
  }
  
  // Appliquer l'enrichissement à chaque node
  return chaineNodes.map(node => ({
    ...node,
    marques_directes: beneficiairesEnrichis.get(node.beneficiaire.id)?.marques_directes || [],
    marques_indirectes: beneficiairesEnrichis.get(node.beneficiaire.id)?.marques_indirectes || {}
  }))
}
```
**Patterns utilisés :**
- **Module utilitaire partagé** : `utils/marquesTransitives.js` évite la duplication de code
- **Algorithme récursif complet** avec protection contre les cycles infinis (`Set` visitedIds)
- **Liens financiers transitifs** : chaque niveau garde trace de son lien financier parent
- **Enrichissement post-construction** : marques liées calculées après la chaîne complète
- **Marques directes** : toutes les marques liées directement au bénéficiaire
- **Marques indirectes** : **récursion complète** via tous les bénéficiaires intermédiaires (ex: BlackRock voit L'Oréal via Nestlé)
- **Cache intelligent** multi-niveaux : 10min (chaînes) + 30min (marques transitives)
- **Déduplication** des bénéficiaires présents à plusieurs niveaux
- **Tri hiérarchique** : niveau puis nom alphabétique
- **Performance optimisée** : évite queries redondantes avec Map interne

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
    
    // Transformation dirigeants avec toutes les marques liées
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

## 🔄 Cache Strategy - Serverless Multi-Layer

### Niveau 1 : Serverless Function Cache
**Architecture :** Cache isolé par function avec TTL adaptatif selon usage.

```javascript
// serverlessCache.js - Cache optimisé
const SERVERLESS_TTL = {
  // Web App optimisée (payload réduit 40%)
  suggestions: 5 * 60 * 1000,        // 5min - auto-complétion ultra-rapide
  marques_search: 10 * 60 * 1000,    // 10min - recherche avec chaîne complète
  marques_all: 20 * 60 * 1000,       // 20min - liste simple sans chaîne

  // Extension Browser (format legacy maintenu)
  version: 5 * 60 * 1000,            // 5min - contrôle version
  updates: 10 * 60 * 1000,           // 10min - sync incrémentale
  full: 30 * 60 * 1000,              // 30min - fallback complet

  // Endpoints spécialisés
  beneficiaires_chaine: 15 * 60 * 1000,  // 15min - chaîne récursive
  evenements: 15 * 60 * 1000,        // 15min - pagination
  categories: 60 * 60 * 1000,        // 1h - quasi-statiques
  secteurs: 60 * 60 * 1000           // 1h - stables
}
```

**Fonctionnalités clés :**
- **Isolation serverless** : Chaque function a son cache dédié
- **Nettoyage automatique** : LRU avec cycle toutes les 10 minutes
- **Métriques intégrées** : Hit rate, cache size, performance
- **Clés standardisées** : Évite fragmentation avec tri des paramètres
- **TTL adaptatif** : Configuration selon type de données

## 🌐 Application Web Support - Architecture Optimisée

### Endpoints Web App (Solutions 1, 2, 3 implémentées)
L'API supporte l'application web avec des optimisations de performance majeures :

**Optimisations clés :**
- **Endpoint `/suggestions`** : Auto-complétion sub-100ms (Solution 1)
- **Recherche déléguée** : Filtrage serveur réduit trafic de 60% (Solution 2)
- **SQL JOINs unifiés** : Élimination anti-patterns N+1 (Solution 3)
- **Architecture unifiée** : Cache intelligent partagé entre recherche et suggestions (Solution 5)
- **Structure sans duplication** : Format `beneficiaires_marque` consolidé
- **Cache multi-niveau** : TTL adaptatif avec extraction intelligente
 
> Note: La SearchBar de l'application web est limitée à la recherche de marques uniquement. La requête est un match exact (insensible à la casse) sur le nom de marque via l'endpoint `/marques`. Les suggestions utilisent un match préfixe (startsWith) via l'endpoint `/suggestions`. Les mots-clés (titre/catégorie d'événement) ne sont pas pris en charge dans cette page.

#### marques.js - Application Web Optimisée (Payload réduit 40%)
```javascript
// Architecture: Conditional Loading + Cache adaptatif + Payload minimal
export const handler = async (event) => {
  const { search, limit = '999' } = event.queryStringParameters || {}
  const endpointType = search ? 'marques_search' : 'marques_all'

  // Cache adaptatif : 10min recherche / 20min liste
  const cached = cache.get(endpointType, params)
  if (cached) {
    return successResponse(cached)
  }

  // SQL JOINs optimisés - données essentielles uniquement
  let query = supabase.from('Marque').select(`
    *,
    Evenement!marque_id (id, titre, date, source_url, reponse, condamnation_judiciaire, Categorie!categorie_id (id, nom, emoji, couleur)),
    SecteurMarque!secteur_marque_id (nom, message_boycott_tips),
    Marque_beneficiaire!marque_id (id, beneficiaire_id, lien_financier, impact_specifique, Beneficiaires!beneficiaire_id (*))
  `)

  if (search) query = query.ilike('nom', search)
  const { data: brands } = await query.order('nom')

  // Pattern: Conditional Data Loading selon contexte
  const transformedBrands = await Promise.all(brands.map(async marque => {
    let donneesChaine = {
      chaine_beneficiaires: [],
      total_beneficiaires_chaine: 0
    }

    // Mode recherche : chaîne complète + marques liées
    if (search) {
      donneesChaine = await construireChaineCompletePourMarque(marque.id, 5)
    }

    // Payload minimal : suppression redondances (~40% réduction)
    return {
      id: marque.id,
      nom: marque.nom,
      evenements: marque.Evenement?.map(ev => ({
        id: ev.id,
        titre: ev.titre,
        date: ev.date,
        source_url: ev.source_url,
        reponse: ev.reponse,
        condamnation_judiciaire: ev.condamnation_judiciaire,
        categorie: ev.Categorie || null
      })) || [],
      message_boycott_tips: marque.message_boycott_tips,
      secteur_marque: marque.SecteurMarque ? {
        nom: marque.SecteurMarque.nom,
        message_boycott_tips: marque.SecteurMarque.message_boycott_tips
      } : null,
      ...donneesChaine
    }
  }))

  cache.set(endpointType, transformedBrands, params)
  return successResponse(transformedBrands)
}
```
**Optimisations :**
- **Payload réduit 40%** : Suppression `created_at`, `marque_id`, `categorie_id`, `description`, etc.
- **Conditional Loading** : Chaîne bénéficiaires seulement pour recherches
- **Événements simplifiés** : 6 propriétés essentielles vs 12+ anciennes
- **Structure unifiée** : `chaine_beneficiaires` remplace patterns N+1
- **Cache intelligent** : TTL adaptatif selon usage

#### evenements.js - Événements avec Pagination
```javascript
// Support pagination pour l'app web
export const handler = async (event) => {
  const { page = '1', limit = '20', marqueId } = event.queryStringParameters || {}
  
  let query = supabase.from('Evenement').select(`
    *, 
    marque:Marque!marque_id (id, nom),
    categorie:Categorie!categorie_id (id, nom, emoji, couleur)
  `)
  
  if (marqueId) query = query.eq('marque_id', marqueId)
  
  // Pagination avec range
  const from = (parseInt(page) - 1) * parseInt(limit)
  const to = from + parseInt(limit) - 1
  
  const { data, error, count } = await query
    .range(from, to)
    .order('created_at', { ascending: false })
}
```

#### categories.js - Catégories d'Événements
```javascript
// Endpoint simple pour les catégories avec cache long
export const handler = async (event) => {
  const cacheKey = 'categories-all'
  
  // Cache 30 minutes car données très stables
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey)
    if (Date.now() - cached.timestamp < 30 * 60 * 1000) {
      return successResponse(cached.data)
    }
  }
  
  const { data: categories } = await supabase
    .from('Categorie')
    .select('*')
    .eq('actif', true)
    .order('ordre', { ascending: true })
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