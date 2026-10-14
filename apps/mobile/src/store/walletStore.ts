import { create } from 'zustand';
import api from '../config/api';

interface WalletState {
  balance: number;
  currency: string;
  loyaltyPoints: number;
  loyaltyTier: string;
  isLoading: boolean;

  fetchBalance: () => Promise<void>;
  deposit: (amount: number, paymentMethod: string, phone?: string) => Promise<{ newBalance: number; bonus: number; paymentUrl?: string | null; transactionId?: string }>;
  verifyDeposit: (transactionId: string) => Promise<{ status: 'COMPLETED' | 'PENDING' | 'FAILED'; balance: number }>;
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
      const { newBalance, bonus, paymentUrl, transactionId } = response.data.data;
      // On ne met PAS à jour le solde ici : il ne sera crédité qu'après
      // confirmation du paiement (vérification NotchPay via verifyDeposit).
      set({ isLoading: false });
      return { newBalance, bonus, paymentUrl, transactionId };
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  // Vérifie l'état d'un dépôt auprès du backend (qui interroge NotchPay) et
  // met à jour le solde si le paiement est confirmé.
  verifyDeposit: async (transactionId) => {
    const response = await api.post(`/wallet/verify/${transactionId}`);
    const { status, balance } = response.data.data;
    if (status === 'COMPLETED' && typeof balance === 'number') {
      set({ balance });
    }
    return { status, balance };
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
