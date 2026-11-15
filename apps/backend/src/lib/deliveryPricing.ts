/**
 * TARIF DES LIVRAISONS (XAF) — source UNIQUE pour les devis et les paiements.
 *
 * Règle : 1 000 F minimum pour toute livraison (le livreur touche au moins 850 F après la
 * commission de 15 %), qui couvre les 3 premiers km, puis +150 F par km. Arrondi aux 50 F.
 *   3 km → 1 000 F · 5 km → 1 300 F · 8 km → 1 750 F · 10 km → 2 050 F
 *
 * Colis (GO Deliver) : chaque type garde son tarif (gros et fragiles plus chers),
 * mais jamais moins que la règle ci-dessus.
 * (Avant : 300 F + 100 F/km pour les commandes de restaurant, soit 510 F pour le livreur à 3 km.)
 */
export const DELIVERY_MIN_FEE = 1000;
export const DELIVERY_INCLUDED_KM = 3;
export const DELIVERY_PER_KM = 150;

const roundUp50 = (x: number) => Math.ceil(x / 50) * 50;

/** Prix de base d'une livraison selon la distance (commandes GO Market, colis standards). */
export function baseDeliveryFee(distanceKm: number): number {
  const km = Math.max(0, Number.isFinite(distanceKm) ? distanceKm : 0);
  return roundUp50(DELIVERY_MIN_FEE + DELIVERY_PER_KM * Math.max(0, km - DELIVERY_INCLUDED_KM));
}

// Tarif propre à chaque type de colis (inchangé), plafonné par le bas par la règle commune
const PACKAGE_PRICING: Record<string, { base: number; perKm: number }> = {
  DOCUMENT: { base: 500, perKm: 100 },
  SMALL_PACKAGE: { base: 700, perKm: 150 },
  MEDIUM_PACKAGE: { base: 1000, perKm: 200 },
  LARGE_PACKAGE: { base: 1500, perKm: 300 },
  FOOD: { base: 500, perKm: 120 },
  FRAGILE: { base: 1200, perKm: 250 },
};

export const PACKAGE_TYPES = Object.keys(PACKAGE_PRICING);

/** Prix d'un colis : le plus élevé entre son tarif par type et le tarif minimum commun. */
export function packageDeliveryPrice(packageType: string, distanceKm: number): number {
  const p = PACKAGE_PRICING[packageType] || PACKAGE_PRICING.SMALL_PACKAGE;
  const byType = roundUp50(p.base + p.perKm * Math.max(0, distanceKm));
  return Math.max(byType, baseDeliveryFee(distanceKm));
}
