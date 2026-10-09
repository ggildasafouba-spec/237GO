import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Switch,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { useAuthStore } from '../store/authStore';
import api from '../config/api';
import { colors, spacing, typography } from '../theme';

interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  description?: string;
  isAvailable: boolean;
}

interface OrderItem {
  id: string;
  quantity: number;
  unitPrice: number;
  product: { name: string };
}

interface Order {
  id: string;
  status: string;
  totalAmount: number;
  deliveryFee: number;
  deliveryAddress: string;
  paymentMethod: string;
  createdAt: string;
  customer: { firstName: string; lastName: string; phone: string };
  items: OrderItem[];
}

interface Shop {
  id: string;
  shopName: string;
  shopAddress: string;
  isOpen: boolean;
  products: Product[];
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'En attente',
  CONFIRMED: 'Confirmée',
  PREPARING: 'En préparation',
  READY: 'Prête',
  PICKED_UP: 'Récupérée',
  DELIVERING: 'En livraison',
  DELIVERED: 'Livrée',
  CANCELLED: 'Annulée',
};

// Prochaine action du marchand selon le statut courant
const NEXT_STATUS: Record<string, { status: string; label: string }> = {
  PENDING: { status: 'CONFIRMED', label: '✅ Confirmer la commande' },
  CONFIRMED: { status: 'PREPARING', label: '👨\u200d🍳 Commencer la préparation' },
  PREPARING: { status: 'READY', label: '📦 Marquer comme prête' },
  READY: { status: 'DELIVERED', label: '🚚 Marquer comme livrée' },
};

