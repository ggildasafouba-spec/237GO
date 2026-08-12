#!/bin/sh
echo "🔄 Synchronisation de la base de données..."
npx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "⚠️ Migration ignorée"
echo "🚀 Démarrage du serveur 237GO..."
exec node dist/server.js
