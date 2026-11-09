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

interface Ride {
  id: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  estimatedPrice: number;
  finalPrice?: number;
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
  confirmArrival: (rideId: string) => Promise<string>;
  openDispute: (rideId: string, reason: string) => Promise<void>;
  sendSOS: (lat: number, lng: number, rideId?: string) => void;
  shareTrip: (rideId: string, contactPhone: string) => void;
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

  // Le passager confirme son arrivée → libère le paiement (escrow)
  confirmArrival: async (rideId) => {
    const response = await api.post(`/rides/${rideId}/confirm-arrival`);
    return response.data.message as string;
  },

  // Ouvrir un litige sur la course
  openDispute: async (rideId, reason) => {
    await api.post(`/rides/${rideId}/dispute`, { reason });
  },

  // Déclencher une alerte SOS via le socket
  sendSOS: (lat, lng, rideId) => {
    const socket = getSocket();
    socket?.emit('sos', { lat, lng, rideId });
  },

  // Partager le trajet par SMS
  shareTrip: (rideId, contactPhone) => {
    const socket = getSocket();
    socket?.emit('share:trip', { rideId, contactPhone });
  },

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
          ? { currentRide: { ...state.currentRide, status: fresh.status, driver: fresh.driver || state.currentRide.driver, finalPrice: fresh.finalPrice ?? state.currentRide.finalPrice } }
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
            ? { ...state.currentRide, status: 'ACCEPTED', driver: data.driver }
            : null,
        }));
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
