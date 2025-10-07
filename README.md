# ODM API - Observatoire des Marques

API Serverless (Netlify Functions) ultra-optimisée pour :
1. **Extensions Chrome/Firefox** - Synchronisation des données avec cache intelligent
2. **Application Web ODM** - Architecture hybride avec SQL JOINs optimisés et cache multi-niveau
3. **Auto-complétion** - Endpoint spécialisé sub-100ms pour suggestions temps réel 

## 🎯 Objectifs

### Pour les Extensions
- Vérifier s'il y a de nouvelles données disponibles  
- Récupérer les mises à jour incrémentales depuis une date donnée
- Obtenir l'ensemble complet des données en cas de problème

### Pour l'Application Web
- Servir de couche de cache optimisée avec SQL JOINs unifiés
- Réduire la charge sur Supabase avec recherche déléguée
- Centraliser la logique de requête des données sans doublons
- Fournir auto-complétion ultra-rapide via endpoint spécialisé

## 🏗️ Architecture Serverless

### Netlify Functions + Edge CDN
- **Serverless** : Auto-scaling avec Netlify Functions (Node.js 22)
- **Cache Multi-niveau** : In-memory + CDN Edge (5-30min TTL)
- **Distribution Globale** : Edge computing pour latence minimale
- **Source de vérité** : Base Supabase partagée avec l'application web

### Pipeline de Données
```
Supabase (PostgreSQL) → Netlify Functions → Extensions Browser
     ↓                        ↓                    ↓
 Relations DB            Transform + Cache    Local Storage
 Temps réel                JSON optimisé       Sync incrémentale
```

## 🚀 Développement Local

### Prérequis
- Node.js 22+ (ESM modules)
- Netlify CLI : `npm install -g netlify-cli`
- Variables d'environnement Supabase

### Installation
```bash
# Clone et installation
git clone [repo-url]
cd odm-api
npm install
```

### Configuration
Créer `.env` avec :
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
NODE_ENV=development
```

### Démarrage Local
```bash
# Développement avec Netlify Dev
netlify dev

# Test des functions individuellement
netlify functions:invoke health
netlify functions:invoke brands-version

