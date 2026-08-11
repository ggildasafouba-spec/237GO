import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../config/api';
import { connectSocket, disconnectSocket } from '../config/socket';

interface User {
  id: string;
  phone: string;
  firstName: string;
  lastName: string;
  role: 'PASSENGER' | 'DRIVER' | 'MERCHANT' | 'ADMIN';
  language: string;
  email?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  register: (data: {
    phone: string;
    firstName: string;
    lastName: string;
    password: string;
    role?: string;
    language?: string;
  }) => Promise<void>;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: true,
  isAuthenticated: false,

  register: async (data) => {
    const response = await api.post('/auth/register', data);
    const { user, token } = response.data.data;

    await AsyncStorage.setItem('token', token);
    await AsyncStorage.setItem('user', JSON.stringify(user));
    await connectSocket();

    set({ user, token, isAuthenticated: true });
  },

  login: async (phone, password) => {
    const response = await api.post('/auth/login', { phone, password });
    const { user, token } = response.data.data;

    await AsyncStorage.setItem('token', token);
    await AsyncStorage.setItem('user', JSON.stringify(user));
    await connectSocket();

    set({ user, token, isAuthenticated: true });
  },

  logout: async () => {
    await AsyncStorage.removeItem('token');
    await AsyncStorage.removeItem('user');
    disconnectSocket();

    set({ user: null, token: null, isAuthenticated: false });
  },

  loadUser: async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      const userStr = await AsyncStorage.getItem('user');

      if (token && userStr) {
        const user = JSON.parse(userStr);
        await connectSocket();
        set({ user, token, isAuthenticated: true, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },
}));
