import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const DEV_HOST = Platform.OS === 'web' ? 'localhost' : '192.168.1.61';
const SOCKET_URL = __DEV__ ? `http://${DEV_HOST}:3002` : 'https://237go-production-ee3d.up.railway.app';

let socket: Socket | null = null;

export async function connectSocket(): Promise<Socket> {
  const token = await AsyncStorage.getItem('token');

  if (socket?.connected) {
    return socket;
  }

  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10,
  });

  socket.on('connect', () => {
    console.log('🔌 Socket connecté');
  });

  socket.on('disconnect', (reason) => {
    console.log('🔌 Socket déconnecté:', reason);
  });

  socket.on('connect_error', (error) => {
    console.log('🔌 Erreur de connexion socket:', error.message);
  });

  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
