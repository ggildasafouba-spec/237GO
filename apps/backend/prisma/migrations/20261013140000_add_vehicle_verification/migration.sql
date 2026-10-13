-- AlterTable : vérification et documents des véhicules de location (GO Rent)
ALTER TABLE "vehicles" ADD COLUMN     "vehiclePhoto" TEXT,
ADD COLUMN     "registrationPhoto" TEXT,
ADD COLUMN     "insurancePhoto" TEXT,
ADD COLUMN     "ownerIdPhoto" TEXT,
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "rejectionReason" TEXT;
