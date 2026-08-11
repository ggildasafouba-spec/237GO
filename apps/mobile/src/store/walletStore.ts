import { create } from 'zustand';
import api from '../config/api';

interface WalletState {
  balance: number;
  currency: string;
  loyaltyPoints: number;
  loyaltyTier: string;
  isLoading: boolean;

  fetchBalance: () => Promise<void>;
  deposit: (amount: number, paymentMethod: string, phone?: string) => Promise<{ newBalance: number; bonus: number }>;
  withdraw: (amount: number, paymentMethod: string, phone: string) => Promise<void>;
  fetchLoyalty: () => Promise<void>;
  redeemPoints: (points: number) => Promise<void>;
}

export const useWalletStore = create<WalletState>((set) => ({
  balance: 0,
  currency: 'XAF',
  loyaltyPoints: 0,
  loyaltyTier: 'BRONZE',
  isLoading: false,

  fetchBalance: async () => {
    const response = await api.get('/wallet/balance');
    const { balance, currency } = response.data.data;
    set({ balance, currency });
  },

  deposit: async (amount, paymentMethod, phone) => {
    set({ isLoading: true });
    try {
      const response = await api.post('/wallet/deposit', { amount, paymentMethod, phone });
      const { newBalance, bonus } = response.data.data;
      set({ balance: newBalance, isLoading: false });
      return { newBalance, bonus };
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  withdraw: async (amount, paymentMethod, phone) => {
    set({ isLoading: true });
    try {
      const response = await api.post('/wallet/withdraw', { amount, paymentMethod, phone });
      set({ balance: response.data.data.newBalance, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  fetchLoyalty: async () => {
    const response = await api.get('/wallet/loyalty');
    const { points, tier } = response.data.data;
    set({ loyaltyPoints: points, loyaltyTier: tier });
  },

  redeemPoints: async (points) => {
    await api.post('/wallet/loyalty/redeem', { points });
    // Rafraîchir les données
    const [balanceRes, loyaltyRes] = await Promise.all([
      api.get('/wallet/balance'),
      api.get('/wallet/loyalty'),
    ]);
    set({
      balance: balanceRes.data.data.balance,
      loyaltyPoints: loyaltyRes.data.data.points,
      loyaltyTier: loyaltyRes.data.data.tier,
    });
  },
}));
