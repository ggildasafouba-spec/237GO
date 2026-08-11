import { create } from 'zustand';
import api from '../config/api';

interface BusinessAccount {
  id: string;
  name: string;
  address?: string;
  contactEmail: string;
  contactPhone: string;
  monthlyBudget?: number;
  currency: string;
  isActive: boolean;
  members: BusinessMember[];
}

interface BusinessMember {
  id: string;
  userId: string;
  role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
  monthlyLimit?: number;
  user: { firstName: string; lastName: string; phone: string };
}

interface BusinessDashboard {
  account: BusinessAccount;
  stats: {
    totalMembers: number;
    monthlyBudget: number;
    budgetUsed: number;
    totalTrips: number;
  };
}

interface BusinessState {
  myAccounts: { business: BusinessAccount; role: string }[];
  currentAccount: BusinessDashboard | null;
  isLoading: boolean;

  fetchMyAccounts: () => Promise<void>;

  createAccount: (data: {
    name: string;
    contactEmail: string;
    contactPhone: string;
    address?: string;
    monthlyBudget?: number;
  }) => Promise<void>;

  fetchDashboard: (accountId: string) => Promise<void>;

  addMember: (accountId: string, data: {
    userId: string;
    role?: string;
    monthlyLimit?: number;
  }) => Promise<void>;
}

export const useBusinessStore = create<BusinessState>((set) => ({
  myAccounts: [],
  currentAccount: null,
  isLoading: false,

  fetchMyAccounts: async () => {
    set({ isLoading: true });
    try {
      const response = await api.get('/business/my-accounts');
      set({ myAccounts: response.data.data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  createAccount: async (data) => {
    set({ isLoading: true });
    try {
      await api.post('/business/accounts', data);
      set({ isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  fetchDashboard: async (accountId) => {
    set({ isLoading: true });
    try {
      const response = await api.get(`/business/accounts/${accountId}/dashboard`);
      set({ currentAccount: response.data.data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  addMember: async (accountId, data) => {
    set({ isLoading: true });
    try {
      await api.post(`/business/accounts/${accountId}/members`, data);
      set({ isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },
}));
