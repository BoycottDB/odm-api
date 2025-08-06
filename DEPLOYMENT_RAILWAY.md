# 🚂 Déploiement Railway - Extension API

## Pourquoi Railway au lieu de Vercel ?

**Vercel** active automatiquement une protection d'accès quand il détecte des variables d'environnement sensibles (comme `SUPABASE_ANON_KEY`), ce qui rend l'API inaccessible publiquement.

**Railway** est plus adapté pour des APIs publiques avec des secrets.

## 🚀 Étapes de déploiement

### 1. Créer un compte Railway
- Allez sur https://railway.app
- Connectez-vous avec GitHub

### 2. Déployer le projet
```bash
# Installer Railway CLI
npm install -g @railway/cli

# Se connecter
railway login

# Initialiser le projet
railway init

# Choisir "Deploy from GitHub repo" et sélectionner votre repo
```

### 3. Configurer les variables d'environnement
Dans le dashboard Railway :
```
SUPABASE_URL=https://iopnspedzkazjpytfygl.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
NODE_ENV=production
PORT=3001
```

### 4. Déployer
```bash
railway up
```

## 📋 Configuration automatique

Le projet contient déjà :
- ✅ `railway.json` - Configuration Railway
- ✅ `Dockerfile` - Pour le déploiement conteneurisé  
- ✅ `server.js` - Serveur Express (pas serverless)
- ✅ Health check sur `/health`

## 🎯 URL finale
Railway vous donnera une URL comme :
`https://extension-api-production.up.railway.app`

## 🧪 Tests après déploiement
```bash
# Health check
curl https://votre-url.railway.app/health

# Version API  
curl https://votre-url.railway.app/api/brands/version

# Données complètes
curl https://votre-url.railway.app/api/brands/full
```

## 💰 Coût Railway
- **Gratuit** : $5 de crédit/mois (largement suffisant)
- **Pay-as-you-go** après épuisement des crédits
- Plus prévisible que Vercel pour ce cas d'usage

## 🔧 Avantages Railway vs Vercel

| Feature | Railway | Vercel |
|---------|---------|--------|
| API publique avec secrets | ✅ | ❌ (protection forcée) |
| Express.js natif | ✅ | ❌ (serverless uniquement) |
| Variables d'env simples | ✅ | ⚠️ (complexe) |
| Logs en temps réel | ✅ | ⚠️ (limité) |
| Deploy simple | ✅ | ⚠️ (config complexe) |

**Railway est le choix optimal pour cette API !** 🎯