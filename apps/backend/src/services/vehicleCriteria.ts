/**
 * Critères d'éligibilité des véhicules par catégorie sur 237GO.
 * Adaptés au parc automobile camerounais.
 *
 * Source unique de vérité : utilisé pour la validation backend ET exposé
 * à l'app mobile (endpoint) pour afficher les exigences au chauffeur.
 */

export type VehicleCategory = 'MOTO' | 'CAR_ECONOMY' | 'CAR_COMFORT' | 'CAR_VIP' | 'TRUCK';

export interface CategoryCriteria {
  type: VehicleCategory;
  label: string;
  icon: string;
  minYear: number | null;        // année minimale du véhicule (null = sans objet)
  airConditioning: boolean;      // climatisation obligatoire ?
  examples: string;
  requirements: string[];        // exigences affichées à l'utilisateur
}

const CURRENT_YEAR = new Date().getFullYear();

export const VEHICLE_CRITERIA: Record<VehicleCategory, CategoryCriteria> = {
  MOTO: {
    type: 'MOTO',
    label: 'Moto',
    icon: '🏍️',
    minYear: null,
    airConditioning: false,
    examples: 'Honda, Yamaha…',
    requirements: [
      'Moto en bon état de marche',
      'Casque passager obligatoire',
      'Permis de conduire valide',
      'CNI valide',
    ],
  },
  CAR_ECONOMY: {
    type: 'CAR_ECONOMY',
    label: 'Éco',
    icon: '🚗',
    minYear: 2008,
    airConditioning: false,
    examples: 'Toyota Corolla, Hyundai Accent…',
    requirements: [
      'Berline/compacte 4 portes',
      'Année 2008 ou plus récente',
      'Véhicule propre et fonctionnel',
      'Permis, CNI, carte grise, assurance et visite technique à jour',
    ],
  },
  CAR_COMFORT: {
    type: 'CAR_COMFORT',
    label: 'Confort',
    icon: '🚙',
    minYear: 2014,
    airConditioning: true,
    examples: 'Toyota Camry, Hyundai Elantra…',
    requirements: [
      'Berline récente en bon état',
      'Année 2014 ou plus récente',
      'Climatisation obligatoire',
      'Permis, CNI, carte grise, assurance et visite technique à jour',
    ],
  },
  CAR_VIP: {
    type: 'CAR_VIP',
    label: 'VIP',
    icon: '✨',
    minYear: 2018,
    airConditioning: true,
    examples: 'Mercedes, Toyota Prado, Lexus…',
    requirements: [
      'Véhicule haut de gamme',
      'Année 2018 ou plus récente',
      'Climatisation + intérieur premium',
      'Chauffeur en tenue correcte',
      'Permis, CNI, carte grise, assurance et visite technique à jour',
    ],
  },
  TRUCK: {
    type: 'TRUCK',
    label: 'Camion / Utilitaire',
    icon: '🚚',
    minYear: 2005,
    airConditioning: false,
    examples: 'Camionnettes, fourgons…',
    requirements: [
      'Véhicule utilitaire en bon état',
      'Permis adapté, CNI, carte grise, assurance et visite technique à jour',
    ],
  },
};

export interface VehicleValidationInput {
  vehicleType: VehicleCategory;
  vehicleYear?: number | null;
  hasAirConditioning?: boolean;
}

export interface VehicleValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Vérifie qu'un véhicule respecte les critères de la catégorie demandée.
 */
export function validateVehicleForCategory(input: VehicleValidationInput): VehicleValidationResult {
  const criteria = VEHICLE_CRITERIA[input.vehicleType];
  const errors: string[] = [];

  if (!criteria) {
    return { valid: false, errors: ['Catégorie de véhicule inconnue'] };
  }

  // Vérification de l'année
  if (criteria.minYear !== null) {
    const year = input.vehicleYear;
    if (!year) {
      errors.push(`L'année du véhicule est requise pour la catégorie ${criteria.label}.`);
    } else if (year < criteria.minYear) {
      errors.push(
        `Pour la catégorie ${criteria.label}, le véhicule doit dater de ${criteria.minYear} ou plus récent (année fournie : ${year}).`
      );
    } else if (year > CURRENT_YEAR + 1) {
      errors.push(`L'année du véhicule (${year}) est invalide.`);
    }
  }

  // Vérification de la climatisation
  if (criteria.airConditioning && !input.hasAirConditioning) {
    errors.push(`La climatisation est obligatoire pour la catégorie ${criteria.label}.`);
  }

  return { valid: errors.length === 0, errors };
}
