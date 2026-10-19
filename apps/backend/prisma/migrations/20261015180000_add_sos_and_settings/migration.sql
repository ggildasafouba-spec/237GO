-- CreateEnum : statut d'une alerte SOS
CREATE TYPE "SosAlertStatus" AS ENUM ('ACTIVE', 'RESOLVED');

-- CreateTable : alertes SOS déclenchées par les utilisateurs
CREATE TABLE "sos_alerts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "rideId" TEXT,
    "status" "SosAlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sos_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sos_alerts_status_idx" ON "sos_alerts"("status");
CREATE INDEX "sos_alerts_userId_idx" ON "sos_alerts"("userId");

ALTER TABLE "sos_alerts" ADD CONSTRAINT "sos_alerts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable : paramètres de l'application (clé-valeur, valeur JSON)
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_settings_key_key" ON "app_settings"("key");