# Déploiement
netlify deploy --prod
```

## 📡 Endpoints API

### 🏥 Monitoring

#### `GET /health`
Health check et diagnostics du service
```json
{
  "status": "OK",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "service": "Extension API - Netlify",
  "version": "1.0.0",
  "environment": "production"
}
```

### 🔄 Synchronisation Extension

#### `GET /api/brands/version`
Métadonnées de version pour synchronisation intelligente
```json
{
  "version": "2025-01-15T10:30:00.000Z",
  "lastUpdated": "2025-01-15T10:30:00.000Z", 
  "totalBrands": 42,
  "totalEvents": 156,
  "checksum": "42-156-1705316200000"
}
```
**Cache :** 5 minutes | **Fallback :** updated_at → created_at → timestamp

### 🌐 Endpoints Application Web 

#### `GET /marques`
Données marques avec recherche par nom exact (insensible à la casse), pagination et SQL JOINs optimisés
```bash
GET /marques?search=nike&limit=50&offset=0
```
```json
[
  {
    "id": 1,
    "nom": "Nike",
    "secteur_marque_id": 2,
    "message_boycott_tips": "...",
    "beneficiaires_marque": [
      {
        "id": 12,
        "lien_financier": "Actionnaire principal",
        "source_lien": "direct",
        "beneficiaire": {
          "id": 7,
          "nom": "BlackRock",
          "controverses": [...],
          "marques_directes": [{"id": 2, "nom": "Starbucks"}],
          "marques_indirectes": {
            "1": [{"id": 35, "nom": "Herta"}]
          }
        }
      }
    ],
    "evenements": [...],
    "categories": [...],
    "nbControverses": 3,
    "nbCondamnations": 1,
    "nbDirigeantsControverses": 1,
    "secteur_marque": { ... }
  }
]
```
**Cache :** 20 minutes | **Performance :** SQL JOINs unifiés, structure optimisée

**Utilisation Application Web :**
- **Page `/marques`** : Filtrage côté client sur données complètes (secteur, bénéficiaire, tri)
- **SearchHero** : Récupère suggestions via `/suggestions`, puis navigue vers `/marques/${slug}` ou `/marques?search=query`
- **État "Pas de résultats"** : Géré côté client dans `MarquesListClient` (pas d'endpoint spécifique)

Sémantique de recherche:
- Paramètre `search` = match exact (case-insensitive) sur `nom` (ILIKE sans wildcards)
- Les `evenements` incluent les objets `marque` et `categorie` normalisés pour l'UI
- Aucune recherche full-text sur titre/catégorie d'événement

#### `GET /suggestions`
Auto-complétion ultra-rapide pour recherche en temps réel
```bash
GET /suggestions?q=nike&limit=10
```
```json
[
  {
    "id": 1,
    "nom": "Nike"
  },
  {
    "id": 25,
    "nom": "Nike Jordan"
  }
]
```
**Cache :** 5 minutes | **Performance :** Structure minimale (id + nom), sub-100ms

**Utilisation Application Web :**
- **SearchHero** : Affichage dropdown suggestions en temps réel (debouncing 200ms)
- **AbortController** : Gestion race conditions côté client (annulation requêtes obsolètes)
- **Navigation** : Sélection suggestion → redirect `/marques/${slug}` avec scroll automatique

Sémantique:
- Préfixe uniquement (startsWith), insensible à la casse (ILIKE avec wildcard de fin seulement : `q%`)

#### `GET /evenements`
Événements avec pagination et données complètes
```bash
GET /evenements?limit=100&offset=0
```
```json
[
  {
    "id": 1,
    "marque_id": 1,
    "titre": "Controverse travail des enfants",
    "date": "2025-01-15",
    "source_url": "https://...",
    "condamnation_judiciaire": false,
    "marque": { ... },
    "categorie": { ... }
  }
]
```
**Cache :** 15 minutes | **Optimisé pour :** Timeline publique

Usage:
- Utilisé pour la timeline publique (chargement initial)
- Non utilisé par SearchHero (qui utilise `/suggestions` + navigation vers `/marques`)

#### `GET /categories`
Catégories d'événements actives
```json
[
  {
    "id": 1,
    "nom": "Droits Humains", 
    "emoji": "⚖️",
    "couleur": "#dc2626",
    "ordre": 1,
    "actif": true
  }
]
```
**Cache :** 1 heure | **Données quasi-statiques**

#### `GET /dirigeants` *(Endpoint supprimé)*
~~Dirigeants avec relations marques~~

**⚠️ Endpoint retiré** : Toute la logique bénéficiaires/dirigeants est maintenant intégrée dans `/marques` pour simplifier l'architecture.

**Utiliser à la place :** `GET /marques` qui contient toutes les données de bénéficiaires controversés avec relations transitives.

#### `GET /secteurs-marque`  
Secteurs pour Boycott Tips
```bash
GET /secteurs-marque         # Tous
GET /secteurs-marque?id=456  # Spécifique
```
```json
[
  {
    "id": 1,
    "nom": "Mode & Textile",
    "description": "...",
    "message_boycott_tips": "Privilégiez la seconde main...",
    "created_at": "2025-01-15T10:30:00.000Z",
    "updated_at": "2025-01-15T10:30:00.000Z"
  }
]
```
**Cache :** 1 heure | **Métadonnées stables**

#### `GET /api/beneficiaires/chaine?marqueId=<ID>&profondeur=<N>`
Chaîne financière de bénéficiaires avec algorithme récursif et marques liées
```bash
GET /api/beneficiaires/chaine?marqueId=79&profondeur=5  # Maybelline avec 5 niveaux max
```
```json
{
  "marque_nom": "Maybelline",
  "marque_id": 79,
  "chaine": [
    {
      "beneficiaire": {
        "id": 10,
        "nom": "Groupe l'Oréal",
        "controverses": [
          {
            "id": 23,
            "beneficiaire_id": 10,
            "titre": "Tests sur les animaux malgré l'interdiction européenne",
            "source_url": "https://example.com/source",
            "ordre": 1,
            "created_at": "2025-01-15T10:30:00.000Z",
            "updated_at": "2025-01-15T10:30:00.000Z"
          }
        ],
        "impact_generique": "Vos achats financent ce groupe controversé...",
        "type_beneficiaire": "groupe"
      },
      "niveau": 0,
      "lien_financier": "Marque détenue à 100% par le groupe",
      "marques_directes": [
        {"id": 25, "nom": "Lancôme"},
        {"id": 26, "nom": "Urban Decay"},
        {"id": 27, "nom": "Yves Saint Laurent"}
      ],
      "marques_indirectes": {
        "Nestlé SA": [
          {"id": 45, "nom": "KitKat"},
          {"id": 46, "nom": "Nescafé"}
        ]
      },
      "relations_suivantes": [{
        "id": 4,
        "beneficiaire_source_id": 10,
        "beneficiaire_cible_id": 5,
        "type_relation": "actionnaire",
        "description_relation": "Nestlé détient 23% de L'Oréal",
      }]
    },
    {
      "beneficiaire": {
        "id": 5,
        "nom": "Nestlé SA",
        "controverses": [...],
        "type_beneficiaire": "groupe"
      },
      "niveau": 1,
      "lien_financier": "Participation financière",
      "marques_directes": [
        {"id": 45, "nom": "KitKat"},
        {"id": 46, "nom": "Nescafé"},
        {"id": 47, "nom": "Smarties"}
      ],
      "marques_indirectes": {
        "BlackRock": [
          {"id": 89, "nom": "iShares ETF"},
          {"id": 90, "nom": "Autre marque BlackRock"}
        ]
      },
      "relations_suivantes": [...]
    }
  ],
  "profondeur_max": 2
}
```

**Fonctionnalités :**
- **Algorithme récursif complet** avec protection contre les cycles infinis
- **Liens financiers** détaillés pour chaque niveau de la chaîne  
- **Marques directes** : Toutes les marques liées directement au bénéficiaire (exclut la marque de recherche)
- **Marques indirectes** : Marques accessibles via **tous** les bénéficiaires intermédiaires de façon récursive (ex: BlackRock voit les marques de L'Oréal via Nestlé)
- **Controverses structurées** avec sources et métadonnées complètes

**Configuration :**
- **Cache :** 10 minutes | **Profondeur max :** 5 niveaux | **Détection cycles :** Oui

**Cas d'usage :**
- Interface "Chaîne de bénéficiaires" dans l'application web
- Trace la chaîne complète : `Maybelline → Groupe l'Oréal → Nestlé SA → BlackRock + Vanguard`
- Affiche les "autres marques liées" pour chaque bénéficiaire de la chaîne
- Permet de découvrir l'étendue complète de l'impact des achats

