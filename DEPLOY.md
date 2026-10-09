# 🚀 Guide de déploiement 237GO

## Architecture de déploiement

```
Railway (Backend)
├── API Node.js/Express
├── PostgreSQL (base de données managée)
├── WebSocket (Socket.IO)
└── Volume persistant (uploads : permis, CNI, photos)

Vercel (Admin Dashboard)
└── React/Vite (SPA, proxy /api → Railway)

Expo EAS (Application mobile)
└── Build APK Android (passagers, chauffeurs, marchands)
```

---

## Prérequis

- Le code est poussé sur un dépôt GitHub.
- Comptes créés : [Railway](https://railway.app), [Vercel](https://vercel.com), [Expo](https://expo.dev).

---

## Étape 1 : Déployer le Backend sur Railway

### 1.1 Créer le projet + PostgreSQL

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
2. Dans le projet, **+ New** → **Database** → **PostgreSQL**. Railway crée `DATABASE_URL` automatiquement.

### 1.2 Configurer le service backend

Comme c'est un **monorepo**, il faut indiquer le bon sous-dossier :

- Service → **Settings** → **Root Directory** : `apps/backend`
- Le build et le démarrage sont déjà définis dans `apps/backend/railway.json` :
  - **Build** : `npm install && npx prisma generate && npx tsc --skipLibCheck`
  - **Start** : `npx prisma migrate deploy && node dist/server.js`

> `prisma migrate deploy` applique automatiquement toutes les migrations à chaque déploiement.

### 1.3 Volume persistant pour les uploads

Les fichiers téléversés (permis, CNI, photos véhicule) doivent survivre aux redéploiements :

1. Service → **Settings** → **Volumes** → **+ New Volume**
2. Mount path : `/data`
3. Ajoute la variable d'environnement : `UPLOAD_PATH=/data/uploads`

Sans ce volume, les fichiers uploadés seront perdus à chaque redéploiement.

### 1.4 Variables d'environnement

Service → **Variables**, ajoute :

```
NODE_ENV=production
JWT_SECRET=<génère-un-secret-long-et-aléatoire>
JWT_EXPIRES_IN=7d
API_BASE_URL=https://<ton-backend>.up.railway.app
SOCKET_CORS_ORIGIN=https://<ton-admin>.vercel.app
UPLOAD_PATH=/data/uploads

# Paiement (à remplir quand tu auras les clés)
CINETPAY_API_KEY=
CINETPAY_SITE_ID=
MOMO_API_KEY=
MOMO_SUBSCRIPTION_KEY=
MOMO_BASE_URL=https://sandbox.momodeveloper.mtn.com
MOMO_ENVIRONMENT=sandbox
ORANGE_MONEY_CLIENT_ID=
ORANGE_MONEY_CLIENT_SECRET=
ORANGE_MONEY_MERCHANT_KEY=

# SMS (à remplir quand tu auras les clés)
SMS_PROVIDER=africas_talking
SMS_API_KEY=
SMS_SENDER_ID=237GO
AFRICAS_TALKING_USERNAME=sandbox
```

> ⚠️ Ne définis **pas** `PORT` manuellement : Railway l'injecte automatiquement.
> ⚠️ `DATABASE_URL` est ajouté automatiquement par Railway via le plugin PostgreSQL.

### 1.5 Seed initial (une seule fois)

Après le premier déploiement, crée le compte admin et les données de test :

```bash
npm install -g @railway/cli
railway login
railway link            # sélectionne ton projet
railway run --service <backend> npx prisma db seed
```

---

## Étape 2 : Déployer l'Admin sur Vercel

### 2.1 Importer le projet

1. [vercel.com](https://vercel.com) → **Add New Project** → importe le repo GitHub.
2. Configure :
   - **Root Directory** : `apps/admin`
   - **Framework Preset** : Vite
   - **Build Command** : `npm run build`
   - **Output Directory** : `dist`

### 2.2 Brancher l'admin sur le backend

Édite `apps/admin/vercel.json` et remplace `YOUR-RAILWAY-URL` par l'URL réelle de ton backend Railway :

```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "https://<ton-backend>.up.railway.app/api/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

Le client admin appelle `/api/...` ; Vercel relaie ces appels vers Railway. Redéploie après modification.

---

## Étape 3 : Builder l'application mobile (Expo EAS)

### 3.1 Pointer l'app vers le backend de production

Dans `apps/mobile/src/config/api.ts` et `apps/mobile/src/config/socket.ts`, l'URL de production est déjà prévue (`__DEV__ ? local : production`). Remplace l'URL de production par ton URL Railway :

```typescript
// api.ts
const API_BASE_URL = __DEV__ ? 'http://10.0.2.2:3002/api' : 'https://<ton-backend>.up.railway.app/api';
// socket.ts
const SOCKET_URL = __DEV__ ? 'http://10.0.2.2:3002' : 'https://<ton-backend>.up.railway.app';
```

### 3.2 Build de l'APK

```bash
npm install -g eas-cli
eas login
cd apps/mobile
eas build:configure
eas build -p android --profile preview   # génère un APK installable
```

Récupère le lien de téléchargement de l'APK à la fin du build.

> Les notifications push et l'upload d'images nécessitent un build réel (pas Expo Go).

---

## Étape 4 : Vérification

### Backend
```
GET https://<ton-backend>.up.railway.app/api/health
→ { "status": "ok", "service": "237GO API", "version": "1.0.0" }
```

### Admin
```
https://<ton-admin>.vercel.app/login
Admin : 600000000 / admin237go
```

### Mobile
Installe l'APK, connecte-toi avec un compte de test (`691234567` / `test237go`).

---

## Comptes de test (après seed)

| Rôle | Téléphone | Mot de passe |
|---|---|---|
| Admin | 600000000 | admin237go |
| Passager | 691234567 | test237go |
| Chauffeur | 698765432 | test237go |
| Marchand | 699887766 | test237go |

---

## Commandes utiles (Railway CLI)

```bash
railway logs                 # logs en temps réel
railway run npx prisma studio   # explorer la base
railway variables            # lister les variables
railway up                   # redéployer manuellement
```

---

## Checklist avant la vraie mise en production

- [ ] `JWT_SECRET` fort et unique (pas la valeur par défaut)
- [ ] `SOCKET_CORS_ORIGIN` restreint à l'URL de l'admin (pas `*`)
- [ ] Volume Railway monté + `UPLOAD_PATH` défini
- [ ] Clés API paiement réelles (CinetPay / MoMo / Orange)
- [ ] Clé SMS réelle (Africa's Talking ou Infobip)
- [ ] `MOMO_ENVIRONMENT=production` et URL MoMo de prod
- [ ] Migrations appliquées (`prisma migrate deploy` au démarrage — automatique)
- [ ] Build mobile EAS testé sur un vrai téléphone

---

## Coûts estimés (MVP)

| Service | Plan | Coût |
|---|---|---|
| Railway (Backend + PostgreSQL + volume) | Hobby | ~5 $/mois |
| Vercel (Admin) | Hobby | Gratuit |
| Expo EAS (builds) | Free tier | Gratuit (quota limité) |
| **Total MVP** | | **~5 $/mois** |
