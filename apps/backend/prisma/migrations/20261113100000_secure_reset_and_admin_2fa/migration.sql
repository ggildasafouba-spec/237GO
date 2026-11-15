-- Mot de passe oublié : le code est désormais stocké sous forme d'empreinte et limité à 5 essais.
-- Les anciens codes en clair (au plus 10 minutes de validité) deviennent inutilisables : on les efface.
ALTER TABLE "users" ADD COLUMN "resetOtpAttempts" INTEGER NOT NULL DEFAULT 0;
UPDATE "users" SET "resetOtp" = NULL, "resetOtpExpiry" = NULL WHERE "resetOtp" IS NOT NULL;

-- Double vérification de l'administrateur (code par email)
ALTER TABLE "users" ADD COLUMN "twoFaCode" TEXT;
ALTER TABLE "users" ADD COLUMN "twoFaExpiry" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "twoFaAttempts" INTEGER NOT NULL DEFAULT 0;
