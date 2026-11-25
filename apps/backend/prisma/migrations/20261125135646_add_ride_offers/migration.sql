-- CreateEnum
CREATE TYPE "RideOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ride_offers" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "status" "RideOfferStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ride_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ride_offers_rideId_status_idx" ON "ride_offers"("rideId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ride_offers_rideId_driverId_key" ON "ride_offers"("rideId", "driverId");

-- AddForeignKey
ALTER TABLE "ride_offers" ADD CONSTRAINT "ride_offers_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_offers" ADD CONSTRAINT "ride_offers_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
