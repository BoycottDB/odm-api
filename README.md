# odm-api

API en lecture seule de **Qui j'enrichis ?**, sous forme de Netlify Functions. Elle sert les données publiques (marques, controverses, chaînes de bénéficiaires) au site [odm-web](https://github.com/BoycottDB/odm-web) et à l'extension navigateur, avec du cache pour limiter les appels à Supabase.

Les écritures (signalements, administration) ne passent pas par ici : odm-web les envoie directement à Supabase, côté serveur.

## Architecture

```
Supabase (PostgreSQL, RLS : lecture seule pour le rôle anon)
   ↑ clé anon
odm-api (Netlify Functions)
   ├─ cache en mémoire par fonction (utils/serverlessCache.js)
   └─ cache CDN Netlify (en-têtes Cache-Control, s-maxage)
   ↑ HTTPS
odm-web (Next.js, via DataService)  ·  odm-extension (service worker)
```

- **Une fonction par point d'accès**, dans `netlify/functions/`.
- **Clé anon uniquement** : l'API ne peut que lire. Les politiques RLS de Supabase n'autorisent que `SELECT` sur les tables publiques.
- **Deux niveaux de cache** : un cache en mémoire, perdu quand Netlify recycle la fonction, et le CDN, qui sert les réponses sans réveiller la fonction.
- **Chaîne de bénéficiaires** : `utils/marquesTransitives.js` remonte récursivement les relations entre bénéficiaires (par exemple, voir les marques de L'Oréal depuis BlackRock via Nestlé), avec une protection contre les cycles.
- **Erreurs** : suivies avec Sentry (`utils/sentry.js`).

## Points d'accès

On les appelle par `https://odm-api.netlify.app/.netlify/functions/<nom>`. Certains ont aussi un alias `/api/...` défini dans `netlify.toml`.

| Fonction | Paramètres | Renvoie | Utilisée par |
|---|---|---|---|
| `marques` | `search`, `limit`, `offset` | Marques avec leurs controverses et bénéficiaires | site, extension |
| `marque-by-slug` | `slug` (requis) | Une marque complète : controverses, chaîne de bénéficiaires, conseils | page `/marques/[slug]` |
| `marques-slugs` | — | Liste des slugs, pour la génération statique | site |
| `marques-stats` | — | Statistiques de la page `/marques` | site |
| `marques-noms` | — | `id` + `nom` de toutes les marques, filtrés dans le navigateur | barre de recherche |
| `evenements` | `limit`, `offset` | Controverses, les plus récentes d'abord | site |
| `categories` | — | Catégories de controverses | site |
| `secteurs-marque` | `id` (facultatif) | Secteurs d'activité | site |
| `health` | — | État de l'API et de la connexion Supabase | admin |

Cache CDN de 10 à 20 minutes sur `marques`, `marque-by-slug`, `marques-slugs`, `marques-stats` et `marques-noms`. Les autres fonctions n'ont que le cache en mémoire, de 5 minutes à 1 heure selon la fonction (`UNIFIED_TTL` dans [serverlessCache.js](netlify/functions/utils/serverlessCache.js), ou constante `CACHE_TTL` en tête de fichier).

## Développement

```bash
npm install
cp .env.example .env    # SUPABASE_URL, SUPABASE_ANON_KEY
netlify dev             # http://localhost:8888
```

Pour faire pointer odm-web sur l'API locale : `NEXT_PUBLIC_EXTENSION_API_URL=http://localhost:8888`.

Déploiement : automatique sur Netlify à chaque push sur `main`.

## Licence

[AGPL-3.0](LICENSE)