export default function MerchantScreen({ navigation }: { navigation: any }) {
  const { user, logout } = useAuthStore();
  const [tab, setTab] = useState<'products' | 'orders'>('orders');
  const [shop, setShop] = useState<Shop | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  // Formulaire d'ajout de produit
  const [showAddForm, setShowAddForm] = useState(false);
  const [pName, setPName] = useState('');
  const [pPrice, setPPrice] = useState('');
  const [pCategory, setPCategory] = useState('');
  const [pDesc, setPDesc] = useState('');

  const loadShop = useCallback(async () => {
    try {
      const res = await api.get('/market/my-shop');
      setShop(res.data.data);
    } catch {
      // profil marchand absent
    }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const res = await api.get('/market/my-orders');
      setOrders(res.data.data);
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadShop(), loadOrders()]);
      setLoading(false);
    })();
  }, [loadShop, loadOrders]);

  const toggleShop = async () => {
    try {
      const res = await api.patch('/market/my-shop/toggle');
      setShop((prev) => (prev ? { ...prev, isOpen: res.data.data.isOpen } : prev));
    } catch {
      Alert.alert('Erreur', 'Impossible de changer le statut de la boutique');
    }
  };

  const addProduct = async () => {
    if (!pName || !pPrice || !pCategory) {
      Alert.alert('Attention', 'Nom, prix et catégorie sont requis');
      return;
    }
    try {
      await api.post('/market/products', {
        name: pName,
        price: parseFloat(pPrice),
        category: pCategory,
        description: pDesc || undefined,
      });
      setPName(''); setPPrice(''); setPCategory(''); setPDesc('');
      setShowAddForm(false);
      loadShop();
      Alert.alert('✅ Produit ajouté');
    } catch {
      Alert.alert('Erreur', "Impossible d'ajouter le produit");
    }
  };

  const toggleProduct = async (product: Product) => {
    try {
      await api.patch(`/market/products/${product.id}`, { isAvailable: !product.isAvailable });
      loadShop();
    } catch {
      Alert.alert('Erreur', 'Impossible de modifier le produit');
    }
  };

  const deleteProduct = (product: Product) => {
    Alert.alert('Supprimer ?', `Supprimer "${product.name}" ?`, [
      { text: 'Non' },
      {
        text: 'Oui',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/market/products/${product.id}`);
            loadShop();
          } catch {
            Alert.alert('Erreur', 'Suppression impossible');
          }
        },
      },
    ]);
  };

  const advanceOrder = async (order: Order) => {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    try {
      await api.patch(`/market/orders/${order.id}/status`, { status: next.status });
      loadOrders();
    } catch {
      Alert.alert('Erreur', 'Impossible de mettre à jour la commande');
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!shop) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.avatar}
            onPress={() => navigation.navigate('Profile')}
            accessibilityLabel="Profil et déconnexion"
          >
            <Text style={styles.avatarText}>{user?.firstName?.[0]}{user?.lastName?.[0]}</Text>
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text style={styles.shopName}>{user?.firstName} {user?.lastName}</Text>
            <Text style={styles.shopStatus}>Compte marchand</Text>
          </View>
        </View>
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🏪</Text>
          <Text style={styles.emptyText}>Aucune boutique associée à ce compte pour le moment.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); Promise.all([loadShop(), loadOrders()]).finally(() => setLoading(false)); }} accessibilityRole="button">
            <Text style={styles.retryBtnText}>🔄 Réessayer</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutBtn} onPress={() => logout()} accessibilityRole="button">
            <Text style={styles.logoutBtnText}>Changer de compte</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header boutique */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.avatar}
          onPress={() => navigation.navigate('Profile')}
          accessibilityLabel="Profil et déconnexion"
        >
          <Text style={styles.avatarText}>{user?.firstName?.[0]}{user?.lastName?.[0]}</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={styles.shopName}>{shop.shopName}</Text>
          <Text style={styles.shopStatus}>{shop.isOpen ? '🟢 Ouverte' : '🔴 Fermée'}</Text>
        </View>
        <Switch
          value={shop.isOpen}
          onValueChange={toggleShop}
          trackColor={{ false: '#ccc', true: colors.primaryLight }}
          thumbColor={shop.isOpen ? colors.primary : '#f4f3f4'}
          accessibilityLabel="Ouvrir ou fermer la boutique"
        />
      </View>

      {/* Onglets internes */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'orders' && styles.tabActive]}
          onPress={() => setTab('orders')}
          accessibilityRole="button"
        >
          <Text style={[styles.tabText, tab === 'orders' && styles.tabTextActive]}>
            Commandes ({orders.filter((o) => !['DELIVERED', 'CANCELLED'].includes(o.status)).length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'products' && styles.tabActive]}
          onPress={() => setTab('products')}
          accessibilityRole="button"
        >
          <Text style={[styles.tabText, tab === 'products' && styles.tabTextActive]}>
            Produits ({shop.products.length})
          </Text>
        </TouchableOpacity>
      </View>

      {tab === 'orders' ? (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: spacing.lg }}
          onRefresh={loadOrders}
          refreshing={false}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyIcon}>🧾</Text>
              <Text style={styles.emptyText}>Aucune commande pour le moment</Text>
            </View>
          }
          renderItem={({ item }) => {
            const next = NEXT_STATUS[item.status];
            return (
              <View style={styles.orderCard}>
                <View style={styles.orderTop}>
                  <Text style={styles.orderCustomer}>
                    {item.customer.firstName} {item.customer.lastName}
                  </Text>
                  <View style={styles.statusBadge}>
                    <Text style={styles.statusBadgeText}>{STATUS_LABELS[item.status] || item.status}</Text>
                  </View>
                </View>
                <Text style={styles.orderPhone}>📞 +237 {item.customer.phone}</Text>
                <Text style={styles.orderAddress}>📍 {item.deliveryAddress}</Text>
                <View style={styles.orderItems}>
                  {item.items.map((it) => (
                    <Text key={it.id} style={styles.orderItemLine}>
                      {it.quantity}× {it.product.name} — {(it.unitPrice * it.quantity).toLocaleString()} F
                    </Text>
                  ))}
                </View>
                <View style={styles.orderTotalRow}>
                  <Text style={styles.orderTotalLabel}>Total (+ livraison {item.deliveryFee.toLocaleString()} F)</Text>
                  <Text style={styles.orderTotal}>{(item.totalAmount + item.deliveryFee).toLocaleString()} F</Text>
                </View>
                {next && (
                  <TouchableOpacity style={styles.orderAction} onPress={() => advanceOrder(item)} accessibilityRole="button">
                    <Text style={styles.orderActionText}>{next.label}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => setShowAddForm(!showAddForm)}
            accessibilityRole="button"
          >
            <Text style={styles.addBtnText}>{showAddForm ? 'Annuler' : '+ Ajouter un produit'}</Text>
          </TouchableOpacity>

          {showAddForm && (
            <View style={styles.form}>
              <TextInput style={styles.input} placeholder="Nom du produit" value={pName} onChangeText={setPName} />
              <TextInput style={styles.input} placeholder="Prix (XAF)" value={pPrice} onChangeText={setPPrice} keyboardType="numeric" />
              <TextInput style={styles.input} placeholder="Catégorie (fruits, plats...)" value={pCategory} onChangeText={setPCategory} />
              <TextInput style={styles.input} placeholder="Description (optionnel)" value={pDesc} onChangeText={setPDesc} />
              <TouchableOpacity style={styles.saveBtn} onPress={addProduct} accessibilityRole="button">
                <Text style={styles.saveBtnText}>Enregistrer</Text>
              </TouchableOpacity>
            </View>
          )}

          {shop.products.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyIcon}>📦</Text>
              <Text style={styles.emptyText}>Aucun produit. Ajoutez votre premier article.</Text>
            </View>
          ) : (
            shop.products.map((p) => (
              <View key={p.id} style={styles.productCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>{p.name}</Text>
                  <Text style={styles.productMeta}>{p.price.toLocaleString()} F • {p.category}</Text>
                  {p.description ? <Text style={styles.productDesc}>{p.description}</Text> : null}
                </View>
                <View style={styles.productActions}>
                  <Switch
                    value={p.isAvailable}
                    onValueChange={() => toggleProduct(p)}
                    trackColor={{ false: '#ccc', true: colors.primaryLight }}
                    thumbColor={p.isAvailable ? colors.primary : '#f4f3f4'}
                    accessibilityLabel={`Disponibilité de ${p.name}`}
                  />
                  <TouchableOpacity onPress={() => deleteProduct(p)} accessibilityLabel={`Supprimer ${p.name}`}>
                    <Text style={styles.deleteIcon}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  emptyIcon: { fontSize: 44, marginBottom: spacing.md },
  emptyText: { fontSize: typography.md, color: colors.textSecondary, textAlign: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', padding: spacing.lg, paddingTop: spacing.xl + 20,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: typography.md, fontWeight: '800' },
  shopName: { fontSize: typography.lg, fontWeight: '800', color: colors.text },
  shopStatus: { fontSize: typography.sm, color: colors.textSecondary, marginTop: 2 },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: spacing.md, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { fontSize: typography.sm, color: colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: colors.primary, fontWeight: '800' },
  // Orders
  orderCard: { backgroundColor: '#fff', borderRadius: 14, padding: spacing.md, marginBottom: spacing.md, elevation: 2 },
  orderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  orderCustomer: { fontSize: typography.md, fontWeight: '800', color: colors.text },
  statusBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  statusBadgeText: { fontSize: typography.xs, color: colors.primary, fontWeight: '700' },
  orderPhone: { fontSize: typography.sm, color: colors.textSecondary },
  orderAddress: { fontSize: typography.sm, color: colors.textSecondary, marginTop: 2 },
  orderItems: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  orderItemLine: { fontSize: typography.sm, color: colors.text, marginBottom: 2 },
  orderTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  orderTotalLabel: { fontSize: typography.xs, color: colors.textSecondary, flex: 1 },
  orderTotal: { fontSize: typography.lg, fontWeight: '900', color: colors.primary },
  orderAction: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: 10, alignItems: 'center', marginTop: spacing.md },
  orderActionText: { color: '#fff', fontWeight: '700' },
  // Products
  addBtn: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: 10, alignItems: 'center', marginBottom: spacing.md },
  addBtnText: { color: '#fff', fontWeight: '700' },
  form: { backgroundColor: '#fff', padding: spacing.md, borderRadius: 12, marginBottom: spacing.md },
  input: {
    backgroundColor: colors.background, padding: spacing.md, borderRadius: 10,
    fontSize: typography.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
  },
  saveBtn: { backgroundColor: colors.secondary, padding: spacing.md, borderRadius: 10, alignItems: 'center' },
  saveBtnText: { color: colors.primaryDark, fontWeight: '800' },
  productCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: spacing.md, marginBottom: spacing.sm },
  productName: { fontSize: typography.md, fontWeight: '700', color: colors.text },
  productMeta: { fontSize: typography.sm, color: colors.primary, marginTop: 2, fontWeight: '600' },
  productDesc: { fontSize: typography.xs, color: colors.textSecondary, marginTop: 2 },
  productActions: { alignItems: 'center' },
  deleteIcon: { fontSize: 18, marginTop: spacing.sm },
  retryBtn: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: 10, marginTop: spacing.lg },
  retryBtnText: { color: '#fff', fontWeight: '700' },
  logoutBtn: { borderWidth: 1, borderColor: colors.error, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: 10, marginTop: spacing.md },
  logoutBtnText: { color: colors.error, fontWeight: '700' },
});
