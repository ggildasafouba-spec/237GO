-- Alerte SOS rattachée à n'importe quel service (course, livraison, covoiturage, location)
ALTER TABLE "sos_alerts" ADD COLUMN "serviceType" TEXT;
ALTER TABLE "sos_alerts" ADD COLUMN "serviceId" TEXT;
