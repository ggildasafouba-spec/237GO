import { create } from 'zustand';
import api from '../config/api';
import { getSocket } from '../config/socket';

interface Location {
  lat: number;
  lng: number;
  address: string;
}

interface RideEstimate {
  distance: number;
  duration: number;
  estimatedPrice: number;
  currency: string;
  vehicleType: string;
}

// Offre d'un chauffeur (contre-proposition de prix) pour une course en attente
export interface RideOffer {
  id: string;
  price: number;
  distanceToPickup?: number | null;
  etaMin?: number | null;
  driver: {
    id: string;
    firstName: string;
    lastName: string;
    vehicleBrand?: string | null;
    vehicleModel?: string | null;
    vehiclePlate?: string | null;
    averageRating?: number | null;
    totalTrips?: number | null;
  };
}

interface Ride {
  id: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  estimatedPrice: number;
  /** Prix proposé par le passager ; devient le prix convenu quand il choisit une offre. */
  proposedPrice?: number | null;
  finalPrice?: number;
  /** Offres reçues des chauffeurs (course en attente uniquement). */
  offers?: RideOffer[];
  vehicleType: string;
  driver?: {
    id?: string;
    firstName: string;
    lastName: string;
    phone: string;
    driverProfile?: {
      vehiclePlate: string;
      vehicleBrand: string;
      vehicleModel: string;
      averageRating: number;
    };
  };
}

interface RideState {
  currentRide: Ride | null;
  estimates: RideEstimate[];
  isLoading: boolean;
  driverLocation: { lat: number; lng: number } | null;

  getEstimate: (pickup: Location, dropoff: Location, vehicleType: string) => Promise<RideEstimate>;
  getAllEstimates: (pickup: Location, dropoff: Location) => Promise<void>;
  createRide: (data: {
    pickup: Location;
    dropoff: Location;
    vehicleType: string;
    paymentMethod: string;
    proposedPrice?: number;
    passengerCount?: number;
    luggageSize?: string;
  }) => Promise<void>;
  cancelRide: (rideId: string) => Promise<void>;
  acceptOffer: (rideId: string, offerId: string) => Promise<void>;
  declineOffer: (rideId: string, offerId: string) => Promise<void>;
  confirmArrival: (rideId: string) => Promise<string>;
  openDispute: (rideId: string, reason: string) => Promise<void>;
  listenToRideUpdates: () => void;
  refreshRide: () => Promise<void>;
  clearRide: () => void;
}

// Écouteurs socket de la course en cours (gardés pour pouvoir les retirer proprement).
let handlers: Record<string, (...args: any[]) => void> = {};
let boundSocket: ReturnType<typeof getSocket> = null;

