-- AlterTable : contact local (mandataire au Cameroun) pour les véhicules de la diaspora
ALTER TABLE "vehicles" ADD COLUMN     "localContactName" TEXT,
ADD COLUMN     "localContactPhone" TEXT;
