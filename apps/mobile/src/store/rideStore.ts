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
  }) => Promise<void>;
  cancelRide: (rideId: string) => Promise<void>;
  listenToRideUpdates: () => void;
  clearRide: () => void;
}

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
      });

      set({ currentRide: response.data.data, isLoading: false });
      get().listenToRideUpdates();
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  cancelRide: async (rideId) => {
    await api.patch(`/rides/${rideId}/status`, { status: 'CANCELLED' });
    set({ currentRide: null, driverLocation: null });
  },

  listenToRideUpdates: () => {
    const socket = getSocket();
    if (!socket) return;

    socket.on('ride_accepted', (data) => {
      set((state) => ({
        currentRide: state.currentRide
          ? { ...state.currentRide, status: 'ACCEPTED', driver: data.driver }
          : null,
      }));
    });

    socket.on('ride_status_update', (data) => {
      set((state) => ({
        currentRide: state.currentRide
          ? { ...state.currentRide, status: data.status }
          : null,
      }));

      if (data.status === 'COMPLETED' || data.status === 'CANCELLED') {
        set({ driverLocation: null });
      }
    });

    socket.on('driver:location_update', (data) => {
      set({ driverLocation: { lat: data.lat, lng: data.lng } });
    });
  },

  clearRide: () => {
    set({ currentRide: null, driverLocation: null, estimates: [] });
  },
}));