export const useRideStore = create<RideState>((set, get) => ({
  currentRide: null,
  estimates: [],
  isLoading: false,
  driverLocation: null,

  getEstimate: async (pickup, dropoff, vehicleType) => {
    const response = await api.post('/rides/estimate', {
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
      dropoffLat: dropoff.lat,
      dropoffLng: dropoff.lng,
      vehicleType,
    });
    return response.data.data;
  },

  getAllEstimates: async (pickup, dropoff) => {
    set({ isLoading: true });
    const vehicleTypes = ['MOTO', 'CAR_ECONOMY', 'CAR_COMFORT', 'CAR_VIP'];

    const estimates = await Promise.all(
      vehicleTypes.map((type) => get().getEstimate(pickup, dropoff, type))
    );

    set({ estimates, isLoading: false });
  },

  createRide: async (data) => {
    set({ isLoading: true });
    try {
      const response = await api.post('/rides', {
        pickupLat: data.pickup.lat,
        pickupLng: data.pickup.lng,
        pickupAddress: data.pickup.address,
        dropoffLat: data.dropoff.lat,
        dropoffLng: data.dropoff.lng,
        dropoffAddress: data.dropoff.address,
        vehicleType: data.vehicleType,
        paymentMethod: data.paymentMethod,
        proposedPrice: data.proposedPrice,
        passengerCount: data.passengerCount,
        luggageSize: data.luggageSize,
      });

      set({ currentRide: response.data.data, isLoading: false });
      get().listenToRideUpdates();
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  cancelRide: async (rideId) => {
    // Route dédiée passager : PATCH /rides/:id/cancel
    // (La route /status est réservée aux chauffeurs)
    await api.patch(`/rides/${rideId}/cancel`, { reason: 'Annulé par le passager' });
    set({ currentRide: null, driverLocation: null });
  },

  // Le passager choisit l'offre d'un chauffeur : la course est attribuée au prix de l'offre.
  acceptOffer: async (rideId, offerId) => {
    const response = await api.post(`/rides/${rideId}/offers/${offerId}/accept`);
    const ride = response.data?.data;
    set((state) =>
      state.currentRide && state.currentRide.id === rideId
        ? {
            currentRide: {
              ...state.currentRide,
              status: ride?.status || 'ACCEPTED',
              driver: ride?.driver || state.currentRide.driver,
              proposedPrice: ride?.proposedPrice ?? state.currentRide.proposedPrice,
              offers: [],
            },
          }
        : {}
    );
  },

  // Le passager refuse l'offre d'un chauffeur (elle disparaît de la liste)
  declineOffer: async (rideId, offerId) => {
    await api.post(`/rides/${rideId}/offers/${offerId}/decline`);
    set((state) =>
      state.currentRide && state.currentRide.id === rideId
        ? { currentRide: { ...state.currentRide, offers: (state.currentRide.offers || []).filter((o) => o.id !== offerId) } }
        : {}
    );
  },

  // Le passager confirme son arrivée → libère le paiement (escrow)
  confirmArrival: async (rideId) => {
    const response = await api.post(`/rides/${rideId}/confirm-arrival`);
    return response.data.message as string;
  },

  // Ouvrir un litige sur la course
  openDispute: async (rideId, reason) => {
    await api.post(`/rides/${rideId}/dispute`, { reason });
  },

  // SOS et partage de trajet : voir config/safety.ts (API + menu de partage du téléphone)

  // Relit l'état de la course côté serveur (filet de sécurité si un événement socket est manqué).
  refreshRide: async () => {
    const ride = get().currentRide;
    if (!ride) return;
    try {
      const response = await api.get(`/rides/${ride.id}`);
      const fresh = response.data?.data;
      if (!fresh) return;
      set((state) =>
        state.currentRide && state.currentRide.id === fresh.id
          ? {
              currentRide: {
                ...state.currentRide,
                status: fresh.status,
                driver: fresh.driver || state.currentRide.driver,
                finalPrice: fresh.finalPrice ?? state.currentRide.finalPrice,
                proposedPrice: fresh.proposedPrice ?? state.currentRide.proposedPrice,
                // Les offres reçues : la liste du serveur fait foi (elle contient aussi celles
                // dont l'événement temps réel aurait été manqué, et retire les expirées).
                offers: fresh.status === 'PENDING' ? (fresh.offers ?? state.currentRide.offers ?? []) : [],
              },
            }
          : {}
      );
    } catch {
      /* réseau : on réessaiera au prochain tour */
    }
  },

  listenToRideUpdates: () => {
    const socket = getSocket();
    if (!socket) return;

    // Évite d'empiler les écouteurs à chaque nouvelle course : on retire uniquement
    // les NÔTRES (les autres écrans peuvent écouter les mêmes événements).
    if (boundSocket) {
      for (const [event, handler] of Object.entries(handlers)) boundSocket.off(event, handler);
    }

    const isCurrent = (rideId?: string) => {
      const current = get().currentRide;
      return !!current && (!rideId || rideId === current.id);
    };

    handlers = {
      // Après une reconnexion, on a pu manquer des événements : on relit l'état.
      connect: () => { get().refreshRide(); },

      ride_accepted: (data: any) => {
        if (!isCurrent(data?.rideId)) return;
        set((state) => ({
          currentRide: state.currentRide
            ? { ...state.currentRide, status: 'ACCEPTED', driver: data.driver, offers: [] }
            : null,
        }));
      },

      // Un chauffeur propose un autre prix : on l'ajoute (ou on remplace son offre précédente)
      ride_offer: (data: any) => {
        if (!isCurrent(data?.rideId) || !data?.offer) return;
        set((state) => {
          if (!state.currentRide || state.currentRide.status !== 'PENDING') return {};
          const others = (state.currentRide.offers || []).filter(
            (o) => o.id !== data.offer.id && o.driver?.id !== data.offer.driver?.id
          );
          return {
            currentRide: {
              ...state.currentRide,
              offers: [...others, data.offer].sort((a, b) => a.price - b.price),
            },
          };
        });
      },

      ride_status_update: (data: any) => {
        if (!isCurrent(data?.rideId)) return;
        set((state) => ({
          currentRide: state.currentRide
            ? { ...state.currentRide, status: data.status }
            : null,
        }));
        if (data.status === 'COMPLETED' || data.status === 'CANCELLED') {
          set({ driverLocation: null });
        }
      },

      'driver:location_update': (data: any) => {
        set({ driverLocation: { lat: data.lat, lng: data.lng } });
      },
    };

    for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler);
    boundSocket = socket;
  },

  clearRide: () => {
    set({ currentRide: null, driverLocation: null, estimates: [] });
  },
}));
