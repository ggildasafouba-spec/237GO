-- Livraison des commandes GO Market par les chauffeurs 237GO :
-- une livraison peut être rattachée à (au plus) une commande.
ALTER TABLE "deliveries" ADD COLUMN "marketOrderId" TEXT;
CREATE UNIQUE INDEX "deliveries_marketOrderId_key" ON "deliveries"("marketOrderId");
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_marketOrderId_fkey"
  FOREIGN KEY ("marketOrderId") REFERENCES "market_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
