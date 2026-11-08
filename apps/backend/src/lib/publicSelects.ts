/**
 * CHAMPS AUTORISÉS dans les réponses de l'API.
 *
 * Avant, plusieurs routes renvoyaient des objets complets (Prisma `include` sans `select`),
 * ce qui exposait :
 *  - le mot de passe chiffré et le code de réinitialisation d'un CHAUFFEUR au PASSAGER
 *    (acceptation de course) : un passager pouvait réutiliser ce code pour prendre le compte ;
 *  - la CNI, le permis et leurs photos du chauffeur ;
 *  - la pièce d'identité et le registre de commerce des MARCHANDS à tous les clients ;
 *  - les documents des VÉHICULES (CNI du propriétaire, carte grise, assurance) à tous.
 *
 * Règle : toute donnée renvoyée à quelqu'un d'autre que son propriétaire passe par ces listes.
 * Ces listes réduisent aussi le volume lu et transmis, donc le coût de chaque requête.
 */

// Ce qu'un autre utilisateur peut voir d'une personne (chauffeur, marchand, propriétaire...)
export const PUBLIC_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatar: true,
} as const;

// Ce que le passager voit du chauffeur : le véhicule et la réputation, jamais les documents
export const PUBLIC_DRIVER_PROFILE_SELECT = {
  vehicleType: true,
  vehiclePlate: true,
  vehicleBrand: true,
  vehicleModel: true,
  vehicleYear: true,
  hasAirConditioning: true,
  vehiclePhoto: true,
  averageRating: true,
  totalTrips: true,
} as const;

// Ce que les clients voient d'une boutique : jamais les documents d'identité du gérant
export const PUBLIC_MERCHANT_SELECT = {
  id: true,
  shopName: true,
  shopAddress: true,
  shopLat: true,
  shopLng: true,
  category: true,
  description: true,
  isOpen: true,
  openingHours: true,
  shopPhoto: true,
  createdAt: true,
} as const;

// Ce que les locataires voient d'un véhicule : jamais les documents ni le mandataire
// (le contact du mandataire n'est utile qu'après réservation).
export const PUBLIC_VEHICLE_SELECT = {
  id: true,
  ownerId: true,
  type: true,
  brand: true,
  model: true,
  year: true,
  plate: true,
  color: true,
  seats: true,
  images: true,
  pricePerDay: true,
  pricePerHour: true,
  currency: true,
  withDriver: true,
  isAvailable: true,
  locationLat: true,
  locationLng: true,
  locationAddress: true,
  vehiclePhoto: true,
  verificationStatus: true,
  createdAt: true,
} as const;

// Ce que l'utilisateur reçoit sur LUI-MÊME : tout sauf les secrets
// (mot de passe chiffré, code de réinitialisation et son expiration).
export const SELF_USER_SELECT = {
  id: true,
  phone: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  avatar: true,
  language: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;
