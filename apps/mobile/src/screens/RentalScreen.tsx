import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { useRentalStore } from '../store/rentalStore';
import { colors, spacing, typography } from '../theme';

type ViewMode = 'search' | 'detail' | 'book' | 'publish' | 'my-vehicles';

const vehicleTypes = [
  { id: 'all', name: 'Tous', icon: '🚘' },
  { id: 'MOTO', name: 'Moto', icon: '🏍️' },
  { id: 'CAR_ECONOMY', name: 'Éco', icon: '🚗' },
  { id: 'CAR_COMFORT', name: 'Confort', icon: '🚙' },
  { id: 'CAR_VIP', name: 'VIP', icon: '✨' },
  { id: 'TRUCK', name: 'Camion', icon: '🚛' },
];

const paymentMethods = [
  { id: 'ORANGE_MONEY', name: 'Orange Money', icon: '🟠' },
  { id: 'MTN_MOMO', name: 'MTN MoMo', icon: '🟡' },
  { id: 'CASH', name: 'Espèces', icon: '💵' },
  { id: 'WALLET', name: 'Portefeuille 237GO', icon: '👛' },
];

export default function RentalScreen({ navigation }: { navigation: any }) {
  const [view, setView] = useState<ViewMode>('search');
  const [filterType, setFilterType] = useState('all');
  const [withDriverFilter, setWithDriverFilter] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [withDriver, setWithDriver] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState('ORANGE_MONEY');

  // Publish form
  const [pubBrand, setPubBrand] = useState('');
  const [pubModel, setPubModel] = useState('');
  const [pubYear, setPubYear] = useState('');
  const [pubPlate, setPubPlate] = useState('');
  const [pubType, setPubType] = useState('CAR_ECONOMY');
  const [pubPrice, setPubPrice] = useState('');
  const [pubAddress, setPubAddress] = useState('');
  const [pubWithDriver, setPubWithDriver] = useState(false);

  const {
    vehicles,
    selectedVehicle,
    myVehicles,
    isLoading,
    searchVehicles,
    getVehicleDetails,
    publishVehicle,
    bookVehicle,
    fetchMyVehicles,
  } = useRentalStore();

  useEffect(() => {
    searchVehicles({ lat: 4.0511, lng: 9.7679 });
  }, []);

  const filteredVehicles = vehicles.filter((v) => {
    if (filterType !== 'all' && v.type !== filterType) return false;
    if (withDriverFilter && !v.withDriver) return false;
    return true;
  });

  const handleBook = async () => {
    if (!selectedVehicle || !startDate || !endDate) {
      Alert.alert('Attention', 'Veuillez remplir les dates');
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end <= start) {
      Alert.alert('Erreur', 'La date de fin doit être après la date de début');
      return;
    }

    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    let totalPrice = days * selectedVehicle.pricePerDay;
    if (withDriver && selectedVehicle.withDriver) totalPrice += days * 10000;

    Alert.alert(
      'Confirmer la réservation',
      `${days} jour(s) × ${selectedVehicle.pricePerDay.toLocaleString()} XAF${withDriver ? ' + chauffeur' : ''}\n\nTotal: ${totalPrice.toLocaleString()} XAF`,
      [
        { text: 'Annuler' },
        {
          text: 'Réserver',
          onPress: async () => {
            try {
              await bookVehicle({
                vehicleId: selectedVehicle.id,
                startDate,
                endDate,
                withDriver,
                paymentMethod: selectedPayment,
              });
              Alert.alert('✅ Réservation confirmée !', `Véhicule réservé pour ${days} jour(s).`);
              setView('search');
            } catch {
              Alert.alert('Erreur', 'Impossible de réserver');
            }
          },
        },
      ]
    );
  };

  const handlePublish = async () => {
    if (!pubBrand || !pubModel || !pubYear || !pubPlate || !pubPrice || !pubAddress) {
      Alert.alert('Attention', 'Veuillez remplir tous les champs obligatoires');
      return;
    }

    try {
      await publishVehicle({
        type: pubType,
        brand: pubBrand,
        model: pubModel,
        year: parseInt(pubYear),
        plate: pubPlate,
        pricePerDay: parseFloat(pubPrice),
        withDriver: pubWithDriver,
        locationLat: 4.0511,
        locationLng: 9.7679,
        locationAddress: pubAddress,
      });
      Alert.alert('✅ Véhicule publié !', 'Votre véhicule est maintenant visible sur GO Rent.');
      setView('search');
    } catch {
      Alert.alert('Erreur', 'Impossible de publier le véhicule');
    }
  };

  // Vue: Recherche
  if (view === 'search') {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Retour</Text>
        </TouchableOpacity>

        <Text style={styles.title}>🔑 GO Rent</Text>
        <Text style={styles.subtitle}>Location de véhicules</Text>

        {/* Tabs */}
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, styles.tabActive]}
            onPress={() => setView('search')}
          >
            <Text style={[styles.tabText, styles.tabTextActive]}>Louer</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tab}
            onPress={() => setView('publish')}
          >
            <Text style={styles.tabText}>Publier</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tab}
            onPress={() => { fetchMyVehicles(); setView('my-vehicles'); }}
          >
            <Text style={styles.tabText}>Mes véhicules</Text>
          </TouchableOpacity>
        </View>

        {/* Filtres */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersRow}>
          {vehicleTypes.map((type) => (
            <TouchableOpacity
              key={type.id}
              style={[styles.filterChip, filterType === type.id && styles.filterChipActive]}
              onPress={() => setFilterType(type.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: filterType === type.id }}
            >
              <Text style={styles.filterIcon}>{type.icon}</Text>
              <Text style={[styles.filterText, filterType === type.id && styles.filterTextActive]}>
                {type.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.driverFilterRow}>
          <Text style={styles.driverFilterLabel}>Avec chauffeur uniquement</Text>
          <Switch
            value={withDriverFilter}
            onValueChange={setWithDriverFilter}
            trackColor={{ false: '#ccc', true: colors.primaryLight }}
            thumbColor={withDriverFilter ? colors.primary : '#f4f3f4'}
          />
        </View>

        {/* Liste */}
        {isLoading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={filteredVehicles}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>🔑</Text>
                <Text style={styles.emptyText}>Aucun véhicule disponible</Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.vehicleCard}
                onPress={() => { getVehicleDetails(item.id); setView('detail'); }}
                accessibilityLabel={`${item.brand} ${item.model} ${item.year}, ${item.pricePerDay.toLocaleString()} francs par jour`}
              >
                <View style={styles.vehicleCardHeader}>
                  <Text style={styles.vehicleEmoji}>
                    {item.type === 'MOTO' ? '🏍️' : item.type === 'TRUCK' ? '🚛' : '🚗'}
                  </Text>
                  <View style={styles.vehicleCardInfo}>
                    <Text style={styles.vehicleCardName}>{item.brand} {item.model}</Text>
                    <Text style={styles.vehicleCardMeta}>
                      {item.year} • {item.plate} {item.color ? `• ${item.color}` : ''}
                    </Text>
                    <Text style={styles.vehicleCardLocation}>📍 {item.locationAddress}</Text>
                  </View>
                </View>
                <View style={styles.vehicleCardFooter}>
                  <View style={styles.vehicleFeatures}>
                    {item.withDriver && (
                      <View style={styles.featureBadge}>
                        <Text style={styles.featureBadgeText}>👨‍✈️ Chauffeur</Text>
                      </View>
                    )}
                    {item.seats && (
                      <View style={styles.featureBadge}>
                        <Text style={styles.featureBadgeText}>👥 {item.seats} places</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.vehicleCardPrice}>{item.pricePerDay.toLocaleString()} XAF/jour</Text>
                </View>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    );
  }

  // Vue: Détail véhicule
  if (view === 'detail' && selectedVehicle) {
    return (
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => setView('search')} style={styles.backBtn}>
          <Text style={styles.backText}>← Véhicules</Text>
        </TouchableOpacity>

        <View style={styles.detailHeader}>
          <Text style={styles.detailEmoji}>
            {selectedVehicle.type === 'MOTO' ? '🏍️' : selectedVehicle.type === 'TRUCK' ? '🚛' : '🚗'}
          </Text>
          <Text style={styles.detailTitle}>{selectedVehicle.brand} {selectedVehicle.model}</Text>
          <Text style={styles.detailYear}>{selectedVehicle.year} • {selectedVehicle.color || ''}</Text>
        </View>

        <View style={styles.detailCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Plaque</Text>
            <Text style={styles.detailValue}>{selectedVehicle.plate}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Places</Text>
            <Text style={styles.detailValue}>{selectedVehicle.seats || 'N/A'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Localisation</Text>
            <Text style={styles.detailValue}>{selectedVehicle.locationAddress}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Chauffeur disponible</Text>
            <Text style={styles.detailValue}>{selectedVehicle.withDriver ? '✅ Oui' : '❌ Non'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Propriétaire</Text>
            <Text style={styles.detailValue}>
              {selectedVehicle.owner.firstName} {selectedVehicle.owner.lastName}
            </Text>
          </View>
        </View>

        <View style={styles.pricingCard}>
          <Text style={styles.pricingTitle}>Tarifs</Text>
          <View style={styles.pricingRow}>
            <Text style={styles.pricingLabel}>Par jour</Text>
            <Text style={styles.pricingValue}>{selectedVehicle.pricePerDay.toLocaleString()} XAF</Text>
          </View>
          {selectedVehicle.pricePerHour && (
            <View style={styles.pricingRow}>
              <Text style={styles.pricingLabel}>Par heure</Text>
              <Text style={styles.pricingValue}>{selectedVehicle.pricePerHour.toLocaleString()} XAF</Text>
            </View>
          )}
          {selectedVehicle.withDriver && (
            <View style={styles.pricingRow}>
              <Text style={styles.pricingLabel}>Chauffeur/jour</Text>
              <Text style={styles.pricingValue}>10,000 XAF</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={styles.button}
          onPress={() => setView('book')}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Réserver ce véhicule</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // Vue: Réservation
  if (view === 'book' && selectedVehicle) {
    const days = startDate && endDate
      ? Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    const totalPrice = days > 0
      ? days * selectedVehicle.pricePerDay + (withDriver ? days * 10000 : 0)
      : 0;

    return (
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => setView('detail')} style={styles.backBtn}>
          <Text style={styles.backText}>← Détails</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Réserver</Text>
        <Text style={styles.subtitle}>
          {selectedVehicle.brand} {selectedVehicle.model} • {selectedVehicle.pricePerDay.toLocaleString()} XAF/jour
        </Text>

        <Text style={styles.sectionLabel}>Dates</Text>
        <TextInput
          style={styles.input}
          placeholder="Date de début (YYYY-MM-DD)"
          value={startDate}
          onChangeText={setStartDate}
          placeholderTextColor={colors.textLight}
          accessibilityLabel="Date de début de location"
        />
        <TextInput
          style={styles.input}
          placeholder="Date de fin (YYYY-MM-DD)"
          value={endDate}
          onChangeText={setEndDate}
          placeholderTextColor={colors.textLight}
          accessibilityLabel="Date de fin de location"
        />

        {selectedVehicle.withDriver && (
          <View style={styles.driverOption}>
            <View>
              <Text style={styles.driverOptionLabel}>Avec chauffeur</Text>
              <Text style={styles.driverOptionPrice}>+10,000 XAF/jour</Text>
            </View>
            <Switch
              value={withDriver}
              onValueChange={setWithDriver}
              trackColor={{ false: '#ccc', true: colors.primaryLight }}
              thumbColor={withDriver ? colors.primary : '#f4f3f4'}
            />
          </View>
        )}

        {days > 0 && (
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>{days} jour(s) de location</Text>
            <Text style={styles.totalPrice}>{totalPrice.toLocaleString()} XAF</Text>
          </View>
        )}

        <Text style={styles.sectionLabel}>Paiement</Text>
        {paymentMethods.map((method) => (
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

        <TouchableOpacity
          style={[styles.button, (days <= 0 || isLoading) && styles.buttonDisabled]}
          onPress={handleBook}
          disabled={days <= 0 || isLoading}
          accessibilityRole="button"
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Confirmer la réservation</Text>
          )}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // Vue: Publier un véhicule
  if (view === 'publish') {
    return (
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => setView('search')} style={styles.backBtn}>
          <Text style={styles.backText}>← Retour</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Publier un véhicule</Text>
        <Text style={styles.subtitle}>Mettez votre véhicule en location sur GO Fleet</Text>

        <Text style={styles.sectionLabel}>Type de véhicule</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersRow}>
          {vehicleTypes.filter((t) => t.id !== 'all').map((type) => (
            <TouchableOpacity
              key={type.id}
              style={[styles.filterChip, pubType === type.id && styles.filterChipActive]}
              onPress={() => setPubType(type.id)}
            >
              <Text style={styles.filterIcon}>{type.icon}</Text>
              <Text style={[styles.filterText, pubType === type.id && styles.filterTextActive]}>
                {type.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.sectionLabel}>Informations du véhicule</Text>
        <TextInput
          style={styles.input}
          placeholder="Marque (ex: Toyota)"
          value={pubBrand}
          onChangeText={setPubBrand}
          placeholderTextColor={colors.textLight}
        />
        <TextInput
          style={styles.input}
          placeholder="Modèle (ex: Corolla)"
          value={pubModel}
          onChangeText={setPubModel}
          placeholderTextColor={colors.textLight}
        />
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1, marginRight: spacing.sm }]}
            placeholder="Année"
            value={pubYear}
            onChangeText={setPubYear}
            keyboardType="numeric"
            placeholderTextColor={colors.textLight}
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Plaque"
            value={pubPlate}
            onChangeText={setPubPlate}
            placeholderTextColor={colors.textLight}
          />
        </View>

        <Text style={styles.sectionLabel}>Tarification</Text>
        <TextInput
          style={styles.input}
          placeholder="Prix par jour (XAF)"
          value={pubPrice}
          onChangeText={setPubPrice}
          keyboardType="numeric"
          placeholderTextColor={colors.textLight}
        />

        <View style={styles.driverOption}>
          <Text style={styles.driverOptionLabel}>Je propose un chauffeur</Text>
          <Switch
            value={pubWithDriver}
            onValueChange={setPubWithDriver}
            trackColor={{ false: '#ccc', true: colors.primaryLight }}
            thumbColor={pubWithDriver ? colors.primary : '#f4f3f4'}
          />
        </View>

        <Text style={styles.sectionLabel}>Localisation du véhicule</Text>
        <TextInput
          style={styles.input}
          placeholder="Adresse où récupérer le véhicule"
          value={pubAddress}
          onChangeText={setPubAddress}
          placeholderTextColor={colors.textLight}
        />

        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handlePublish}
          disabled={isLoading}
          accessibilityRole="button"
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Publier le véhicule 🔑</Text>
          )}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // Vue: Mes véhicules
  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => setView('search')} style={styles.backBtn}>
        <Text style={styles.backText}>← Retour</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Mes véhicules</Text>

      <FlatList
        data={myVehicles}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🚗</Text>
            <Text style={styles.emptyText}>Vous n'avez aucun véhicule en location</Text>
            <TouchableOpacity style={styles.button} onPress={() => setView('publish')}>
              <Text style={styles.buttonText}>+ Publier un véhicule</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.vehicleCard}>
            <View style={styles.vehicleCardHeader}>
              <Text style={styles.vehicleEmoji}>🚗</Text>
              <View style={styles.vehicleCardInfo}>
                <Text style={styles.vehicleCardName}>{item.brand} {item.model}</Text>
                <Text style={styles.vehicleCardMeta}>{item.year} • {item.plate}</Text>
              </View>
            </View>
            <View style={styles.vehicleCardFooter}>
              <View style={[styles.featureBadge, { backgroundColor: item.isAvailable ? '#E8F5E9' : '#FFEBEE' }]}>
                <Text style={{ color: item.isAvailable ? colors.success : colors.error, fontSize: 11, fontWeight: '600' }}>
                  {item.isAvailable ? '✅ Disponible' : '🔒 Loué'}
                </Text>
              </View>
              <Text style={styles.vehicleCardPrice}>{item.pricePerDay.toLocaleString()} XAF/j</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, paddingTop: spacing.xl + 20 },
  backBtn: { marginBottom: spacing.md },
  backText: { color: colors.primary, fontSize: typography.md, fontWeight: '600' },
  title: { fontSize: typography.xl, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: typography.sm, color: colors.textSecondary, marginBottom: spacing.md },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 4, marginBottom: spacing.md },
  tab: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: typography.sm, color: colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  filtersRow: { marginBottom: spacing.md, maxHeight: 50 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: '#fff', borderRadius: 20, marginRight: 8, borderWidth: 1, borderColor: colors.border,
  },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterIcon: { fontSize: 16, marginRight: 4 },
  filterText: { fontSize: typography.xs, color: colors.text, fontWeight: '500' },
  filterTextActive: { color: '#fff' },
  driverFilterRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#fff', padding: spacing.md, borderRadius: 10, marginBottom: spacing.md,
  },
  driverFilterLabel: { fontSize: typography.sm, color: colors.text },
  vehicleCard: { backgroundColor: '#fff', padding: spacing.lg, borderRadius: 12, marginBottom: spacing.sm, elevation: 2 },
  vehicleCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  vehicleEmoji: { fontSize: 36, marginRight: spacing.md },
  vehicleCardInfo: { flex: 1 },
  vehicleCardName: { fontSize: typography.md, fontWeight: '700', color: colors.text },
  vehicleCardMeta: { fontSize: typography.xs, color: colors.textSecondary, marginTop: 2 },
  vehicleCardLocation: { fontSize: typography.xs, color: colors.primary, marginTop: 2 },
  vehicleCardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  vehicleFeatures: { flexDirection: 'row' },
  featureBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginRight: 6 },
  featureBadgeText: { fontSize: 11, color: colors.primary, fontWeight: '600' },
  vehicleCardPrice: { fontSize: typography.md, fontWeight: '800', color: colors.primary },
  // Detail
  detailHeader: { alignItems: 'center', marginBottom: spacing.lg },
  detailEmoji: { fontSize: 56, marginBottom: spacing.sm },
  detailTitle: { fontSize: typography.xxl, fontWeight: '700', color: colors.text },
  detailYear: { fontSize: typography.sm, color: colors.textSecondary },
  detailCard: { backgroundColor: '#fff', padding: spacing.lg, borderRadius: 12, marginBottom: spacing.md },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailLabel: { fontSize: typography.sm, color: colors.textSecondary },
  detailValue: { fontSize: typography.sm, color: colors.text, fontWeight: '500', maxWidth: '55%', textAlign: 'right' },
  pricingCard: { backgroundColor: '#FFF8E1', padding: spacing.lg, borderRadius: 12, marginBottom: spacing.md },
  pricingTitle: { fontSize: typography.md, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  pricingRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  pricingLabel: { fontSize: typography.sm, color: colors.textSecondary },
  pricingValue: { fontSize: typography.sm, fontWeight: '700', color: colors.text },
  // Book
  sectionLabel: { fontSize: typography.md, fontWeight: '600', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  input: { backgroundColor: '#fff', padding: spacing.md, borderRadius: 12, fontSize: typography.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  row: { flexDirection: 'row' },
  driverOption: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#fff', padding: spacing.md, borderRadius: 12, marginBottom: spacing.md,
  },
  driverOptionLabel: { fontSize: typography.sm, color: colors.text, fontWeight: '500' },
  driverOptionPrice: { fontSize: typography.xs, color: colors.textSecondary },
  totalCard: {
    backgroundColor: '#E8F5E9', padding: spacing.lg, borderRadius: 12, alignItems: 'center', marginBottom: spacing.md,
  },
  totalLabel: { fontSize: typography.sm, color: colors.textSecondary },
  totalPrice: { fontSize: typography.xxl, fontWeight: '800', color: colors.primary, marginTop: 4 },
  paymentOption: {
    flexDirection: 'row', alignItems: 'center', padding: spacing.md,
    backgroundColor: '#fff', borderRadius: 8, marginBottom: spacing.xs, borderWidth: 1, borderColor: colors.border,
  },
  paymentSelected: { borderColor: colors.primary, backgroundColor: '#E8F5E9' },
  paymentIcon: { fontSize: 20, marginRight: spacing.sm },
  paymentName: { flex: 1, fontSize: typography.sm, color: colors.text },
  checkmark: { fontSize: typography.md, color: colors.primary, fontWeight: '700' },
  button: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: 12, alignItems: 'center', marginTop: spacing.lg },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: typography.md, fontWeight: '700' },
  emptyState: { alignItems: 'center', marginTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyText: { fontSize: typography.md, color: colors.textSecondary, marginBottom: spacing.lg },
});
