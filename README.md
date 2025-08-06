# Extension API - Répertoire des Marques à Boycotter

API Express.js pour les mises à jour automatiques de l'extension Chrome/Firefox du Répertoire Collaboratif des Marques à Boycotter.

## 🎯 Objectif

Cette API permet à l'extension de :
- Vérifier s'il y a de nouvelles données disponibles
- Récupérer les mises à jour incrémentales depuis une date donnée
- Obtenir l'ensemble complet des données en cas de problème

## 🏗️ Architecture

### Système hybride
- **Extension** : Données statiques embedées + mises à jour dynamiques
- **API** : Connectée à la base Supabase partagée avec le site web
- **Cache intelligent** : Optimisation des performances et réduction de la charge

## 🚀 Installation et démarrage

### Prérequis
- Node.js 18+
- Variables d'environnement Supabase

### Installation
```bash
npm install
```

### Configuration
Copier `.env.example` vers `.env` et remplir :
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
PORT=3001
```

### Démarrage
```bash
# Développement avec watch
npm run dev

# Production
npm start
```

## 📡 Endpoints API

### `GET /health`
Vérification de l'état de l'API
```json
{
  "status": "OK",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "version": "1.0.0"
}
```

### `GET /api/brands/version`
Obtenir la version actuelle des données
```json
{
  "version": "2024-01-15T10:30:00.000Z",
  "lastUpdated": "2024-01-15T10:30:00.000Z",
  "totalBrands": 42,
  "totalEvents": 156,
  "checksum": "42-156-1705316200000"
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
  "brands": [...],
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