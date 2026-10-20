-- Généralise les notes : passage d'un modèle "1 note par course" à un modèle
-- générique et bidirectionnel (serviceType, serviceId, raterId).

-- 1) Ajouter les nouvelles colonnes en NULLABLE pour pouvoir remplir l'existant
ALTER TABLE "ratings" ADD COLUMN "serviceType" TEXT;
ALTER TABLE "ratings" ADD COLUMN "serviceId" TEXT;

-- 2) Backfill des lignes existantes : ce sont des notes de course (RIDE)
UPDATE "ratings" SET "serviceType" = 'RIDE', "serviceId" = "rideId" WHERE "rideId" IS NOT NULL;
-- Sécurité : si une ligne n'avait pas de rideId, on la rattache à son id
UPDATE "ratings" SET "serviceType" = 'RIDE', "serviceId" = "id" WHERE "serviceId" IS NULL;

-- 3) Rendre les colonnes obligatoires maintenant qu'elles sont remplies
ALTER TABLE "ratings" ALTER COLUMN "serviceType" SET NOT NULL;
ALTER TABLE "ratings" ALTER COLUMN "serviceId" SET NOT NULL;

-- 4) Retirer l'ancienne contrainte d'unicité sur rideId (un seul avis par course)
DROP INDEX IF EXISTS "ratings_rideId_key";

-- 5) Nouvelles contraintes : un avis par (service, prestation, évaluateur)
CREATE UNIQUE INDEX "ratings_serviceType_serviceId_raterId_key" ON "ratings"("serviceType", "serviceId", "raterId");
CREATE INDEX "ratings_ratedId_idx" ON "ratings"("ratedId");
CREATE INDEX "ratings_serviceType_serviceId_idx" ON "ratings"("serviceType", "serviceId");
