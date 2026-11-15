-- Date du dernier changement de mot de passe : les retraits sont bloqués 24 h ensuite
-- (si un pirate prend un compte, il ne peut pas vider le portefeuille tout de suite).
ALTER TABLE "users" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
