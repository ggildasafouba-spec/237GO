-- AlterTable : vérification et documents des marchands (GO Market)
ALTER TABLE "merchant_profiles" ADD COLUMN     "ownerIdPhoto" TEXT,
ADD COLUMN     "shopPhoto" TEXT,
ADD COLUMN     "businessRegPhoto" TEXT,
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "rejectionReason" TEXT;
