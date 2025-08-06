# 🚀 Guide de Déploiement - Extension API

Guide pour déployer l'API sur différentes plateformes cloud.

## 🎯 Prérequis

- Compte Supabase configuré avec les tables `Marque` et `Evenement`
- Variables d'environnement configurées
- Node.js 18+ en local pour les tests

## 🌐 Option 1: Vercel (Recommandé)

### Avantages
- ✅ Déploiement automatique via Git
- ✅ Edge functions pour la performance
- ✅ CDN global intégré
- ✅ Gratuit jusqu'à 100GB/mois

### Étapes de déploiement

1. **Connecter le repo à Vercel**
   ```bash
   npm i -g vercel
   vercel login
   vercel --cwd extension-api
   ```

2. **Configurer les variables d'environnement**
   Dans le dashboard Vercel :
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   NODE_ENV=production
   CACHE_TTL_SECONDS=3600
   ALLOWED_ORIGINS=chrome-extension://,moz-extension://
   ```

3. **Déployer**
   ```bash
   vercel --prod
   ```

4. **URL finale**
   ```
   https://extension-api-your-username.vercel.app
   ```

## 🚂 Option 2: Railway

### Avantages
- ✅ PostgreSQL intégré
- ✅ Déploiement Git automatique
- ✅ Logs en temps réel
- ✅ $5/mois pour commencer

### Étapes de déploiement

1. **Créer un projet Railway**
   ```bash
   npm i -g @railway/cli
   railway login
   railway init
   ```

2. **Configurer les variables**
   ```bash
   railway variables set SUPABASE_URL=https://your-project.supabase.co
   railway variables set SUPABASE_ANON_KEY=your-anon-key
   railway variables set NODE_ENV=production
   ```

3. **Déployer**
   ```bash
   railway up
   ```

## ☁️ Option 3: Google Cloud Run

### Avantages
- ✅ Scaling automatique
- ✅ Pay per use
- ✅ Très performant
- ✅ Gratuit jusqu'à 2M requêtes/mois

### Étapes de déploiement

1. **Créer Dockerfile**
   ```dockerfile
   FROM node:18-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci --only=production
   COPY . .
   EXPOSE 8080
   CMD ["npm", "start"]
   ```

2. **Build et deploy**
   ```bash
   gcloud builds submit --tag gcr.io/PROJECT-ID/extension-api
   gcloud run deploy --image gcr.io/PROJECT-ID/extension-api --platform managed
   ```

## 🐳 Option 4: Docker + VPS

### Avantages
- ✅ Contrôle total
- ✅ Pas de vendor lock-in
- ✅ Coût prévisible

### Docker Setup

1. **Créer Dockerfile**
   ```dockerfile
   FROM node:18-alpine

   # Sécurité
   RUN addgroup -g 1001 -S nodejs
   RUN adduser -S nodejs -u 1001

   WORKDIR /app

   # Dépendances
   COPY package*.json ./
   RUN npm ci --only=production && npm cache clean --force

   # Code source
   COPY --chown=nodejs:nodejs . .

   USER nodejs

   EXPOSE 3001

   CMD ["npm", "start"]
   ```

2. **docker-compose.yml**
   ```yaml
   version: '3.8'
   services:
     api:
       build: .
       ports:
         - "3001:3001"
       environment:
         - NODE_ENV=production
         - SUPABASE_URL=${SUPABASE_URL}
         - SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
       restart: unless-stopped
   ```

## 🔧 Configuration Post-Déploiement

### 1. Mise à jour de l'extension

Modifier `autoUpdater.js` avec la nouvelle URL :
```javascript
this.apiBaseUrl = 'https://your-deployed-api.com';
```

### 2. Test des endpoints

```bash
# Version
curl https://your-api.com/api/brands/version

# Santé
curl https://your-api.com/health

# Mises à jour
curl https://your-api.com/api/brands/updates?since=2024-01-01T00:00:00.000Z
```

### 3. Monitoring

Configurer des alertes pour :
- Disponibilité (uptime)
- Temps de réponse
- Erreurs 5xx
- Usage de la bande passante

## 🔒 Sécurité Production

### Variables d'environnement sécurisées
```env
NODE_ENV=production
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ... # Clé publique uniquement
CACHE_TTL_SECONDS=3600
ALLOWED_ORIGINS=chrome-extension://,moz-extension://
```

### Headers de sécurité
```javascript
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "*.supabase.co"]
    }
  }
}));
```

### Rate limiting production
```javascript
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requêtes par IP
  message: 'Trop de requêtes'
});
```

## 📊 Monitoring et Analytics

### 1. Logs structurés
```javascript
console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  level: 'info',
  message: 'API request',
  method: req.method,
  path: req.path,
  ip: req.ip
}));
```

### 2. Métriques Prometheus (optionnel)
```javascript
const promClient = require('prom-client');

const httpRequests = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'status']
});
```

### 3. Health checks
```javascript
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});
```

## 🔄 CI/CD Pipeline

### GitHub Actions exemple
```yaml
name: Deploy to Vercel
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm ci
      - run: npm test
      - uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.ORG_ID }}
          vercel-project-id: ${{ secrets.PROJECT_ID }}
```

## 🎯 Recommandation Final

**Pour ce projet, Vercel est recommandé** car :
- Gratuit pour la plupart des cas d'usage
- Déploiement automatique depuis Git
- Edge functions pour les performances globales
- Très simple à configurer
- CDN intégré pour la rapidité

URL finale typique : `https://extension-api-rmb.vercel.app`