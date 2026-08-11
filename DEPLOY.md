# 🚀 Guide de déploiement 237GO

## Architecture de déploiement

```
Railway (Backend)
├── API Node.js/Express (port 3000)
├── PostgreSQL (base de données)
└── WebSocket (Socket.IO)

Vercel (Admin Dashboard)
└── React/Vite (SPA)
```

---

## Étape 1 : Déployer le Backend sur Railway

### 1.1 Créer le projet

1. Va sur [railway.app](https://railway.app)
2. Clique **"New Project"**
3. Choisis **"Deploy from GitHub"** (ou "Empty Project")

### 1.2 Ajouter PostgreSQL

1. Dans ton projet Railway, clique **"+ New"** → **"Database"** → **"PostgreSQL"**
2. Railway crée automatiquement la base et la variable `DATABASE_URL`

### 1.3 Déployer le backend

**Option A — Depuis GitHub :**
1. Push le code sur GitHub
2. Dans Railway, ajoute un nouveau service → "GitHub Repo"
3. Sélectionne ton repo, et configure le root directory : `apps/backend`

**Option B — Depuis le CLI Railway :**
```bash
# Installer Railway CLI
npm install -g @railway/cli

# Se connecter
railway login

# Lier au projet
railway link

# Déployer
cd apps/backend
railway up
```

### 1.4 Variables d'environnement

Dans Railway → Service → Variables, ajoute :

```
PORT=3000
NODE_ENV=production
JWT_SECRET=ton-secret-ultra-securise-ici
JWT_EXPIRES_IN=7d
SOCKET_CORS_ORIGIN=https://ton-admin.vercel.app

# Paiement (optionnel pour le moment)
CINETPAY_API_KEY=
CINETPAY_SITE_ID=
MOMO_API_KEY=
MOMO_SUBSCRIPTION_KEY=

# SMS (optionnel pour le moment)
SMS_PROVIDER=africas_talking
SMS_API_KEY=
SMS_SENDER_ID=237GO
```

> ⚠️ `DATABASE_URL` est ajouté automatiquement par Railway quand tu lies PostgreSQL.

### 1.5 Seed la base de données

```bash
# Via Railway CLI
railway run npx prisma db seed
```

Ou dans Railway → Service → Settings → Deploy → ajouter en "Release Command" :
```
npx prisma migrate deploy && npx prisma db seed
```

---

## Étape 2 : Déployer l'Admin sur Vercel

### 2.1 Configuration

1. Va sur [vercel.com](https://vercel.com)
2. Clique **"Add New Project"**
3. Importe depuis GitHub
4. Configure :
   - **Framework** : Vite
   - **Root Directory** : `apps/admin`
   - **Build Command** : `npm run build`
   - **Output Directory** : `dist`

### 2.2 Variable d'environnement

Ajoute sur Vercel :
```
VITE_API_URL=https://ton-backend.up.railway.app
```

### 2.3 Mettre à jour vercel.json

Après le déploiement Railway, récupère l'URL de ton backend (ex: `https://237go-api-production.up.railway.app`) et mets à jour le fichier `apps/admin/vercel.json` :

Remplace `YOUR-RAILWAY-URL` par ton URL Railway réelle.

---

## Étape 3 : Vérification

### Tester le backend
```
https://ton-backend.up.railway.app/api/health
```

Réponse attendue :
```json
{
  "status": "ok",
  "service": "237GO API",
  "version": "1.0.0"
}
```

### Tester l'admin
```
https://ton-admin.vercel.app/login
```

Credentials de test :
- Téléphone : `600000000`
- Mot de passe : `admin237go`

---

## Étape 4 : Connecter l'app mobile

Dans `apps/mobile/src/config/api.ts`, remplace l'URL de production :

```typescript
const API_BASE_URL = __DEV__
  ? 'http://10.0.2.2:3000/api'
  : 'https://ton-backend.up.railway.app/api';
```

Même chose dans `apps/mobile/src/config/socket.ts` :
```typescript
const SOCKET_URL = __DEV__
  ? 'http://10.0.2.2:3000'
  : 'https://ton-backend.up.railway.app';
```

---

## Commandes utiles

```bash
# Voir les logs Railway
railway logs

# Ouvrir la base en local
railway connect postgres

# Redéployer
railway up

# Variables d'environnement
railway variables
```

---

## Après le déploiement

1. ✅ Tester `/api/health`
2. ✅ Tester la connexion admin
3. ✅ Tester l'inscription d'un utilisateur via API
4. ✅ Configurer les clés API de paiement quand tu les auras
5. ✅ Builder l'app mobile avec Expo et tester sur un vrai téléphone

---

## Coûts estimés

| Service | Plan | Coût |
|---------|------|------|
| Railway (Backend + PostgreSQL) | Starter | ~5$/mois |
| Vercel (Admin) | Hobby | Gratuit |
| Domaine .cm | Registrar | ~15$/an |
| **Total MVP** | | **~5$/mois** |
