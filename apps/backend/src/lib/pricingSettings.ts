/**
 * TARIFS DES COURSES ET COMMISSION : source UNIQUE, réglable depuis l'admin (Paramètres).
 *
 * Avant : les tarifs étaient écrits en dur dans ride.routes.ts (deux fois) et la commission
 * (15 %) dans quatre fichiers. La page « Paramètres » de l'admin enregistrait des valeurs que
 * le serveur ne lisait jamais.
 *
 * Maintenant : tout passe par ce fichier. Les réglages sont lus dans la table AppSetting
 * (clé « pricingV2 »), gardés 30 s en mémoire, avec repli sur les valeurs par défaut si la
 * base ne répond pas : un incident de base ne doit jamais empêcher de calculer un prix.
 * (L'ancienne clé « pricing » n'est volontairement plus lue : elle vient d'une page qui n'avait
 * aucun effet, et ses anciennes valeurs auraient écrasé les nouveaux tarifs.)
 *
 * FORMULE (même principe que Yango) :
 *   prix = prix minimum
 *        + tarif au km     × (distance  − km inclus dans le minimum)
 *        + tarif à la min  × (durée     − minutes incluses dans le minimum)
 * arrondi aux 10 F supérieurs.
 *
 * Valeurs par défaut Moto et Éco : tarifs maximums publiés par Yango à Douala (kilomètres et
 * minutes inclus, tarif au km, tarif à la minute), avec un prix minimum inférieur de 30 F :
 *   Éco  : Yango 430 F -> 237GO 400 F      Moto : Yango 260 F -> 230 F
 */
import { prisma } from './prisma';

export type RideVehicleType = 'MOTO' | 'CAR_ECONOMY' | 'CAR_COMFORT' | 'CAR_VIP';
export const RIDE_VEHICLE_TYPES: RideVehicleType[] = ['MOTO', 'CAR_ECONOMY', 'CAR_COMFORT', 'CAR_VIP'];

export interface VehicleTariff {
  /** Prix minimum d'une course (XAF). Couvre les km et minutes « inclus ». */
  minFare: number;
  /** Kilomètres compris dans le prix minimum. */
  includedKm: number;
  /** Minutes comprises dans le prix minimum. */
  includedMin: number;
  /** XAF par km au-delà des km inclus. */
  perKm: number;
  /** XAF par minute au-delà des minutes incluses. */
  perMin: number;
}

export type RideTariffs = Record<RideVehicleType, VehicleTariff>;

export interface PricingSettings {
  tariffs: RideTariffs;
  /** Commission 237GO en pourcentage du prix (10 = 10 %). */
  commissionPercent: number;
  // Réglages affichés dans l'admin mais pas encore appliqués par le serveur :
  loyaltyPointsPerXAF: number;
  bonusRechargeThreshold: number;
  bonusRechargePercent: number;
}

export const DEFAULT_PRICING: PricingSettings = {
  tariffs: {
    MOTO: { minFare: 230, includedKm: 1.5, includedMin: 4, perKm: 59, perMin: 11 },
    CAR_ECONOMY: { minFare: 400, includedKm: 1.8, includedMin: 5, perKm: 90, perMin: 25 },
    // Confort et VIP : mêmes tarifs qu'avant (prix de base + km + minutes, rien d'inclus)
    CAR_COMFORT: { minFare: 1000, includedKm: 0, includedMin: 0, perKm: 450, perMin: 35 },
    CAR_VIP: { minFare: 2000, includedKm: 0, includedMin: 0, perKm: 700, perMin: 50 },
  },
  commissionPercent: 10,
  loyaltyPointsPerXAF: 100,
  bonusRechargeThreshold: 5000,
  bonusRechargePercent: 5,
};

/** Durée estimée : 3 minutes par km (inchangé). */
export function estimateDurationMin(distanceKm: number): number {
  return Math.ceil(distanceKm * 3);
}

/** Arrondi aux 10 F supérieurs (sans erreur de virgule flottante). */
function roundUpTo10(value: number): number {
  return Math.ceil(Math.round(value * 100) / 100 / 10) * 10;
}

/** Prix d'une course pour un tarif donné. */
export function computeRidePrice(tariff: VehicleTariff, distanceKm: number, durationMin: number): number {
  const extraKm = Math.max(0, distanceKm - tariff.includedKm);
  const extraMin = Math.max(0, durationMin - tariff.includedMin);
  const raw = tariff.minFare + tariff.perKm * extraKm + tariff.perMin * extraMin;
  return roundUpTo10(raw);
}

// ---------- Lecture / écriture des réglages ----------

const SETTINGS_KEY = 'pricingV2';
const CACHE_TTL_MS = 30_000;
let cache: { at: number; value: PricingSettings } | null = null;

