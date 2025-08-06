# 🧪 Guide de Test - Extension API

Guide complet pour tester l'API et l'intégration avec l'extension.

## 🎯 Prérequis pour les tests

```bash
# Installation des dépendances
cd extension-api
npm install

# Variables d'environnement (copier .env.example)
cp .env.example .env
# Remplir avec vos vraies credentials Supabase
```

## 🚀 Tests Locaux

### 1. Démarrer l'API en local

```bash
# Mode développement avec reload automatique
npm run dev

# Vérifier que ça fonctionne
curl http://localhost:3001/health
```

### 2. Test des endpoints

#### Health Check
```bash
curl http://localhost:3001/health
```

Réponse attendue :
```json
{
  "status": "OK",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 123.45,
  "version": "1.0.0"
}
```

#### Version des données
```bash
curl http://localhost:3001/api/brands/version
```

Réponse attendue :
```json
{
  "version": "2024-01-15T10:30:00.000Z",
  "lastUpdated": "2024-01-15T10:30:00.000Z",
  "totalBrands": 42,
  "totalEvents": 156,
  "checksum": "42-156-1705316200000"
}
```

#### Mises à jour depuis une date
```bash
curl "http://localhost:3001/api/brands/updates?since=2024-01-01T00:00:00.000Z"
```

#### Données complètes
```bash
curl http://localhost:3001/api/brands/full
```

#### Statistiques
```bash
curl http://localhost:3001/api/stats
```

## 🌐 Test Extension + API

### 1. Configurer l'extension pour l'API locale

Modifier `/Xtension/lib/services/autoUpdater.js` :
```javascript
// Changer l'URL pour les tests locaux
this.apiBaseUrl = 'http://localhost:3001';
```

### 2. Charger l'extension en mode développeur

1. Chrome → `chrome://extensions/`
2. Activer "Mode développeur"
3. "Charger l'extension non empaquetée"
4. Sélectionner le dossier `/Xtension/`

### 3. Tester l'intégration

1. **Console Extension** :
   ```javascript
   // Dans la console du contenu d'un site e-commerce
   window.RMBAutoUpdater.forceUpdate();
   window.RMBAutoUpdater.getStatus();
   ```

2. **Vérifier les logs** :
   - Console de l'extension
   - Console du serveur API
   - Network tab pour les requêtes

### 4. Test des fonctionnalités

#### Auto-Update
```javascript
// Forcer une vérification
window.RMBAutoUpdater.checkForUpdates();

// Vérifier le statut
console.log(window.RMBAutoUpdater.getStatus());
```

#### Data Merger
```javascript
// Obtenir les données fusionnées
window.RMBDataMerger.getMergedBrands().then(console.log);

// Statistiques de fusion
window.RMBDataMerger.getFusionStats().then(console.log);

// Recherche
window.RMBDataMerger.searchBrands('Nike').then(console.log);
```

## 🔧 Tests Unitaires API

### Configuration Jest

Créer `extension-api/tests/api.test.js` :

```javascript
const request = require('supertest');
const app = require('../server');

describe('Extension API', () => {
  test('Health check works', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('OK');
  });

  test('Version endpoint returns data', async () => {
    const res = await request(app).get('/api/brands/version');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('version');
    expect(res.body).toHaveProperty('checksum');
  });

  test('Updates endpoint validates parameters', async () => {
    const res = await request(app).get('/api/brands/updates');
    expect(res.statusCode).toBe(400);
  });

  test('Updates endpoint works with valid date', async () => {
    const since = new Date().toISOString();
    const res = await request(app).get(`/api/brands/updates?since=${since}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('hasUpdates');
  });
});
```

### Lancer les tests

```bash
npm test
```

## 📊 Tests de Performance

### 1. Test de charge avec Artillery

Installer artillery :
```bash
npm install -g artillery
```

Créer `load-test.yml` :
```yaml
config:
  target: 'http://localhost:3001'
  phases:
    - duration: 60
      arrivalRate: 10
scenarios:
  - name: "API Load Test"
    requests:
      - get:
          url: "/health"
      - get:
          url: "/api/brands/version"
      - get:
          url: "/api/brands/full"
```

Lancer :
```bash
artillery run load-test.yml
```

### 2. Test de cache

```bash
# Première requête (cache miss)
time curl http://localhost:3001/api/brands/version

# Deuxième requête (cache hit)
time curl http://localhost:3001/api/brands/version
```

## 🔒 Tests de Sécurité

### 1. Rate Limiting

```bash
# Tester le rate limiting (100 requêtes en 15min)
for i in {1..105}; do
  curl -w "%{http_code}\n" http://localhost:3001/api/brands/version
done
```

Doit retourner `429` après 100 requêtes.

### 2. CORS

```bash
# Test CORS depuis une extension
curl -H "Origin: chrome-extension://abc123" \
     http://localhost:3001/api/brands/version

# Test CORS depuis un site web (doit échouer)
curl -H "Origin: https://malicious-site.com" \
     http://localhost:3001/api/brands/version
```

### 3. Validation des paramètres

```bash
# Date invalide
curl "http://localhost:3001/api/brands/updates?since=invalid-date"
# Doit retourner 400

# SQL injection attempt
curl "http://localhost:3001/api/brands/updates?since='; DROP TABLE Marque; --"
# Doit être géré proprement
```

## 🐛 Debugging

### 1. Logs détaillés

Ajouter dans `server.js` :
```javascript
// Logs détaillés en développement
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`, {
      query: req.query,
      headers: req.headers,
      ip: req.ip
    });
    next();
  });
}
```

### 2. Test de la connexion Supabase

```javascript
// Dans la console Node.js
const { testConnection } = require('./config/supabase.js');
testConnection().then(console.log);
```

### 3. Debug de l'extension

```javascript
// Console du content script
console.log('Extension loaded:', {
  staticBrands: window.STATIC_BRANDS?.length,
  autoUpdater: !!window.RMBAutoUpdater,
  dataMerger: !!window.RMBDataMerger
});

// Force update et voir les logs
window.RMBAutoUpdater.forceUpdate();
```

## 📋 Checklist de Test Complet

### API ✅

- [ ] Health check répond
- [ ] Connexion Supabase établie
- [ ] Endpoint version fonctionne
- [ ] Endpoint updates avec paramètre valide
- [ ] Endpoint updates rejette paramètre invalide
- [ ] Endpoint full data fonctionne
- [ ] Rate limiting actif
- [ ] CORS configuré correctement
- [ ] Cache fonctionne (cache hit/miss)
- [ ] Gestion d'erreur propre
- [ ] Logs structurés

### Extension ✅

- [ ] AutoUpdater s'initialise
- [ ] DataMerger s'initialise
- [ ] Données statiques chargées
- [ ] Vérification version automatique
- [ ] Mise à jour forcée fonctionne
- [ ] Fusion des données
- [ ] Recherche dans les données
- [ ] Événements de mise à jour
- [ ] Fallback sur statique
- [ ] Compatibilité avec l'ancien code

### Intégration ✅

- [ ] Extension communique avec API
- [ ] Mises à jour automatiques
- [ ] Cache local de l'extension
- [ ] Gestion des erreurs réseau
- [ ] Fallback gracieux
- [ ] Performance acceptable
- [ ] Logs cohérents

## 🎯 Résultats Attendus

- **Temps de réponse** : < 200ms pour version, < 1s pour full data
- **Disponibilité** : 99.9%
- **Cache hit ratio** : > 80%
- **Extension fallback** : Toujours fonctionnelle même si API down
- **Mises à jour** : Détectées et appliquées en < 5 minutes