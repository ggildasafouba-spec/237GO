-- Acceptation des CGU et suppression de compte par l'utilisateur
ALTER TABLE "users" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "termsVersion" TEXT;
ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);
