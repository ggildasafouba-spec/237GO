# 237GO — Super-app de mobilité camerounaise 🇨🇲

> *"On bouge ensemble"*

## 🎯 Concept

237GO est une plateforme tout-en-un de mobilité, livraison et commerce pensée pour le Cameroun. Notre objectif : offrir plus que du transport, en intégrant les réalités locales (Mobile Money, mode faible connexion, langues locales).

## 🚀 Services

| Service | Description | Phase |
|---------|------------|-------|
| **GO Ride** | Transport à la demande (moto, taxi, VIP) | 1 |
| **GO Deliver** | Livraison de colis, repas, documents | 1 |
| **GO Market** | Commandes depuis les marchés locaux | 2 |
| **GO Share** | Covoiturage inter-villes | 2 |
| **GO Rent** | Location de véhicules | 3 |
| **GO Business** | Solutions entreprises | 3 |
| **GO Fleet** | Mise en location par les propriétaires | 3 |

## 💎 Valeurs ajoutées vs Yango

1. **Paiement 100% local** : Orange Money, MTN MoMo, Express Union, Cash
2. **Mode faible connexion** : fonctionne en 2G/3G, interface légère
3. **Tarification transparente** : prix fixe + possibilité de négocier
4. **Programme fidélité** : passagers ET chauffeurs récompensés
5. **Multilingue** : Français, Anglais, Pidgin
6. **Sécurité** : SOS, partage de trajet, vérification CNI
7. **GO Market** : le marché livré à domicile (unique !)
8. **Covoiturage inter-villes** : Douala ↔ Yaoundé à petit prix
9. **Programme chauffeur premium** : micro-crédit, assurance, formation
10. **API Entreprises** : dashboard, facturation, analytics

## 🛠️ Stack technique

- **Mobile** : React Native (Expo)
- **Backend** : Node.js + Express + TypeScript
- **Base de données** : PostgreSQL + Prisma ORM
- **Temps réel** : Socket.IO
- **Maps** : OpenStreetMap
- **Paiement** : CinetPay / MoMo API / Orange Money API

## 📁 Structure du projet

```
237go/
├── apps/
│   ├── backend/          # API Node.js/Express
│   │   ├── prisma/       # Schéma et migrations DB
│   │   └── src/
│   │       ├── middleware/
│   │       ├── routes/
│   │       └── socket/
│   └── mobile/           # App React Native (Expo)
│       └── src/
│           ├── config/
│           ├── navigation/
│           ├── screens/
│           ├── store/
│           └── theme/
├── packages/             # Packages partagés (à venir)
└── package.json          # Monorepo config
```

## 🚀 Démarrage rapide

### Backend

```bash
cd apps/backend
cp .env.example .env
npm install
npx prisma migrate dev
npm run dev
```

### Mobile

```bash
cd apps/mobile
npm install
npx expo start
```

## 📱 Identité visuelle

- **Couleurs** : Vert foncé (#1B5E20) + Or (#FFB300)
- **Slogan** : "237GO — On bouge ensemble"
- **Esprit** : local, accessible, fier, moderne

## 📋 Roadmap

- [x] Phase 1 : GO Ride + GO Deliver (MVP)
- [x] Phase 2 : GO Market + GO Share
- [x] Phase 3 : GO Rent + GO Business + GO Fleet
- [ ] Intégration réelle Mobile Money
- [ ] Mode USSD/SMS pour utilisateurs sans smartphone
- [ ] Programme de parrainage
- [ ] Interface admin dashboard web
- [ ] Tests et déploiement production

## 📄 Licence

Propriétaire — Tous droits réservés.
