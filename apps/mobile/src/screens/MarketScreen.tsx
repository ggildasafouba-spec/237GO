import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useMarketStore } from '../store/marketStore';
import { colors, spacing, typography } from '../theme';

const categories = [
  { id: 'all', name: 'Tout', icon: '🏪' },
  { id: 'alimentation', name: 'Alimentation', icon: '🥑' },
  { id: 'restaurant', name: 'Restaurants', icon: '🍽️' },
  { id: 'boulangerie', name: 'Boulangerie', icon: '🥖' },
  { id: 'pharmacie', name: 'Pharmacie', icon: '💊' },
  { id: 'artisanat', name: 'Artisanat', icon: '🎨' },
  { id: 'electronique', name: 'Électronique', icon: '📱' },
];

export default function MarketScreen({ navigation }: { navigation: any }) {
  const [view, setView] = useState<'merchants' | 'merchant-detail' | 'cart' | 'checkout'>('merchants');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [selectedPayment, setSelectedPayment] = useState('ORANGE_MONEY');

  const {
    merchants,
    selectedMerchant,
    cart,
    isLoading,
    fetchMerchants,
    fetchMerchantDetails,
    addToCart,
    removeFromCart,
    updateCartQuantity,
    clearCart,
    getCartTotal,
    placeOrder,
  } = useMarketStore();

  useEffect(() => {
    fetchMerchants({ lat: 4.0511, lng: 9.7679 });
  }, []);

  const filteredMerchants = merchants.filter((m) => {
    if (selectedCategory !== 'all' && m.category !== selectedCategory) return false;
    if (searchQuery && !m.shopName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const handlePlaceOrder = async () => {
    if (!deliveryAddress) {
      Alert.alert('Attention', 'Entrez votre adresse de livraison');
      return;
    }
    if (!selectedMerchant) return;

    try {
      await placeOrder({
        merchantId: selectedMerchant.id,
        deliveryAddress,
        deliveryLat: 4.055,
        deliveryLng: 9.77,
        paymentMethod: selectedPayment,
      });
      Alert.alert('🎉 Commande passée !', 'Le marchand prépare votre commande.', [
        { text: 'OK', onPress: () => setView('merchants') },
      ]);
    } catch {
      Alert.alert('Erreur', 'Impossible de passer la commande');
    }
  };

  // Vue: Liste des marchands
  if (view === 'merchants') {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Retour</Text>
        </TouchableOpacity>

        <Text style={styles.title}>🛒 GO Market</Text>
        <Text style={styles.subtitle}>Le marché livré chez vous</Text>

        {/* Recherche */}
        <TextInput
          style={styles.searchInput}
          placeholder="🔍 Rechercher un marchand..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholderTextColor={colors.textLight}
          accessibilityLabel="Rechercher un marchand"
        />

        {/* Catégories */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoriesRow}>
          {categories.map((cat) => (
            <TouchableOpacity
              key={cat.id}
              style={[styles.categoryChip, selectedCategory === cat.id && styles.categoryChipActive]}
              onPress={() => setSelectedCategory(cat.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: selectedCategory === cat.id }}
            >
              <Text style={styles.categoryIcon}>{cat.icon}</Text>
              <Text style={[styles.categoryText, selectedCategory === cat.id && styles.categoryTextActive]}>
                {cat.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Panier flottant */}
        {cart.length > 0 && (
          <TouchableOpacity
            style={styles.floatingCart}
            onPress={() => setView('cart')}
            accessibilityLabel={`Panier: ${cart.length} articles, ${getCartTotal().toLocaleString()} francs`}
            accessibilityRole="button"
          >
            <Text style={styles.floatingCartText}>
              🛒 {cart.length} article(s) • {getCartTotal().toLocaleString()} XAF
            </Text>
            <Text style={styles.floatingCartArrow}>→</Text>
          </TouchableOpacity>
        )}

        {/* Liste des marchands */}
        {isLoading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={filteredMerchants}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 100 }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>🏪</Text>
                <Text style={styles.emptyText}>Aucun marchand trouvé</Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.merchantCard}
                onPress={() => { fetchMerchantDetails(item.id); setView('merchant-detail'); }}
                accessibilityLabel={`${item.shopName}, ${item.category}`}
                accessibilityRole="button"
              >
                <View style={styles.merchantIcon}>
                  <Text style={{ fontSize: 28 }}>
                    {item.category === 'alimentation' ? '🥑' : item.category === 'restaurant' ? '🍽️' : '🏪'}
                  </Text>
                </View>
                <View style={styles.merchantInfo}>
                  <Text style={styles.merchantName}>{item.shopName}</Text>
                  <Text style={styles.merchantCategory}>{item.category}</Text>
                  <Text style={styles.merchantAddress}>{item.shopAddress}</Text>
                </View>
                <View style={[styles.statusDot, { backgroundColor: item.isOpen ? colors.success : colors.error }]} />
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    );
  }

  // Vue: Détail marchand + produits
  if (view === 'merchant-detail') {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => setView('merchants')} style={styles.backBtn}>
          <Text style={styles.backText}>← Marchands</Text>
        </TouchableOpacity>

        {selectedMerchant && (
          <>
            <View style={styles.merchantHeader}>
              <Text style={styles.merchantDetailName}>{selectedMerchant.shopName}</Text>
              <Text style={styles.merchantDetailAddress}>{selectedMerchant.shopAddress}</Text>
              <Text style={styles.merchantDetailCategory}>{selectedMerchant.category}</Text>
            </View>

            <Text style={styles.productsTitle}>Produits disponibles</Text>

            <FlatList
              data={selectedMerchant.products}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 100 }}
              ListEmptyComponent={
                <Text style={styles.emptyText}>Aucun produit disponible</Text>
              }
              renderItem={({ item }) => {
                const cartItem = cart.find((c) => c.product.id === item.id);
                return (
                  <View style={styles.productCard}>
                    <View style={styles.productInfo}>
                      <Text style={styles.productName}>{item.name}</Text>
                      {item.description && <Text style={styles.productDesc}>{item.description}</Text>}
                      <Text style={styles.productPrice}>{item.price.toLocaleString()} XAF</Text>
                    </View>
                    <View style={styles.productActions}>
                      {cartItem ? (
                        <View style={styles.quantityControl}>
                          <TouchableOpacity
                            style={styles.qtyBtn}
                            onPress={() => updateCartQuantity(item.id, cartItem.quantity - 1)}
                            accessibilityLabel="Réduire la quantité"
                          >
                            <Text style={styles.qtyBtnText}>−</Text>
                          </TouchableOpacity>
                          <Text style={styles.qtyText}>{cartItem.quantity}</Text>
                          <TouchableOpacity
                            style={styles.qtyBtn}
                            onPress={() => updateCartQuantity(item.id, cartItem.quantity + 1)}
                            accessibilityLabel="Augmenter la quantité"
                          >
                            <Text style={styles.qtyBtnText}>+</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={styles.addBtn}
                          onPress={() => addToCart(item)}
                          accessibilityLabel={`Ajouter ${item.name} au panier`}
                          accessibilityRole="button"
                        >
                          <Text style={styles.addBtnText}>+ Ajouter</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              }}
            />

            {cart.length > 0 && (
              <TouchableOpacity
                style={styles.floatingCart}
                onPress={() => setView('cart')}
                accessibilityRole="button"
              >
                <Text style={styles.floatingCartText}>
                  🛒 Voir le panier • {getCartTotal().toLocaleString()} XAF
                </Text>
                <Text style={styles.floatingCartArrow}>→</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    );
  }

  // Vue: Panier
  if (view === 'cart') {
    return (
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => setView('merchant-detail')} style={styles.backBtn}>
          <Text style={styles.backText}>← Continuer les achats</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Mon panier</Text>

        {cart.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🛒</Text>
            <Text style={styles.emptyText}>Votre panier est vide</Text>
          </View>
        ) : (
          <>
            {cart.map((item) => (
              <View key={item.product.id} style={styles.cartItem}>
                <View style={styles.cartItemInfo}>
                  <Text style={styles.cartItemName}>{item.product.name}</Text>
                  <Text style={styles.cartItemPrice}>
                    {item.product.price.toLocaleString()} x {item.quantity} = {(item.product.price * item.quantity).toLocaleString()} XAF
                  </Text>
                </View>
                <View style={styles.quantityControl}>
                  <TouchableOpacity
                    style={styles.qtyBtn}
                    onPress={() => updateCartQuantity(item.product.id, item.quantity - 1)}
                  >
                    <Text style={styles.qtyBtnText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.qtyText}>{item.quantity}</Text>
                  <TouchableOpacity
                    style={styles.qtyBtn}
                    onPress={() => updateCartQuantity(item.product.id, item.quantity + 1)}
                  >
                    <Text style={styles.qtyBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            <View style={styles.cartTotal}>
              <Text style={styles.cartTotalLabel}>Total</Text>
              <Text style={styles.cartTotalValue}>{getCartTotal().toLocaleString()} XAF</Text>
            </View>

            <TouchableOpacity
              style={styles.button}
              onPress={() => setView('checkout')}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>Passer la commande</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.clearCartBtn}
              onPress={() => { clearCart(); setView('merchants'); }}
              accessibilityRole="button"
            >
              <Text style={styles.clearCartText}>Vider le panier</Text>
            </TouchableOpacity>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // Vue: Checkout
  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <TouchableOpacity onPress={() => setView('cart')} style={styles.backBtn}>
        <Text style={styles.backText}>← Panier</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Finaliser la commande</Text>

      <Text style={styles.sectionLabel}>Adresse de livraison</Text>
      <TextInput
        style={styles.input}
        placeholder="Votre adresse de livraison"
        value={deliveryAddress}
        onChangeText={setDeliveryAddress}
        placeholderTextColor={colors.textLight}
        accessibilityLabel="Adresse de livraison"
      />

      <Text style={styles.sectionLabel}>Paiement</Text>
      {[
        { id: 'ORANGE_MONEY', name: 'Orange Money', icon: '🟠' },
        { id: 'MTN_MOMO', name: 'MTN MoMo', icon: '🟡' },
        { id: 'CASH', name: 'Espèces', icon: '💵' },
        { id: 'WALLET', name: 'Portefeuille 237GO', icon: '👛' },
      ].map((method) => (
        <TouchableOpacity
          key={method.id}
          style={[styles.paymentOption, selectedPayment === method.id && styles.paymentSelected]}
          onPress={() => setSelectedPayment(method.id)}
          accessibilityRole="radio"
          accessibilityState={{ selected: selectedPayment === method.id }}
        >
          <Text style={styles.paymentIcon}>{method.icon}</Text>
          <Text style={styles.paymentName}>{method.name}</Text>
          {selectedPayment === method.id && <Text style={styles.checkmark}>✓</Text>}
        </TouchableOpacity>
      ))}

      <View style={styles.orderSummary}>
        <View style={styles.orderRow}>
          <Text>Sous-total</Text>
          <Text style={{ fontWeight: '600' }}>{getCartTotal().toLocaleString()} XAF</Text>
        </View>
        <View style={styles.orderRow}>
          <Text>Frais de livraison</Text>
          <Text style={{ fontWeight: '600' }}>~500 XAF</Text>
        </View>
        <View style={[styles.orderRow, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }]}>
          <Text style={styles.orderTotalLabel}>Total</Text>
          <Text style={styles.orderTotalValue}>{(getCartTotal() + 500).toLocaleString()} XAF</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.button, isLoading && styles.buttonDisabled]}
        onPress={handlePlaceOrder}
        disabled={isLoading}
        accessibilityRole="button"
      >
        {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Confirmer la commande 🛒</Text>}
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    paddingTop: spacing.xl + 20,
  },
  backBtn: { marginBottom: spacing.md },
  backText: { color: colors.primary, fontSize: typography.md, fontWeight: '600' },
  title: { fontSize: typography.xl, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: typography.sm, color: colors.textSecondary, marginBottom: spacing.md },
  searchInput: {
    backgroundColor: '#fff',
    padding: spacing.md,
    borderRadius: 12,
    fontSize: typography.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  categoriesRow: { marginBottom: spacing.md, maxHeight: 50 },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  categoryIcon: { fontSize: 16, marginRight: 4 },
  categoryText: { fontSize: typography.xs, color: colors.text, fontWeight: '500' },
  categoryTextActive: { color: '#fff' },
  merchantCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: spacing.sm,
    elevation: 1,
  },
  merchantIcon: { width: 48, height: 48, justifyContent: 'center', alignItems: 'center', marginRight: spacing.md },
  merchantInfo: { flex: 1 },
  merchantName: { fontSize: typography.md, fontWeight: '700', color: colors.text },
  merchantCategory: { fontSize: typography.xs, color: colors.primary, textTransform: 'capitalize' },
  merchantAddress: { fontSize: typography.xs, color: colors.textSecondary, marginTop: 2 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  merchantHeader: { backgroundColor: '#fff', padding: spacing.lg, borderRadius: 12, marginBottom: spacing.lg },
  merchantDetailName: { fontSize: typography.xl, fontWeight: '700', color: colors.text },
  merchantDetailAddress: { fontSize: typography.sm, color: colors.textSecondary, marginTop: 4 },
  merchantDetailCategory: { fontSize: typography.xs, color: colors.primary, marginTop: 4, textTransform: 'capitalize' },
  productsTitle: { fontSize: typography.lg, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: '#fff',
    borderRadius: 10,
    marginBottom: spacing.sm,
  },
  productInfo: { flex: 1 },
  productName: { fontSize: typography.md, fontWeight: '600', color: colors.text },
  productDesc: { fontSize: typography.xs, color: colors.textSecondary, marginTop: 2 },
  productPrice: { fontSize: typography.sm, fontWeight: '700', color: colors.primary, marginTop: 4 },
  productActions: { marginLeft: spacing.sm },
  quantityControl: { flexDirection: 'row', alignItems: 'center' },
  qtyBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  qtyText: { marginHorizontal: 12, fontSize: typography.md, fontWeight: '700' },
  addBtn: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addBtnText: { color: colors.primary, fontWeight: '700', fontSize: typography.xs },
  floatingCart: {
    position: 'absolute',
    bottom: 20,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    elevation: 6,
  },
  floatingCartText: { color: '#fff', fontWeight: '700', fontSize: typography.sm },
  floatingCartArrow: { color: '#fff', fontSize: typography.lg },
  cartItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: '#fff',
    borderRadius: 10,
    marginBottom: spacing.sm,
  },
  cartItemInfo: { flex: 1 },
  cartItemName: { fontSize: typography.md, fontWeight: '600', color: colors.text },
  cartItemPrice: { fontSize: typography.sm, color: colors.textSecondary, marginTop: 2 },
  cartTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.lg,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginTop: spacing.md,
  },
  cartTotalLabel: { fontSize: typography.lg, fontWeight: '700', color: colors.text },
  cartTotalValue: { fontSize: typography.lg, fontWeight: '800', color: colors.primary },
  clearCartBtn: { alignItems: 'center', marginTop: spacing.md, padding: spacing.sm },
  clearCartText: { color: colors.error, fontSize: typography.sm },
  sectionLabel: { fontSize: typography.md, fontWeight: '600', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  input: {
    backgroundColor: '#fff',
    padding: spacing.md,
    borderRadius: 12,
    fontSize: typography.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  paymentSelected: { borderColor: colors.primary, backgroundColor: '#E8F5E9' },
  paymentIcon: { fontSize: 20, marginRight: spacing.sm },
  paymentName: { flex: 1, fontSize: typography.sm, color: colors.text },
  checkmark: { fontSize: typography.md, color: colors.primary, fontWeight: '700' },
  orderSummary: { backgroundColor: '#fff', padding: spacing.lg, borderRadius: 12, marginTop: spacing.lg },
  orderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  orderTotalLabel: { fontSize: typography.lg, fontWeight: '700' },
  orderTotalValue: { fontSize: typography.lg, fontWeight: '800', color: colors.primary },
  button: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: 12, alignItems: 'center', marginTop: spacing.lg },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: typography.md, fontWeight: '700' },
  emptyState: { alignItems: 'center', marginTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyText: { fontSize: typography.md, color: colors.textSecondary },
});
