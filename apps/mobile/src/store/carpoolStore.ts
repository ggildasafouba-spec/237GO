import { create } from 'zustand';
import api from '../config/api';

interface Carpool {
  id: string;
  departureCity: string;
  departureAddress: string;
  arrivalCity: string;
  arrivalAddress: string;
  departureTime: string;
  availableSeats: number;
  pricePerSeat: number;
  currency: string;
  status: string;
  description?: string;
  driver: {
    firstName: string;
    lastName: string;
    driverProfile?: {
      averageRating: number;
      totalTrips: number;
    };
  };
}

interface CarpoolBooking {
  id: string;
  seats: number;
  status: string;
  carpool: Carpool;
}

interface CarpoolState {
  searchResults: Carpool[];
  myTrips: Carpool[];
  myBookings: CarpoolBooking[];
  isLoading: boolean;

  searchCarpools: (params: {
    departureCity?: string;
    arrivalCity?: string;
    date?: string;
    seats?: number;
  }) => Promise<void>;

  createCarpool: (data: {
    departureLat: number;
    departureLng: number;
    departureCity: string;
    departureAddress: string;
    arrivalLat: number;
    arrivalLng: number;
    arrivalCity: string;
    arrivalAddress: string;
    departureTime: string;
    availableSeats: number;
    pricePerSeat: number;
    description?: string;
  }) => Promise<void>;

  bookCarpool: (carpoolId: string, seats: number) => Promise<void>;
  fetchMyTrips: () => Promise<void>;
  fetchMyBookings: () => Promise<void>;
}

export const useCarpoolStore = create<CarpoolState>((set) => ({
  searchResults: [],
  myTrips: [],
  myBookings: [],
  isLoading: false,

  searchCarpools: async (params) => {
    set({ isLoading: true });
    try {
      const response = await api.get('/carpools/search', { params });
      set({ searchResults: response.data.data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  createCarpool: async (data) => {
    set({ isLoading: true });
    try {
      await api.post('/carpools', data);
      set({ isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  bookCarpool: async (carpoolId, seats) => {
    set({ isLoading: true });
    try {
      await api.post(`/carpools/${carpoolId}/book`, { seats });
      set({ isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  fetchMyTrips: async () => {
    const response = await api.get('/carpools/my-trips');
    set({ myTrips: response.data.data });
  },

  fetchMyBookings: async () => {
    const response = await api.get('/carpools/my-bookings');
    set({ myBookings: response.data.data });
  },
}));
