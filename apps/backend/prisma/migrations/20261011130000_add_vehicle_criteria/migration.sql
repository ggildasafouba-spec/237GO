-- AlterTable : critères et documents véhicule par catégorie
ALTER TABLE "driver_profiles" ADD COLUMN     "hasAirConditioning" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "registrationPhoto" TEXT,
ADD COLUMN     "insurancePhoto" TEXT,
ADD COLUMN     "insuranceExpiry" TIMESTAMP(3),
ADD COLUMN     "inspectionPhoto" TEXT,
ADD COLUMN     "inspectionExpiry" TIMESTAMP(3);
