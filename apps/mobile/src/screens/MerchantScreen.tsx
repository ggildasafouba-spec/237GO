import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Image,
  Modal,
  Vibration,
} from 'react-native';
import { useAuthStore } from '../store/authStore';
import api from '../config/api';
import { pickAndUploadImage } from '../config/upload';
import { openMenuTemplate, pickAndParseMenu, commitMenuImport, MenuPreview } from '../config/menuImport';
import { useSafeScreen } from '../hooks/useSafeScreen';
import { useLocation } from '../hooks/useLocation';
import DestinationPicker, { PickedPlace } from '../components/DestinationPicker';
import { colors, spacing, typography } from '../theme';
import { formatPhone } from '../utils/phone';

interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  description?: string;
  image?: string;
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

interface OpeningHours {
  [day: string]: { open: string; close: string; closed: boolean };
}

interface Shop {
  id: string;
  shopName: string;
  shopAddress: string;
  shopLat?: number;
  shopLng?: number;
  isOpen: boolean;
  openingHours?: OpeningHours;
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

const NEXT_STATUS: Record<string, { status: string; label: string }> = {
  PENDING: { status: 'CONFIRMED', label: '✅ Confirmer la commande' },
  CONFIRMED: { status: 'PREPARING', label: '👨‍🍳 Commencer la préparation' },
  PREPARING: { status: 'READY', label: '📦 Marquer comme prête' },
  READY: { status: 'DELIVERED', label: '🚚 Marquer comme livrée' },
};

const DAYS = [
  { key: 'monday', label: 'Lundi' },
  { key: 'tuesday', label: 'Mardi' },
  { key: 'wednesday', label: 'Mercredi' },
  { key: 'thursday', label: 'Jeudi' },
  { key: 'friday', label: 'Vendredi' },
  { key: 'saturday', label: 'Samedi' },
  { key: 'sunday', label: 'Dimanche' },
];

const DEFAULT_HOURS: OpeningHours = Object.fromEntries(
  DAYS.map((d) => [d.key, { open: '08:00', close: '20:00', closed: false }])
);

export default function MerchantScreen({ navigation }: { navigation: any }) {
  const { user, logout } = useAuthStore();
  const [tab, setTab] = useState<'orders' | 'products' | 'hours'>('orders');
  const [shop, setShop] = useState<Shop | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const safe = useSafeScreen();

  // Formulaire ajout produit
  const [showAddForm, setShowAddForm] = useState(false);
  const [pName, setPName] = useState('');
  const [pPrice, setPPrice] = useState('');
  const [pCategory, setPCategory] = useState('');
  const [pDesc, setPDesc] = useState('');
  const [pImage, setPImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);

  // Horaires
  const [hours, setHours] = useState<OpeningHours>(DEFAULT_HOURS);
  const [savingHours, setSavingHours] = useState(false);
  const [editingTime, setEditingTime] = useState<{ day: string; field: 'open' | 'close' } | null>(null);
  const [timeInput, setTimeInput] = useState('');

  // Détection des nouvelles commandes (vibration d'alerte)
  const prevOrderCountRef = useRef<number>(0);

  const loadShop = useCallback(async () => {
    try {
      const res = await api.get('/market/my-shop');
      const data = res.data.data;
      setShop(data);
      if (data.openingHours) {
        setHours({ ...DEFAULT_HOURS, ...data.openingHours });
      }
    } catch {
      // profil marchand absent
    }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const res = await api.get('/market/my-orders');
      const newOrders: Order[] = res.data.data;

      // Détecter une nouvelle commande PENDING et jouer un son
      const pendingCount = newOrders.filter((o) => o.status === 'PENDING').length;
      if (pendingCount > prevOrderCountRef.current) {
        playNotificationSound();
      }
      prevOrderCountRef.current = pendingCount;
      setOrders(newOrders);
    } catch {}
  }, []);

