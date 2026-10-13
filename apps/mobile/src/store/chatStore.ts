import { create } from 'zustand';
import api from '../config/api';
import { getSocket } from '../config/socket';

export interface ChatMessage {
  id: string;
  serviceType: string;
  serviceId: string;
  senderId: string;
  receiverId: string;
  content?: string | null;
  imageUrl?: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface Conversation {
  serviceType: string;
  serviceId: string;
  interlocutor: { id: string; firstName: string; lastName: string; avatar?: string | null };
  lastMessage: { content?: string | null; imageUrl?: string | null; createdAt: string; senderId: string };
  unreadCount: number;
}

interface ChatState {
  conversations: Conversation[];
  messages: ChatMessage[];
  unreadTotal: number;
  isLoading: boolean;

  fetchConversations: () => Promise<void>;
  fetchMessages: (serviceType: string, serviceId: string, withUserId: string) => Promise<void>;
  sendMessage: (params: { serviceType: string; serviceId: string; receiverId: string; content?: string; imageUrl?: string }) => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  listenForMessages: () => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  messages: [],
  unreadTotal: 0,
  isLoading: false,

  fetchConversations: async () => {
    set({ isLoading: true });
    try {
      const res = await api.get('/chat/conversations');
      set({ conversations: res.data.data || [], isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchMessages: async (serviceType, serviceId, withUserId) => {
    set({ isLoading: true });
    try {
      const res = await api.get('/chat/messages', { params: { serviceType, serviceId, withUserId } });
      set({ messages: res.data.data || [], isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  sendMessage: async ({ serviceType, serviceId, receiverId, content, imageUrl }) => {
    const res = await api.post('/chat/messages', { serviceType, serviceId, receiverId, content, imageUrl });
    const msg = res.data.data as ChatMessage;
    set((state) => ({ messages: [...state.messages, msg] }));
  },

  fetchUnreadCount: async () => {
    try {
      const res = await api.get('/chat/unread-count');
      set({ unreadTotal: res.data.data?.count || 0 });
    } catch {}
  },

  // Écoute temps réel des nouveaux messages (Socket.io)
  listenForMessages: () => {
    const socket = getSocket();
    if (!socket) return;
    socket.off('new_message');
    socket.on('new_message', (msg: ChatMessage) => {
      const state = get();
      // Si le message appartient à la conversation ouverte, l'ajouter au fil
      const openConv = state.messages[0];
      const belongsToOpen =
        state.messages.length > 0 &&
        openConv.serviceType === msg.serviceType &&
        openConv.serviceId === msg.serviceId;
      if (belongsToOpen) {
        set({ messages: [...state.messages, msg] });
      }
      // Rafraîchir le compteur global
      set((s) => ({ unreadTotal: s.unreadTotal + 1 }));
    });
  },

  clearMessages: () => set({ messages: [] }),
}));
