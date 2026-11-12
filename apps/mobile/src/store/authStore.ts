import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../config/api';
import { connectSocket, disconnectSocket } from '../config/socket';
import { registerForPushNotifications } from '../config/notifications';

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
    email?: string;
    role?: string;
    language?: string;
  }) => Promise<void>;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  // Remplace le jeton de CET appareil (après changement de mot de passe / déconnexion des autres appareils)
  replaceToken: (token: string) => Promise<void>;
  loadUser: () => Promise<void>;
  updateUser: (patch: Partial<User>) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
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
    registerForPushNotifications();

    set({ user, token, isAuthenticated: true });
  },

  login: async (phone, password) => {
    const response = await api.post('/auth/login', { phone, password });
    const { user, token } = response.data.data;

    await AsyncStorage.setItem('token', token);
    await AsyncStorage.setItem('user', JSON.stringify(user));
    await connectSocket();
    registerForPushNotifications();

    set({ user, token, isAuthenticated: true });
  },

  logout: async () => {
    // On déconnecte l'état en premier pour que l'UI réagisse immédiatement,
    // puis on nettoie le stockage/socket (sans bloquer si une étape échoue).
    set({ user: null, token: null, isAuthenticated: false });
    try {
      await AsyncStorage.removeItem('token');
      await AsyncStorage.removeItem('user');
    } catch {}
    try {
      disconnectSocket();
    } catch {}
  },

  replaceToken: async (token) => {
    await AsyncStorage.setItem('token', token);
    set({ token });
    // La connexion temps réel a été coupée par le serveur : on la rouvre avec le nouveau jeton
    try {
      disconnectSocket();
    } catch {}
    await connectSocket().catch(() => {});
  },

  loadUser: async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      const userStr = await AsyncStorage.getItem('user');

      if (token && userStr) {
        const user = JSON.parse(userStr);
        await connectSocket();
        registerForPushNotifications();
        set({ user, token, isAuthenticated: true, isLoading: false });

        // Rafraîchir le profil depuis le serveur : le RÔLE peut avoir changé depuis la
        // dernière connexion (ex. chauffeur ou marchand approuvé par l'admin). Sans ça,
        // l'app gardait l'ancien rôle et n'affichait pas l'écran chauffeur.
        api.get('/auth/me')
          .then(async (res) => {
            const fresh = res.data?.data;
            if (!fresh?.id) return;
            const updated = {
              ...user,
              id: fresh.id,
              phone: fresh.phone,
              email: fresh.email,
              firstName: fresh.firstName,
              lastName: fresh.lastName,
              role: fresh.role,
              language: fresh.language,
            };
            set({ user: updated });
            await AsyncStorage.setItem('user', JSON.stringify(updated));
          })
          .catch(() => {
            /* hors ligne : on garde le profil enregistré */
          });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  // Met à jour localement les infos du user (ex. après ajout d'email dans le profil)
  // et persiste, pour que l'UI (ex. bannière "ajoutez un email") se mette à jour.
  updateUser: async (patch) => {
    const current = get().user;
    if (!current) return;
    const updated = { ...current, ...patch };
    set({ user: updated });
    try {
      await AsyncStorage.setItem('user', JSON.stringify(updated));
    } catch {}
  },
}));