  // Polling toutes les 30s pour les nouvelles commandes
  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadShop(), loadOrders()]);
      setLoading(false);
    })();

    const interval = setInterval(() => loadOrders(), 30000);
    return () => clearInterval(interval);
  }, [loadShop, loadOrders]);

  // Alerte nouvelle commande : vibration en motif (pause, vibre, pause, vibre)
  const playNotificationSound = () => {
    try {
      Vibration.vibrate([0, 400, 200, 400, 200, 400]);
    } catch {
      // Vibration indisponible — pas bloquant
    }
  };

  // ===== Position de la boutique =====
  // Les clients ne voient que les boutiques à moins de 5 km : la position doit être juste.
  const { getCurrentLocation, reverseGeocode } = useLocation();
  const [showShopPicker, setShowShopPicker] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);

  const saveShopLocation = async (lat: number, lng: number, label?: string) => {
    setSavingLocation(true);
    try {
      const res = await api.patch('/market/my-shop/location', {
        shopLat: lat,
        shopLng: lng,
        ...(label ? { shopAddress: label.slice(0, 200) } : {}),
      });
      setShop((prev) => (prev ? { ...prev, ...res.data.data } : prev));
      Alert.alert('📍 Position enregistrée', 'Les clients à moins de 5 km verront maintenant votre boutique.');
    } catch (e: any) {
      Alert.alert('Erreur', e?.response?.data?.message || 'Impossible de modifier la position');
    } finally {
      setSavingLocation(false);
    }
  };

  const useGpsForShop = async () => {
    setSavingLocation(true);
    const loc = await getCurrentLocation();
    if (!loc) {
      setSavingLocation(false);
      Alert.alert('Localisation', "Position GPS indisponible. Autorisez la localisation ou choisissez la position sur la carte.");
      return;
    }
    const label = await reverseGeocode(loc.latitude, loc.longitude).catch(() => '');
    await saveShopLocation(loc.latitude, loc.longitude, label || undefined);
  };

  const onShopPlacePicked = (place: PickedPlace) => {
    setShowShopPicker(false);
    saveShopLocation(place.lat, place.lng, place.label);
  };

  const toggleShop = async () => {
    try {
      const res = await api.patch('/market/my-shop/toggle');
      setShop((prev) => (prev ? { ...prev, isOpen: res.data.data.isOpen } : prev));
    } catch {
      Alert.alert('Erreur', 'Impossible de changer le statut de la boutique');
    }
  };

  const handlePickImage = async () => {
    setUploadingImage(true);
    try {
      const url = await pickAndUploadImage();
      if (url) setPImage(url);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || "Impossible d'uploader l'image");
    } finally {
      setUploadingImage(false);
    }
  };

  const addProduct = async () => {
    if (!pName || !pPrice || !pCategory) {
      Alert.alert('Attention', 'Nom, prix et catégorie sont requis');
      return;
    }
    setSavingProduct(true);
    try {
      await api.post('/market/products', {
        name: pName,
        price: parseFloat(pPrice),
        category: pCategory,
        description: pDesc || undefined,
        image: pImage || undefined,
      });
      // Reset formulaire
      setPName(''); setPPrice(''); setPCategory(''); setPDesc(''); setPImage(null);
      setShowAddForm(false);
      loadShop();
      Alert.alert('✅ Produit ajouté !');
    } catch {
      Alert.alert('Erreur', "Impossible d'ajouter le produit");
    } finally {
      setSavingProduct(false);
    }
  };

  // ===== Import du menu (Excel / CSV) =====
  const [menuPreview, setMenuPreview] = useState<MenuPreview | null>(null);
  const [parsingMenu, setParsingMenu] = useState(false);
  const [committingMenu, setCommittingMenu] = useState(false);
  const [photoProductId, setPhotoProductId] = useState<string | null>(null);

  const handleImportMenu = async () => {
    setParsingMenu(true);
    try {
      const preview = await pickAndParseMenu();
      if (preview) setMenuPreview(preview);
    } catch (e: any) {
      Alert.alert('Import impossible', e?.response?.data?.message || e?.message || 'Lecture du fichier impossible');
    } finally {
      setParsingMenu(false);
    }
  };

  const confirmMenuImport = async () => {
    if (!menuPreview) return;
    setCommittingMenu(true);
    try {
      const res = await commitMenuImport(menuPreview.rows);
      setMenuPreview(null);
      await loadShop();
      Alert.alert('✅ Menu importé', `${res.message}. Ajoutez maintenant les photos de vos plats (touchez l'image d'un plat).`);
    } catch (e: any) {
      Alert.alert('Erreur', e?.response?.data?.message || "Impossible d'importer le menu");
    } finally {
      setCommittingMenu(false);
    }
  };

  // Ajouter / changer la photo d'un plat existant (ex. après un import Excel)
  const changeProductPhoto = async (product: Product) => {
    setPhotoProductId(product.id);
    try {
      const url = await pickAndUploadImage();
      if (url) {
        await api.patch(`/market/products/${product.id}`, { image: url });
        await loadShop();
      }
    } catch (e: any) {
      Alert.alert('Erreur', e?.response?.data?.message || e?.message || "Impossible d'ajouter la photo");
    } finally {
      setPhotoProductId(null);
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
        text: 'Oui', style: 'destructive',
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

  const saveHours = async () => {
    setSavingHours(true);
    try {
      await api.patch('/market/my-shop/hours', { openingHours: hours });
      Alert.alert('✅ Horaires sauvegardés');
    } catch {
      Alert.alert('Erreur', 'Impossible de sauvegarder les horaires');
    } finally {
      setSavingHours(false);
    }
  };

  const updateHourField = (day: string, field: 'open' | 'close', value: string) => {
    setHours((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }));
  };

  const toggleDayClosed = (day: string) => {
    setHours((prev) => ({
      ...prev,
      [day]: { ...prev[day], closed: !prev[day].closed },
    }));
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
        <View style={[styles.header, safe.top]}>
          <TouchableOpacity style={styles.avatar} onPress={() => navigation.navigate('Profile')}>
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
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); Promise.all([loadShop(), loadOrders()]).finally(() => setLoading(false)); }}>
            <Text style={styles.retryBtnText}>🔄 Réessayer</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutBtn} onPress={() => logout()}>
            <Text style={styles.logoutBtnText}>Changer de compte</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const pendingCount = orders.filter((o) => o.status === 'PENDING').length;

  return (
    <View style={styles.container}>
      {/* Header boutique */}
      <View style={[styles.header, safe.top]}>
        <TouchableOpacity style={styles.avatar} onPress={() => navigation.navigate('Profile')}>
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

      {/* Position de la boutique (modifiable : GPS ou carte) */}
      <View style={styles.shopLocationBar}>
        <Text style={styles.shopLocationText} numberOfLines={1}>📍 {shop.shopAddress}</Text>
        {savingLocation ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <>
            <TouchableOpacity onPress={useGpsForShop} accessibilityRole="button" accessibilityLabel="Placer la boutique à ma position GPS">
              <Text style={styles.shopLocationAction}>📡 Ici</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowShopPicker(true)} accessibilityRole="button" accessibilityLabel="Choisir la position de la boutique sur la carte">
              <Text style={styles.shopLocationAction}>🗺️ Carte</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
      <DestinationPicker
        visible={showShopPicker}
        initialCenter={{ lat: shop.shopLat ?? 4.0511, lng: shop.shopLng ?? 9.7679 }}
        title="Où se trouve votre boutique ?"
        onConfirm={onShopPlacePicked}
        onClose={() => setShowShopPicker(false)}
      />

      {/* Onglets */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'orders' && styles.tabActive]}
          onPress={() => setTab('orders')}
        >
          <Text style={[styles.tabText, tab === 'orders' && styles.tabTextActive]}>
            Commandes {pendingCount > 0 ? `🔴 ${pendingCount}` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'products' && styles.tabActive]}
          onPress={() => setTab('products')}
        >
          <Text style={[styles.tabText, tab === 'products' && styles.tabTextActive]}>
            Produits ({shop.products.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'hours' && styles.tabActive]}
          onPress={() => setTab('hours')}
        >
          <Text style={[styles.tabText, tab === 'hours' && styles.tabTextActive]}>
            Horaires
          </Text>
        </TouchableOpacity>
      </View>

      {/* ===== ONGLET COMMANDES ===== */}
      {tab === 'orders' && (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: safe.insets.bottom + 16 }}
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
            const isPending = item.status === 'PENDING';
            return (
              <View style={[styles.orderCard, isPending && styles.orderCardPending]}>
                {isPending && (
                  <View style={styles.newBadge}>
                    <Text style={styles.newBadgeText}>🔔 NOUVELLE COMMANDE</Text>
                  </View>
                )}
                <View style={styles.orderTop}>
                  <Text style={styles.orderCustomer}>
                    {item.customer.firstName} {item.customer.lastName}
                  </Text>
                  <View style={[styles.statusBadge, isPending && styles.statusBadgePending]}>
                    <Text style={[styles.statusBadgeText, isPending && { color: '#E65100' }]}>
                      {STATUS_LABELS[item.status] || item.status}
                    </Text>
                  </View>
                </View>
                <Text style={styles.orderPhone}>📞 {formatPhone(item.customer.phone)}</Text>
                <Text style={styles.orderAddress}>📍 {item.deliveryAddress}</Text>
                <View style={styles.orderItemsList}>
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
                  <TouchableOpacity style={[styles.orderAction, isPending && styles.orderActionPending]} onPress={() => advanceOrder(item)}>
                    <Text style={styles.orderActionText}>{next.label}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      )}

      {/* ===== ONGLET PRODUITS ===== */}
      {tab === 'products' && (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: safe.insets.bottom + 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => setShowAddForm(!showAddForm)}
          >
            <Text style={styles.addBtnText}>{showAddForm ? '✕ Annuler' : '+ Ajouter un produit'}</Text>
          </TouchableOpacity>

          {/* Import du menu complet depuis un fichier Excel / CSV */}
          <View style={styles.importBox}>
            <Text style={styles.importTitle}>📋 Tout votre menu d'un coup</Text>
            <Text style={styles.importHint}>
              Remplissez le modèle Excel (nom, prix, catégorie, description), puis importez-le.
              Un plat du même nom est mis à jour, sans doublon.
            </Text>
            <View style={styles.importRow}>
              <TouchableOpacity
                style={styles.importBtnSecondary}
                onPress={() => openMenuTemplate().catch(() => Alert.alert('Erreur', 'Ouverture du modèle impossible'))}
                accessibilityRole="button"
                accessibilityLabel="Télécharger le modèle Excel"
              >
                <Text style={styles.importBtnSecondaryText}>📥 Modèle Excel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.importBtn, parsingMenu && { opacity: 0.6 }]}
                onPress={handleImportMenu}
                disabled={parsingMenu}
                accessibilityRole="button"
                accessibilityLabel="Importer mon menu"
              >
                {parsingMenu ? <ActivityIndicator color="#fff" /> : <Text style={styles.importBtnText}>📤 Importer mon menu</Text>}
              </TouchableOpacity>
            </View>
          </View>

          {showAddForm && (
            <View style={styles.form}>
              {/* Photo du produit */}
              <Text style={styles.formLabel}>Photo du produit</Text>
              <TouchableOpacity style={styles.imagePickerBtn} onPress={handlePickImage} disabled={uploadingImage}>
                {uploadingImage ? (
                  <ActivityIndicator color={colors.primary} />
                ) : pImage ? (
                  <Image source={{ uri: pImage }} style={styles.imagePreview} />
                ) : (
                  <View style={styles.imagePlaceholder}>
                    <Text style={styles.imagePlaceholderIcon}>📷</Text>
                    <Text style={styles.imagePlaceholderText}>Ajouter une photo</Text>
                  </View>
                )}
              </TouchableOpacity>

              <Text style={styles.formLabel}>Nom du produit *</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: Poulet DG, Ndolé..."
                value={pName}
                onChangeText={setPName}
                placeholderTextColor={colors.textLight}
              />

              <Text style={styles.formLabel}>Prix (XAF) *</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: 2500"
                value={pPrice}
                onChangeText={setPPrice}
                keyboardType="numeric"
                placeholderTextColor={colors.textLight}
              />

              <Text style={styles.formLabel}>Catégorie *</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: Plats, Boissons, Desserts..."
                value={pCategory}
                onChangeText={setPCategory}
                placeholderTextColor={colors.textLight}
              />

              <Text style={styles.formLabel}>Description (optionnel)</Text>
              <TextInput
                style={[styles.input, { height: 70, textAlignVertical: 'top' }]}
                placeholder="Ingrédients, allergènes, portions..."
                value={pDesc}
                onChangeText={setPDesc}
                multiline
                placeholderTextColor={colors.textLight}
              />

              <TouchableOpacity
                style={[styles.saveBtn, savingProduct && { opacity: 0.6 }]}
                onPress={addProduct}
                disabled={savingProduct}
              >
                {savingProduct ? (
                  <ActivityIndicator color={colors.primaryDark} />
                ) : (
                  <Text style={styles.saveBtnText}>✅ Enregistrer le produit</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {shop.products.length === 0 ? (
            <View style={[styles.center, { marginTop: 40 }]}>
              <Text style={styles.emptyIcon}>📦</Text>
              <Text style={styles.emptyText}>Aucun produit. Ajoutez votre premier article.</Text>
            </View>
          ) : (
            shop.products.map((p) => (
              <View key={p.id} style={styles.productCard}>
                {/* Image produit : toucher pour ajouter / changer la photo */}
                <TouchableOpacity
                  onPress={() => changeProductPhoto(p)}
                  disabled={photoProductId === p.id}
                  accessibilityRole="button"
                  accessibilityLabel={p.image ? `Changer la photo de ${p.name}` : `Ajouter une photo à ${p.name}`}
                >
                  {photoProductId === p.id ? (
                    <View style={styles.productImagePlaceholder}>
                      <ActivityIndicator color={colors.primary} />
                    </View>
                  ) : p.image ? (
                    <Image source={{ uri: p.image }} style={styles.productImage} />
                  ) : (
                    <View style={styles.productImagePlaceholder}>
                      <Text style={{ fontSize: 20 }}>📷</Text>
                      <Text style={{ fontSize: 9, color: colors.textLight }}>Photo</Text>
                    </View>
                  )}
                </TouchableOpacity>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.productName}>{p.name}</Text>
                  <Text style={styles.productMeta}>{p.price.toLocaleString()} F · {p.category}</Text>
                  {p.description ? <Text style={styles.productDesc} numberOfLines={2}>{p.description}</Text> : null}
                  <Text style={{ fontSize: 11, color: p.isAvailable ? colors.success : colors.error, marginTop: 2, fontWeight: '600' }}>
                    {p.isAvailable ? '✅ Disponible' : '⛔ Indisponible'}
                  </Text>
                </View>
                <View style={styles.productActions}>
                  <Switch
                    value={p.isAvailable}
                    onValueChange={() => toggleProduct(p)}
                    trackColor={{ false: '#ccc', true: colors.primaryLight }}
                    thumbColor={p.isAvailable ? colors.primary : '#f4f3f4'}
                    accessibilityLabel={`Disponibilité de ${p.name}`}
                  />
                  <TouchableOpacity onPress={() => deleteProduct(p)} style={{ padding: spacing.sm }}>
                    <Text style={{ fontSize: 18 }}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* ===== ONGLET HORAIRES ===== */}
      {tab === 'hours' && (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: safe.insets.bottom + 80 }}
        >
          <Text style={styles.hoursTitle}>⏰ Horaires d'ouverture</Text>
          <Text style={styles.hoursSubtitle}>
            Définissez vos horaires pour chaque jour. Les clients verront si vous êtes ouvert.
          </Text>

          {DAYS.map((day) => {
            const dayHours = hours[day.key] || { open: '08:00', close: '20:00', closed: false };
            return (
              <View key={day.key} style={styles.dayRow}>
                <View style={styles.dayLeft}>
                  <Text style={styles.dayLabel}>{day.label}</Text>
                  <Switch
                    value={!dayHours.closed}
                    onValueChange={() => toggleDayClosed(day.key)}
                    trackColor={{ false: '#ccc', true: colors.primaryLight }}
                    thumbColor={!dayHours.closed ? colors.primary : '#f4f3f4'}
                    accessibilityLabel={`${day.label} ouvert ou fermé`}
                  />
                </View>

                {dayHours.closed ? (
                  <Text style={styles.dayClosed}>Fermé</Text>
                ) : (
                  <View style={styles.timeRow}>
                    <TouchableOpacity
                      style={styles.timeBtn}
                      onPress={() => { setEditingTime({ day: day.key, field: 'open' }); setTimeInput(dayHours.open); }}
                    >
                      <Text style={styles.timeBtnText}>{dayHours.open}</Text>
                    </TouchableOpacity>
                    <Text style={styles.timeSep}>→</Text>
                    <TouchableOpacity
                      style={styles.timeBtn}
                      onPress={() => { setEditingTime({ day: day.key, field: 'close' }); setTimeInput(dayHours.close); }}
                    >
                      <Text style={styles.timeBtnText}>{dayHours.close}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}

          <TouchableOpacity
            style={[styles.saveHoursBtn, savingHours && { opacity: 0.6 }]}
            onPress={saveHours}
            disabled={savingHours}
          >
            {savingHours ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveHoursBtnText}>💾 Sauvegarder les horaires</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Modal saisie heure */}
      <Modal
        visible={!!editingTime}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingTime(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>
              {editingTime?.field === 'open' ? '🌅 Heure d\'ouverture' : '🌙 Heure de fermeture'}
            </Text>
            <TextInput
              style={styles.timeInput}
              value={timeInput}
              onChangeText={setTimeInput}
              placeholder="HH:MM"
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              autoFocus
              placeholderTextColor={colors.textLight}
            />
            <Text style={styles.modalHint}>Format : HH:MM (ex: 08:00, 22:30)</Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setEditingTime(null)}
              >
                <Text style={styles.modalCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={() => {
                  if (editingTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(timeInput)) {
                    updateHourField(editingTime.day, editingTime.field, timeInput);
                    setEditingTime(null);
                  } else {
                    Alert.alert('Format invalide', 'Entrez une heure au format HH:MM (ex: 08:00)');
                  }
                }}
              >
                <Text style={styles.modalConfirmText}>✅ Confirmer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Aperçu de l'import du menu : rien n'est enregistré avant « Valider » */}
      <Modal
        visible={!!menuPreview}
        transparent
        animationType="slide"
        onRequestClose={() => !committingMenu && setMenuPreview(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, styles.previewBox]}>
            <Text style={styles.modalTitle}>📋 Vérifiez votre menu</Text>
            {menuPreview && (
              <>
                <Text style={styles.previewSummary}>
                  {menuPreview.validCount} plat(s) prêt(s) : {menuPreview.createCount} nouveau(x), {menuPreview.updateCount} mis à jour
                  {menuPreview.errorCount > 0 ? `\n⚠️ ${menuPreview.errorCount} ligne(s) en erreur ne seront pas importées` : ''}
                </Text>
                <ScrollView style={styles.previewList}>
                  {menuPreview.rows.map((r) => (
                    <View
                      key={r.line}
                      style={[styles.previewRow, r.errors.length > 0 && styles.previewRowError]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.previewName}>
                          {r.errors.length > 0 ? '❌' : r.action === 'update' ? '🔄' : '➕'} {r.name || '(sans nom)'}
                        </Text>
                        <Text style={styles.previewMeta}>
                          Ligne {r.line} · {r.category}{r.description ? ` · ${r.description}` : ''}
                        </Text>
                        {r.errors.map((e) => (
                          <Text key={e} style={styles.previewError}>{e}</Text>
                        ))}
                        {r.warnings.map((w) => (
                          <Text key={w} style={styles.previewWarning}>{w}</Text>
                        ))}
                      </View>
                      <Text style={styles.previewPrice}>
                        {r.price !== null ? `${r.price.toLocaleString()} F` : '—'}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={styles.modalCancelBtn}
                    onPress={() => setMenuPreview(null)}
                    disabled={committingMenu}
                  >
                    <Text style={styles.modalCancelText}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalConfirmBtn, (menuPreview.validCount === 0 || committingMenu) && { opacity: 0.5 }]}
                    onPress={confirmMenuImport}
                    disabled={menuPreview.validCount === 0 || committingMenu}
                    accessibilityLabel={`Valider l'import de ${menuPreview.validCount} plats`}
                  >
                    {committingMenu ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.modalConfirmText}>✅ Valider ({menuPreview.validCount})</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  shopLocationBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: '#fff', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderTopWidth: 1, borderTopColor: '#f0f0f0',
  },
  shopLocationText: { flex: 1, fontSize: typography.sm, color: colors.textSecondary },
  shopLocationAction: { fontSize: typography.sm, fontWeight: '700', color: colors.primary },
  importBox: {
    backgroundColor: '#fff', borderRadius: 14, padding: spacing.md, marginBottom: spacing.lg,
    borderWidth: 1, borderColor: colors.primaryLight,
  },
  importTitle: { fontSize: typography.md, fontWeight: '700', color: colors.text, marginBottom: 4 },
  importHint: { fontSize: typography.sm, color: colors.textSecondary, marginBottom: spacing.md },
  importRow: { flexDirection: 'row', gap: spacing.sm },
  importBtn: {
    flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: spacing.md, alignItems: 'center',
  },
  importBtnText: { color: '#fff', fontWeight: '700' },
  importBtnSecondary: {
    flex: 1, backgroundColor: colors.background, borderRadius: 10, paddingVertical: spacing.md, alignItems: 'center',
    borderWidth: 1, borderColor: colors.primary,
  },
  importBtnSecondaryText: { color: colors.primaryDark, fontWeight: '700' },
  previewBox: { maxHeight: '85%', width: '92%' },
  previewSummary: { fontSize: typography.sm, color: colors.text, marginBottom: spacing.md, textAlign: 'center' },
  previewList: { maxHeight: 380, marginBottom: spacing.md },
  previewRow: {
    flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: '#eee', gap: spacing.sm,
  },
  previewRowError: { backgroundColor: '#FFEBEE', borderRadius: 8, paddingHorizontal: spacing.sm },
  previewName: { fontSize: typography.md, fontWeight: '600', color: colors.text },
  previewMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  previewError: { fontSize: 12, color: colors.error, marginTop: 2, fontWeight: '600' },
  previewWarning: { fontSize: 12, color: '#E65100', marginTop: 2 },
  previewPrice: { fontSize: typography.md, fontWeight: '700', color: colors.primaryDark },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  emptyIcon: { fontSize: 44, marginBottom: spacing.md },
  emptyText: { fontSize: typography.md, color: colors.textSecondary, textAlign: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', paddingHorizontal: spacing.lg, paddingBottom: spacing.lg,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: typography.md, fontWeight: '800' },
  shopName: { fontSize: typography.lg, fontWeight: '800', color: colors.text },
  shopStatus: { fontSize: typography.sm, color: colors.textSecondary, marginTop: 2 },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: spacing.md, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { fontSize: typography.xs, color: colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: colors.primary, fontWeight: '800' },

  // Commandes
  orderCard: { backgroundColor: '#fff', borderRadius: 14, padding: spacing.md, marginBottom: spacing.md, elevation: 2 },
  orderCardPending: { borderWidth: 2, borderColor: '#FF9800', backgroundColor: '#FFFDE7' },
  newBadge: { backgroundColor: '#FF9800', borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: 4, alignSelf: 'flex-start', marginBottom: spacing.sm },
  newBadgeText: { color: '#fff', fontWeight: '800', fontSize: typography.xs },
  orderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  orderCustomer: { fontSize: typography.md, fontWeight: '800', color: colors.text, flex: 1 },
  statusBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  statusBadgePending: { backgroundColor: '#FFF3E0' },
  statusBadgeText: { fontSize: typography.xs, color: colors.primary, fontWeight: '700' },
  orderPhone: { fontSize: typography.sm, color: colors.textSecondary },
  orderAddress: { fontSize: typography.sm, color: colors.textSecondary, marginTop: 2 },
  orderItemsList: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  orderItemLine: { fontSize: typography.sm, color: colors.text, marginBottom: 2 },
  orderTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  orderTotalLabel: { fontSize: typography.xs, color: colors.textSecondary, flex: 1 },
  orderTotal: { fontSize: typography.lg, fontWeight: '900', color: colors.primary },
  orderAction: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: 10, alignItems: 'center', marginTop: spacing.md },
  orderActionPending: { backgroundColor: '#FF9800' },
  orderActionText: { color: '#fff', fontWeight: '700' },

  // Produits
  addBtn: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: 10, alignItems: 'center', marginBottom: spacing.md },
  addBtnText: { color: '#fff', fontWeight: '700' },
  form: { backgroundColor: '#fff', padding: spacing.md, borderRadius: 12, marginBottom: spacing.md },
  formLabel: { fontSize: typography.sm, fontWeight: '600', color: colors.text, marginBottom: spacing.xs, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.background, padding: spacing.md, borderRadius: 10,
    fontSize: typography.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xs,
  },
  imagePickerBtn: {
    width: '100%', height: 140, borderRadius: 12, overflow: 'hidden',
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    borderStyle: 'dashed', marginBottom: spacing.sm,
  },
  imagePreview: { width: '100%', height: '100%' },
  imagePlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  imagePlaceholderIcon: { fontSize: 32, marginBottom: spacing.xs },
  imagePlaceholderText: { fontSize: typography.sm, color: colors.textSecondary },
  saveBtn: { backgroundColor: colors.secondary, padding: spacing.md, borderRadius: 10, alignItems: 'center', marginTop: spacing.sm },
  saveBtnText: { color: colors.primaryDark, fontWeight: '800' },
  productCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: spacing.md, marginBottom: spacing.sm },
  productImage: { width: 64, height: 64, borderRadius: 10 },
  productImagePlaceholder: { width: 64, height: 64, borderRadius: 10, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  productName: { fontSize: typography.md, fontWeight: '700', color: colors.text },
  productMeta: { fontSize: typography.sm, color: colors.primary, marginTop: 2, fontWeight: '600' },
  productDesc: { fontSize: typography.xs, color: colors.textSecondary, marginTop: 2 },
  productActions: { alignItems: 'center' },

  // Horaires
  hoursTitle: { fontSize: typography.lg, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  hoursSubtitle: { fontSize: typography.sm, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 18 },
  dayRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderRadius: 12, padding: spacing.md, marginBottom: spacing.sm,
  },
  dayLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  dayLabel: { fontSize: typography.sm, fontWeight: '700', color: colors.text, width: 80 },
  dayClosed: { fontSize: typography.sm, color: colors.error, fontWeight: '600' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  timeBtn: { backgroundColor: '#E8F5E9', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 8, borderWidth: 1, borderColor: colors.primary },
  timeBtnText: { fontSize: typography.sm, fontWeight: '700', color: colors.primary },
  timeSep: { fontSize: typography.sm, color: colors.textSecondary },
  saveHoursBtn: { backgroundColor: colors.primary, padding: spacing.md + 2, borderRadius: 12, alignItems: 'center', marginTop: spacing.lg },
  saveHoursBtnText: { color: '#fff', fontWeight: '800', fontSize: typography.md },

  // Modal heure
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalBox: { backgroundColor: '#fff', borderRadius: 16, padding: spacing.xl, width: '80%' },
  modalTitle: { fontSize: typography.lg, fontWeight: '800', color: colors.text, marginBottom: spacing.lg, textAlign: 'center' },
  timeInput: {
    backgroundColor: colors.background, padding: spacing.md, borderRadius: 10,
    fontSize: 28, fontWeight: '800', color: colors.primary, textAlign: 'center',
    borderWidth: 2, borderColor: colors.primary, letterSpacing: 4,
  },
  modalHint: { fontSize: typography.xs, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
  modalButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  modalCancelBtn: { flex: 1, padding: spacing.md, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  modalCancelText: { color: colors.text, fontWeight: '600' },
  modalConfirmBtn: { flex: 1, padding: spacing.md, borderRadius: 10, alignItems: 'center', backgroundColor: colors.primary },
  modalConfirmText: { color: '#fff', fontWeight: '800' },

  retryBtn: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: 10, marginTop: spacing.lg },
  retryBtnText: { color: '#fff', fontWeight: '700' },
  logoutBtn: { borderWidth: 1, borderColor: colors.error, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: 10, marginTop: spacing.md },
  logoutBtnText: { color: colors.error, fontWeight: '700' },
});
