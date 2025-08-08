# Extension API - Répertoire des Marques à Boycotter

API Serverless (Netlify Functions) optimisée pour la synchronisation des extensions Chrome/Firefox du Répertoire Collaboratif des Marques à Boycotter.

## 🎯 Objectif

Cette API permet à l'extension de :
- Vérifier s'il y a de nouvelles données disponibles
- Récupérer les mises à jour incrémentales depuis une date donnée
- Obtenir l'ensemble complet des données en cas de problème

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
cd extension-api
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

### `GET /health`
Health check et diagnostics du service
```json
{
  "status": "OK",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "service": "Extension API - Netlify",
  "version": "1.0.0",
  "environment": "production"
}
```

### `GET /api/brands/version`
Métadonnées de version pour synchronisation intelligente
```json
{
  "version": "2024-01-15T10:30:00.000Z",
  "lastUpdated": "2024-01-15T10:30:00.000Z", 
  "totalBrands": 42,
  "totalEvents": 156,
  "checksum": "42-156-1705316200000"
}
```
**Cache :** 5 minutes | **Fallback :** updated_at → created_at → timestamp

## 📊 Structure des Données V2 - Dirigeants Normalisés

### Évolution Architecturale
Cette API supporte désormais une architecture de base de données normalisée pour les dirigeants controversés :

- **V1 (Legacy)** : Données dirigeant dupliquées pour chaque marque
- **V2 (Actuel)** : Dirigeants centralisés + table de liaison `marque_dirigeant`

### Avantages V2
- ✅ **Réutilisabilité** : Un dirigeant peut être lié à plusieurs marques
- ✅ **Performance** : Moins de duplication de données
- ✅ **Maintenance** : Mise à jour centralisée des informations dirigeant
- ✅ **Rétrocompatibilité** : Extensions existantes continuent de fonctionner

### Transformation Automatique
L'API transforme automatiquement les données normalisées V2 au format attendu par les extensions :
```javascript
// Base de données V2 (normalisée)
{
  marque_dirigeant: [{
    id: 45,
    dirigeant_id: 12,
    lien_financier: "Co-fondateur...",
    impact_specifique: "100% des achats...",
    dirigeant: {
      nom: "Jean Dupont",
      controverses: "Description...",
      sources: ["url1", "url2"],
      impact_generique: "Impact générique..."
    }
  }]
}

// ↓ Transformation API ↓

// Format extension (rétrocompatible)
{
  dirigeants_controverses: [{
    id: 45,                    // ID liaison
    dirigeant_id: 12,          // ID dirigeant centralisé
    dirigeant_nom: "Jean Dupont",
    controverses: "Description...",
    sources: ["url1", "url2"],
    lien_financier: "Co-fondateur...",
    impact_description: "100% des achats..." // impact_specifique || impact_generique
  }]
}
```

### `GET /api/brands/updates?since=<ISO_DATE>`
Récupérer les mises à jour depuis une date
```json
{
  "hasUpdates": true,
  "updatedBrands": [...],
  "updatedEvents": [...],
  "timestamp": "2024-01-15T10:30:00.000Z"
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
  "version": "2024-01-15T10:30:00.000Z",
  "lastUpdated": "2024-01-15T10:30:00.000Z",
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

### Logs
- Toutes les requêtes loggées avec timestamp
- Erreurs détaillées en développement
- Erreurs masquées en production

### Métriques
- Statistiques de cache disponibles via `/api/stats`
- Monitoring des performances en temps réel

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