## 🛠️ Architecture Technique

### Cache Serverless Intelligent

**Fichier :** `netlify/functions/utils/serverlessCache.js`

Système de cache adapté aux contraintes serverless où chaque function Netlify dispose de son propre cache isolé.

**Fonctionnalités :**
- Cache par function avec configuration TTL unifiée
- Nettoyage automatique LRU pour éviter overflow mémoire
- Métriques intégrées (hit rate, cache size)
- Clés standardisées pour éviter fragmentation
- TTL adaptatif selon type d'endpoint

**Endpoints de monitoring :**
- `cache-metrics.js` : Métriques temps réel du cache
- `cache-benchmark.js` : Tests de performance et stress test

**Utilisé par :** `suggestions.js`, `marques.js`, `beneficiaires-chaine.js`

**🎯 Post-Optimisation Architecture Unifiée :**
- Cache unifié partagé entre toutes les functions (vs cache fragmenté)
- Interface `createServerlessCache()` cohérente partout
- Hit rate amélioré grâce à la stratification intelligente (TTL adaptatif)
- Architecture sans dette technique (ex-unifiedCache uniformisé)

### Module Utilitaire Partagé

**Fichier :** `netlify/functions/utils/marquesTransitives.js`

Ce module contient la logique centralisée pour calculer les marques transitives des bénéficiaires, évitant la duplication de code entre les endpoints `/marques` et `/beneficiaires-chaine`.

**Fonctionnalités :**
- `recupererToutesMarquesTransitives()` : Algorithme récursif principal
- Cache intelligent avec TTL de 30 minutes
- Protection anti-cycles et limitation de profondeur
- Support des relations financières complexes

**Utilisé par :**
- `marques.js` : Calcul des bénéficiaires transitifs avec leurs marques
- `beneficiaires-chaine.js` : Enrichissement des chaînes avec les marques liées

## 📊 Structure des Données - Dirigeants Normalisés

### Sections Marques

Chaque bénéficiaire dispose maintenant de sections séparées pour ses marques liées :

#### `marques_directes`
Marques directement associées au bénéficiaire (excluant la marque de recherche)
```json
"marques_directes": [
  {"id": 2, "nom": "Starbucks"},
  {"id": 3, "nom": "Nike"}
]
```

#### `marques_indirectes`  
Marques des bénéficiaires qui profitent au bénéficiaire via relations transitives, groupées par bénéficiaire intermédiaire
```json
"marques_indirectes": {
  "Nestlé": [
    {"id": 35, "nom": "Herta"},
    {"id": 39, "nom": "Nescafé"}
  ]
}
```

