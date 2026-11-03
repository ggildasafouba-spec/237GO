-- AlterTable: ajouter le nombre de passagers et la taille des bagages sur les courses
ALTER TABLE "rides" ADD COLUMN "passengerCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "rides" ADD COLUMN "luggageSize" TEXT;
