import { create } from 'zustand';
import api from '../config/api';

interface Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  image?: string;
  category: string;
  isAvailable: boolean;
}

interface Merchant {
  id: string;
  shopName: string;
  shopAddress: string;
  shopLat: number;
  shopLng: number;
  category: string;
  description?: string;
  isOpen: boolean;
  products: Product[];
  user: {
    firstName: string;
    lastName: string;
    phone: string;
  };
}

interface CartItem {
  product: Product;
  quantity: number;
}

interface MarketOrder {
  id: string;
  status: string;
  totalAmount: number;
  deliveryFee: number;
  items: { product: { name: string }; quantity: number; unitPrice: number }[];
  merchant: { shopName: string };
  createdAt: string;
}

interface MarketState {
  merchants: Merchant[];
  selectedMerchant: Merchant | null;
  cart: CartItem[];
  orders: MarketOrder[];
  isLoading: boolean;

  fetchMerchants: (params?: { lat?: number; lng?: number; category?: string }) => Promise<void>;
  fetchMerchantDetails: (id: string) => Promise<void>;
  addToCart: (product: Product) => void;
  removeFromCart: (productId: string) => void;
  updateCartQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  getCartTotal: () => number;
  placeOrder: (data: {
    merchantId: string;
    deliveryAddress: string;
    deliveryLat: number;
    deliveryLng: number;
    paymentMethod: string;
  }) => Promise<void>;
  fetchOrders: () => Promise<void>;
}

export const useMarketStore = create<MarketState>((set, get) => ({
  merchants: [],
  selectedMerchant: null,
  cart: [],
  orders: [],
  isLoading: false,

  fetchMerchants: async (params) => {
    set({ isLoading: true });
    try {
      const response = await api.get('/market/merchants', { params });
      set({ merchants: response.data.data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchMerchantDetails: async (id) => {
    set({ isLoading: true });
    try {
      const response = await api.get(`/market/merchants/${id}`);
      set({ selectedMerchant: response.data.data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  addToCart: (product) => {
    set((state) => {
      const existing = state.cart.find((item) => item.product.id === product.id);
      if (existing) {
        return {
          cart: state.cart.map((item) =>
            item.product.id === product.id
              ? { ...item, quantity: item.quantity + 1 }
              : item
          ),
        };
      }
      return { cart: [...state.cart, { product, quantity: 1 }] };
    });
  },

  removeFromCart: (productId) => {
    set((state) => ({
      cart: state.cart.filter((item) => item.product.id !== productId),
    }));
  },

  updateCartQuantity: (productId, quantity) => {
    if (quantity <= 0) {
      get().removeFromCart(productId);
      return;
    }
    set((state) => ({
      cart: state.cart.map((item) =>
        item.product.id === productId ? { ...item, quantity } : item
      ),
    }));
  },

  clearCart: () => set({ cart: [] }),

  getCartTotal: () => {
    return get().cart.reduce((total, item) => total + item.product.price * item.quantity, 0);
  },

  placeOrder: async (data) => {
    set({ isLoading: true });
    try {
      const items = get().cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
      }));

      await api.post('/market/orders', { ...data, items });
      set({ cart: [], isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  fetchOrders: async () => {
    const response = await api.get('/market/orders');
    set({ orders: response.data.data });
  },
}));
