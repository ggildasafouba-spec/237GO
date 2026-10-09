import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// En dev : le web (navigateur du PC) utilise localhost, le mobile (téléphone) utilise l'IP du PC sur le réseau.
const DEV_HOST = Platform.OS === 'web' ? 'localhost' : '192.168.1.61';
const API_BASE_URL = __DEV__
  ? `http://${DEV_HOST}:3002/api`
  : 'https://237gobackend-production.up.railway.app/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Intercepteur pour ajouter le token
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Intercepteur pour gérer les erreurs
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await AsyncStorage.removeItem('token');
      await AsyncStorage.removeItem('user');
      // TODO: Rediriger vers l'écran de connexion
    }
    return Promise.reject(error);
  }
);

export default api;
export { API_BASE_URL };
