import { create } from 'zustand';
import api from '../config/api';
import { getSocket } from '../config/socket';

interface DeliveryEstimate {
  distance: number;
  estimatedPrice: number;
  currency: string;
  packageType: string;
}

interface Delivery {
  id: string;
  status: string;
  packageType: string;
  packageDesc?: string;
  pickupAddress: string;
  dropoffAddress: string;
  estimatedPrice: number;
  finalPrice?: number;
  driver?: {
    firstName: string;
    lastName: string;
    phone: string;
  };
}

interface DeliveryState {
  currentDelivery: Delivery | null;
  estimate: DeliveryEstimate | null;
  history: Delivery[];
  isLoading: boolean;

  getEstimate: (data: {
    pickupLat: number;
    pickupLng: number;
    dropoffLat: number;
    dropoffLng: number;
    packageType: string;
  }) => Promise<DeliveryEstimate>;

  createDelivery: (data: {
    pickupLat: number;
    pickupLng: number;
    pickupAddress: string;
    pickupContact: string;
    dropoffLat: number;
    dropoffLng: number;
    dropoffAddress: string;
    dropoffContact: string;
    packageType: string;
    packageDesc?: string;
    packageWeight?: number;
    paymentMethod: string;
  }) => Promise<void>;

  fetchHistory: () => Promise<void>;
  listenToUpdates: () => void;
  clearDelivery: () => void;
}

export const useDeliveryStore = create<DeliveryState>((set, get) => ({
  currentDelivery: null,
  estimate: null,
  history: [],
  isLoading: false,

  getEstimate: async (data) => {
    const response = await api.post('/deliveries/estimate', data);
    const estimate = response.data.data;
    set({ estimate });
    return estimate;
  },

  createDelivery: async (data) => {
    set({ isLoading: true });
    try {
      const response = await api.post('/deliveries', data);
      set({ currentDelivery: response.data.data, isLoading: false });
      get().listenToUpdates();
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  fetchHistory: async () => {
    const response = await api.get('/deliveries/history');
    set({ history: response.data.data.deliveries });
  },

  listenToUpdates: () => {
    const socket = getSocket();
    if (!socket) return;

    socket.on('delivery_accepted', (data) => {
      set((state) => ({
        currentDelivery: state.currentDelivery
          ? { ...state.currentDelivery, status: 'ACCEPTED', driver: data }
          : null,
      }));
    });

    socket.on('delivery_status_update', (data) => {
      set((state) => ({
        currentDelivery: state.currentDelivery
          ? { ...state.currentDelivery, status: data.status }
          : null,
      }));
    });
  },

  clearDelivery: () => set({ currentDelivery: null, estimate: null }),
}));