**Cas d'usage :**
- Recherche "Starbucks" → BlackRock direct avec marques indirectes de Nestlé
- Recherche "Herta" → BlackRock transitif avec marques indirectes de Nestlé  
- Interface utilisateur : badges berry (directes) vs bleus (indirectes)

### Fonctionnalités
- **Réutilisabilité** : Un dirigeant peut être lié à plusieurs marques
- **Performance** : Données centralisées sans duplication
- **Sections marques** : Distinction directes vs indirectes
- **Relations transitives** : Support des bénéficiaires en cascade


### `GET /api/brands/updates?since=<ISO_DATE>`
Récupérer les mises à jour depuis une date
```json
{
  "hasUpdates": true,
  "updatedBrands": [...],
  "updatedEvents": [...],
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

### `GET /api/brands/full`
Récupérer toutes les données (fallback)
```json
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
          "id": 45,
          "dirigeant_id": 12,
          "dirigeant_nom": "Jean Dupont",
          "controverses": "Description des controverses...",
          "sources": ["url1", "url2"],
          "lien_financier": "Co-fondateur et actionnaire via Otium Capital (100%)",
          "impact_description": "Impact spécifique ou générique"
        }
      ]
    }
  ],
  "version": "2025-01-15T10:30:00.000Z",
  "lastUpdated": "2025-01-15T10:30:00.000Z",
  "totalBrands": 42,
  "checksum": "42-156-1705316200000"
}
```

### `GET /api/stats`
Statistiques de cache et serveur
```json
{
  "cache": {
    "keys": 15,
    "hits": 234,
    "misses": 12,
    "hitRate": 95.1
  },
  "server": {
    "uptime": 7200,
    "memory": {...},
    "pid": 12345
  }
}
```

## ⚡ Performance

### Cache multi-niveaux
- **Version** : 5 minutes
- **Mises à jour** : 10 minutes  
- **Données complètes** : 30 minutes

### Rate Limiting
- 100 requêtes par IP / 15 minutes
- Protection contre les abus

### Compression
- Réponses compressées automatiquement
- Réduction de 60-80% de la taille

## 🔒 Sécurité

- **Helmet.js** : Headers de sécurité
- **CORS configuré** : Extensions et localhost uniquement  
- **Rate limiting** : Protection DDoS
- **Validation des entrées** : Sanitisation des paramètres

## 🎛️ Configuration

### Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|---------|
| `PORT` | Port du serveur | `3001` |
| `NODE_ENV` | Environnement | `development` |
| `SUPABASE_URL` | URL Supabase | - |
| `SUPABASE_ANON_KEY` | Clé publique Supabase | - |
| `CACHE_TTL_SECONDS` | TTL cache par défaut | `3600` |
| `CACHE_MAX_KEYS` | Nombre max de clés en cache | `1000` |
| `ALLOWED_ORIGINS` | Origines CORS autorisées | `chrome-extension://,moz-extension://` |

## 📊 Monitoring

### Logs Essentiels
- **Cache Hit/Miss** : `[function] Cache HIT/MISS` pour optimisation
- **Erreurs** : `[function] Error: message` pour debugging
- **Simplifiés** : Logs minimalistes pour réduire les coûts

### Stack de Monitoring
- **Sentry** : Capture automatique des erreurs avec contexte
- **UptimeRobot** : Surveillance uptime et latence
- **Console logs** : Métriques cache essentielles uniquement

## 🚀 Déploiement

### Options recommandées
1. **Vercel** : Déploiement auto via Git
2. **Railway** : Base de données incluse  
3. **Heroku** : Configuration simple
4. **VPS personnalisé** : Contrôle total

### Variables de production
```env
NODE_ENV=production
PORT=3001
SUPABASE_URL=https://prod.supabase.co
SUPABASE_ANON_KEY=prod_key
CACHE_TTL_SECONDS=3600
```

## 🔄 Intégration avec l'extension

L'extension utilise cette API via le système `AutoUpdater` :

1. **Vérification périodique** : Toutes les heures
2. **Comparaison de versions** : Checksum local vs API
3. **Mises à jour incrémentales** : Seulement les changements
4. **Fallback complet** : Si les mises à jour échouent
5. **Fusion des données** : Static + Dynamic via `DataMerger`

## 📈 Évolutivité

### Cache externe (futur)
- Redis pour le cache distribué
- Sessions partagées entre instances

### CDN (futur)  
- Cache des données statiques
- Distribution géographique

### Analytics (futur)
- Métriques d'utilisation extension
- Données populaires et tendances