-- Version des sessions : permet d'invalider tous les jetons de connexion d'un compte.
-- Valeur 0 par défaut : les jetons déjà émis (sans version) restent valides.
ALTER TABLE "users" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
