import { create } from 'zustand';
import api from '../config/api';

interface Vehicle {
  id: string;
  type: string;
  brand: string;
  model: string;
  year: number;
  plate: string;
  color?: string;
  seats?: number;
  images: string[];
  pricePerDay: number;
  pricePerHour?: number;
  currency: string;
  withDriver: boolean;
  isAvailable: boolean;
  locationLat: number;
  locationLng: number;
  locationAddress: string;
  owner: { firstName: string; lastName: string };
  bookings?: { startDate: string; endDate: string }[];
}

interface RentalBooking {
  id: string;
  vehicleId: string;
  startDate: string;
  endDate: string;
  totalPrice: number;
  withDriver: boolean;
  status: string;
  vehicle?: Vehicle;
}

interface RentalState {
  vehicles: Vehicle[];
  selectedVehicle: Vehicle | null;
  myVehicles: Vehicle[];
  myBookings: RentalBooking[];
  isLoading: boolean;

  searchVehicles: (params?: {
    type?: string;
    minPrice?: number;
    maxPrice?: number;
    withDriver?: boolean;
    lat?: number;
    lng?: number;
  }) => Promise<void>;

  getVehicleDetails: (id: string) => Promise<void>;

  publishVehicle: (data: {
    type: string;
    brand: string;
    model: string;
    year: number;
    plate: string;
    color?: string;
    seats?: number;
    pricePerDay: number;
    pricePerHour?: number;
    withDriver?: boolean;
    locationLat: number;
    locationLng: number;
    locationAddress: string;
  }) => Promise<void>;

  bookVehicle: (data: {
    vehicleId: string;
    startDate: string;
    endDate: string;
    withDriver?: boolean;
    paymentMethod: string;
  }) => Promise<void>;

  fetchMyVehicles: () => Promise<void>;
  fetchMyBookings: () => Promise<void>;
}

export const useRentalStore = create<RentalState>((set) => ({
  vehicles: [],
  selectedVehicle: null,
  myVehicles: [],
  myBookings: [],
  isLoading: false,

  searchVehicles: async (params) => {
    set({ isLoading: true });
    try {
      const response = await api.get('/rentals/vehicles', { params });
      set({ vehicles: response.data.data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  getVehicleDetails: async (id) => {
    set({ isLoading: true });
    try {
      const response = await api.get(`/rentals/vehicles/${id}`);
      set({ selectedVehicle: response.data.data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  publishVehicle: async (data) => {
    set({ isLoading: true });
    try {
      await api.post('/rentals/vehicles', data);
      set({ isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  bookVehicle: async (data) => {
    set({ isLoading: true });
    try {
      await api.post(`/rentals/vehicles/${data.vehicleId}/book`, {
        startDate: data.startDate,
        endDate: data.endDate,
        withDriver: data.withDriver,
        paymentMethod: data.paymentMethod,
      });
      set({ isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  fetchMyVehicles: async () => {
    const response = await api.get('/rentals/my-vehicles');
    set({ myVehicles: response.data.data });
  },

  fetchMyBookings: async () => {
    // TODO: endpoint à ajouter côté backend
    set({ myBookings: [] });
  },
}));