const num = (v: unknown, fallback: number, min = 0): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback;

/** Fusionne une valeur enregistrée avec les valeurs par défaut (champ invalide = défaut). */
function withDefaults(raw: unknown): PricingSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const tariffs = {} as RideTariffs;
  for (const type of RIDE_VEHICLE_TYPES) {
    const d = DEFAULT_PRICING.tariffs[type];
    const t = (r.tariffs && typeof r.tariffs === 'object' ? r.tariffs[type] : null) || {};
    tariffs[type] = {
      minFare: num(t.minFare, d.minFare),
      includedKm: num(t.includedKm, d.includedKm),
      includedMin: num(t.includedMin, d.includedMin),
      perKm: num(t.perKm, d.perKm),
      perMin: num(t.perMin, d.perMin),
    };
  }
  return {
    tariffs,
    commissionPercent: Math.min(num(r.commissionPercent, DEFAULT_PRICING.commissionPercent), 50),
    loyaltyPointsPerXAF: num(r.loyaltyPointsPerXAF, DEFAULT_PRICING.loyaltyPointsPerXAF),
    bonusRechargeThreshold: num(r.bonusRechargeThreshold, DEFAULT_PRICING.bonusRechargeThreshold),
    bonusRechargePercent: num(r.bonusRechargePercent, DEFAULT_PRICING.bonusRechargePercent),
  };
}

export async function getPricingSettings(): Promise<PricingSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
    const value = withDefaults(row?.value);
    cache = { at: Date.now(), value };
    return value;
  } catch (e) {
    console.error('Lecture des réglages de tarification impossible, valeurs en mémoire/défaut utilisées:', (e as Error).message);
    return cache?.value ?? DEFAULT_PRICING;
  }
}

/** Commission 237GO sous forme de fraction (0.10 pour 10 %). */
export async function getCommissionRate(): Promise<number> {
  return (await getPricingSettings()).commissionPercent / 100;
}

export function invalidatePricingCache(): void {
  cache = null;
}

// Plages acceptées à l'enregistrement : empêchent une faute de frappe (ex. 100000 F le km).
const LIMITS: Record<keyof VehicleTariff, { min: number; max: number; label: string }> = {
  minFare: { min: 0, max: 100_000, label: 'Prix minimum' },
  includedKm: { min: 0, max: 100, label: 'Km inclus' },
  includedMin: { min: 0, max: 600, label: 'Minutes incluses' },
  perKm: { min: 0, max: 10_000, label: 'Tarif au km' },
  perMin: { min: 0, max: 1_000, label: 'Tarif à la minute' },
};
const TYPE_LABELS: Record<RideVehicleType, string> = {
  MOTO: 'Moto', CAR_ECONOMY: 'Économique', CAR_COMFORT: 'Confort', CAR_VIP: 'VIP',
};

/** Valide ce que l'admin envoie. Renvoie le réglage nettoyé ou un message d'erreur lisible. */
export function validatePricingInput(input: unknown): { value?: PricingSettings; error?: string } {
  const r = input as Record<string, any> | null;
  if (!r || typeof r !== 'object' || !r.tariffs || typeof r.tariffs !== 'object') {
    return { error: 'Tarifs manquants' };
  }
  const value = withDefaults({});
  for (const type of RIDE_VEHICLE_TYPES) {
    const t = r.tariffs[type];
    if (!t || typeof t !== 'object') return { error: `Tarif ${TYPE_LABELS[type]} manquant` };
    for (const field of Object.keys(LIMITS) as (keyof VehicleTariff)[]) {
      const v = Number(t[field]);
      const { min, max, label } = LIMITS[field];
      if (!Number.isFinite(v) || v < min || v > max) {
        return { error: `${TYPE_LABELS[type]} : « ${label} » doit être entre ${min} et ${max}` };
      }
      value.tariffs[type][field] = v;
    }
  }
  const commission = Number(r.commissionPercent);
  if (!Number.isFinite(commission) || commission < 0 || commission > 50) {
    return { error: 'La commission doit être entre 0 et 50 %' };
  }
  value.commissionPercent = commission;
  value.loyaltyPointsPerXAF = num(Number(r.loyaltyPointsPerXAF), DEFAULT_PRICING.loyaltyPointsPerXAF);
  value.bonusRechargeThreshold = num(Number(r.bonusRechargeThreshold), DEFAULT_PRICING.bonusRechargeThreshold);
  value.bonusRechargePercent = num(Number(r.bonusRechargePercent), DEFAULT_PRICING.bonusRechargePercent);
  return { value };
}

export async function savePricingSettings(value: PricingSettings): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: value as any },
    update: { value: value as any },
  });
  invalidatePricingCache();
}
