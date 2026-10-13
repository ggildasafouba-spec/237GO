import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import * as Location from 'expo-location';
import { useCarpoolStore } from '../store/carpoolStore';
import { useAuthStore } from '../store/authStore';
import EscrowActions from '../components/EscrowActions';
import { colors, spacing, typography } from '../theme';

// Coordonnées connues des grandes villes camerounaises (fallback si géocodage indispo)
const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  douala: { lat: 4.0511, lng: 9.7679 },
  yaounde: { lat: 3.848, lng: 11.5021 },
  'yaoundé': { lat: 3.848, lng: 11.5021 },
  bafoussam: { lat: 5.4781, lng: 10.4176 },
  kribi: { lat: 2.9391, lng: 9.9073 },
  limbe: { lat: 4.0186, lng: 9.2042 },
  'limbé': { lat: 4.0186, lng: 9.2042 },
  bamenda: { lat: 5.9597, lng: 10.1459 },
  garoua: { lat: 9.3017, lng: 13.3921 },
  maroua: { lat: 10.591, lng: 14.3159 },
  ngaoundere: { lat: 7.3167, lng: 13.5833 },
  bertoua: { lat: 4.5775, lng: 13.6846 },
  ebolowa: { lat: 2.9, lng: 11.15 },
  buea: { lat: 4.1537, lng: 9.2920 },
};

// Résout les coordonnées d'une ville : table locale, sinon géocodage OSM
async function resolveCity(city: string, fallback: { lat: number; lng: number }): Promise<{ lat: number; lng: number }> {
  const key = city.trim().toLowerCase();
  if (CITY_COORDS[key]) return CITY_COORDS[key];
  try {
    const r = await Location.geocodeAsync(`${city}, Cameroun`);
    if (r && r.length) return { lat: r[0].latitude, lng: r[0].longitude };
  } catch {
    // ignore
  }
  return fallback;
}

const popularRoutes = [
  { from: 'Douala', to: 'Yaoundé' },
  { from: 'Douala', to: 'Bafoussam' },
  { from: 'Yaoundé', to: 'Douala' },
  { from: 'Douala', to: 'Kribi' },
  { from: 'Yaoundé', to: 'Bafoussam' },
  { from: 'Douala', to: 'Limbé' },
];

export default function CarpoolScreen({ navigation }: { navigation: any }) {
  type CarpoolView = 'search' | 'results' | 'publish' | 'my-trips';
  const [view, setView] = useState<CarpoolView>('search');
  const [departureCity, setDepartureCity] = useState('');
  const [arrivalCity, setArrivalCity] = useState('');
  const [date, setDate] = useState('');
  const [seats, setSeats] = useState('1');

  // Publish form
  const [pubDeparture, setPubDeparture] = useState('');
  const [pubDepartureAddr, setPubDepartureAddr] = useState('');
  const [pubArrival, setPubArrival] = useState('');
  const [pubArrivalAddr, setPubArrivalAddr] = useState('');
  const [pubDate, setPubDate] = useState('');
  const [pubTime, setPubTime] = useState('');
  const [pubSeats, setPubSeats] = useState('4');
  const [pubPrice, setPubPrice] = useState('');
  const [pubDesc, setPubDesc] = useState('');

  const { user } = useAuthStore();
  const {
    searchResults,
    myTrips,
    myBookings,
    isLoading,
    searchCarpools,
    createCarpool,
    bookCarpool,
    fetchMyTrips,
    fetchMyBookings,
  } = useCarpoolStore();

  const handleSearch = async () => {
    if (!departureCity || !arrivalCity) {
      Alert.alert('Attention', 'Entrez les villes de départ et d\'arrivée');
      return;
    }
    await searchCarpools({ departureCity, arrivalCity, date, seats: parseInt(seats) });
    setView('results');
  };

  const handleBook = async (carpoolId: string, pricePerSeat: number) => {
    const numSeats = parseInt(seats) || 1;
    Alert.alert(
      'Confirmer la réservation',
      `${numSeats} place(s) × ${pricePerSeat.toLocaleString()} XAF = ${(numSeats * pricePerSeat).toLocaleString()} XAF`,
      [
        { text: 'Annuler' },
        {
          text: 'Réserver',
          onPress: async () => {
            try {
              await bookCarpool(carpoolId, numSeats);
              Alert.alert('✅ Réservé !', 'Votre place est confirmée. Le chauffeur vous contactera.');
            } catch {
              Alert.alert('Erreur', 'Impossible de réserver');
            }
          },
        },
      ]
    );
  };

  const handlePublish = async () => {
    if (!pubDeparture || !pubArrival || !pubDate || !pubTime || !pubPrice) {
      Alert.alert('Attention', 'Veuillez remplir tous les champs obligatoires');
      return;
    }

    try {
      // Résoudre les vraies coordonnées des villes de départ et d'arrivée
      const dep = await resolveCity(pubDeparture, { lat: 4.0511, lng: 9.7679 });
      const arr = await resolveCity(pubArrival, { lat: 3.848, lng: 11.5021 });
      await createCarpool({
        departureLat: dep.lat,
        departureLng: dep.lng,
        departureCity: pubDeparture,
        departureAddress: pubDepartureAddr || pubDeparture,
        arrivalLat: arr.lat,
        arrivalLng: arr.lng,
        arrivalCity: pubArrival,
        arrivalAddress: pubArrivalAddr || pubArrival,
        departureTime: `${pubDate}T${pubTime}:00`,
        availableSeats: parseInt(pubSeats),
        pricePerSeat: parseFloat(pubPrice),
        description: pubDesc || undefined,
      });
      Alert.alert('✅ Trajet publié !', 'Les passagers peuvent maintenant réserver.');
      setView('search');
    } catch {
      Alert.alert('Erreur', 'Impossible de publier le trajet');
    }
  };

  // Vue: Recherche
  if (view === 'search') {
    const current: string = view;
    return (
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Retour</Text>
        </TouchableOpacity>

        <Text style={styles.title}>🚌 GO Share</Text>
        <Text style={styles.subtitle}>Covoiturage inter-villes</Text>

        {/* Tabs */}
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, current === 'search' && styles.tabActive]}
            onPress={() => setView('search')}
          >
            <Text style={[styles.tabText, current === 'search' && styles.tabTextActive]}>Rechercher</Text>
          </TouchableOpacity>
          {user?.role === 'DRIVER' && (
            <TouchableOpacity
              style={[styles.tab, current === 'publish' && styles.tabActive]}
              onPress={() => setView('publish')}
            >
              <Text style={[styles.tabText, current === 'publish' && styles.tabTextActive]}>Publier</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.tab, current === 'my-trips' && styles.tabActive]}
            onPress={() => { fetchMyBookings(); setView('my-trips'); }}
          >
            <Text style={[styles.tabText, current === 'my-trips' && styles.tabTextActive]}>Mes trajets</Text>
          </TouchableOpacity>
        </View>

        {/* Formulaire de recherche */}
        <View style={styles.searchForm}>
          <TextInput
            style={styles.input}
            placeholder="🏙️ Ville de départ"
            value={departureCity}
            onChangeText={setDepartureCity}
            placeholderTextColor={colors.textLight}
            accessibilityLabel="Ville de départ"
          />
          <TextInput
            style={styles.input}
            placeholder="🏙️ Ville d'arrivée"
            value={arrivalCity}
            onChangeText={setArrivalCity}
            placeholderTextColor={colors.textLight}
            accessibilityLabel="Ville d'arrivée"
          />
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1, marginRight: spacing.sm }]}
              placeholder="📅 Date (YYYY-MM-DD)"
              value={date}
              onChangeText={setDate}
              placeholderTextColor={colors.textLight}
              accessibilityLabel="Date du trajet"
            />
            <TextInput
              style={[styles.input, { width: 80 }]}
              placeholder="👥 Places"
              value={seats}
              onChangeText={setSeats}
              keyboardType="numeric"
              placeholderTextColor={colors.textLight}
              accessibilityLabel="Nombre de places"
            />
          </View>

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleSearch}
            disabled={isLoading}
            accessibilityRole="button"
          >
            {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Rechercher</Text>}
          </TouchableOpacity>
        </View>

        {/* Trajets populaires */}
        <Text style={styles.sectionTitle}>Trajets populaires</Text>
        <View style={styles.popularGrid}>
          {popularRoutes.map((route, index) => (
            <TouchableOpacity
              key={index}
              style={styles.popularCard}
              onPress={() => { setDepartureCity(route.from); setArrivalCity(route.to); }}
              accessibilityLabel={`${route.from} vers ${route.to}`}
            >
              <Text style={styles.popularFrom}>{route.from}</Text>
              <Text style={styles.popularArrow}>→</Text>
              <Text style={styles.popularTo}>{route.to}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    );
  }

  // Vue: Résultats de recherche
  if (view === 'results') {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => setView('search')} style={styles.backBtn}>
          <Text style={styles.backText}>← Nouvelle recherche</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{departureCity} → {arrivalCity}</Text>
        <Text style={styles.subtitle}>{searchResults.length} trajet(s) trouvé(s)</Text>

        <FlatList
          data={searchResults}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🚌</Text>
              <Text style={styles.emptyText}>Aucun trajet trouvé pour cette date</Text>
              <Text style={styles.emptyHint}>Essayez une autre date ou publiez votre trajet</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.resultCard}>
              <View style={styles.resultHeader}>
                <View>
                  <Text style={styles.resultRoute}>{item.departureCity} → {item.arrivalCity}</Text>
                  <Text style={styles.resultTime}>
                    🕐 {new Date(item.departureTime).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
                  </Text>
                </View>
                <Text style={styles.resultPrice}>{item.pricePerSeat.toLocaleString()} F/place</Text>
              </View>

              <View style={styles.resultDetails}>
                <Text style={styles.resultDetail}>📍 {item.departureAddress}</Text>
                <Text style={styles.resultDetail}>🏁 {item.arrivalAddress}</Text>
                <Text style={styles.resultDetail}>👥 {item.availableSeats} place(s) dispo</Text>
              </View>

              <View style={styles.resultDriver}>
                <Text style={styles.driverName}>{item.driver.firstName} {item.driver.lastName}</Text>
                {item.driver.driverProfile && (
                  <Text style={styles.driverRating}>
                    ⭐ {item.driver.driverProfile.averageRating.toFixed(1)} • {item.driver.driverProfile.totalTrips} trajets
                  </Text>
                )}
              </View>

              {item.description && <Text style={styles.resultDesc}>💬 {item.description}</Text>}

              <TouchableOpacity
                style={styles.bookButton}
                onPress={() => handleBook(item.id, item.pricePerSeat)}
                accessibilityRole="button"
                accessibilityLabel={`Réserver pour ${item.pricePerSeat} francs par place`}
              >
                <Text style={styles.bookButtonText}>Réserver {parseInt(seats)} place(s)</Text>
              </TouchableOpacity>

              {item.driver?.id && (
                <TouchableOpacity
                  style={styles.chatButton}
                  onPress={() => navigation.navigate('Chat', {
                    serviceType: 'CARPOOL',
                    serviceId: item.id,
                    interlocutor: { id: item.driver.id, firstName: item.driver.firstName, lastName: item.driver.lastName },
                  })}
                  accessibilityRole="button"
                >
                  <Text style={styles.chatButtonText}>💬 Contacter le conducteur</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        />
      </View>
    );
  }

  // Vue: Publier un trajet
  if (view === 'publish') {
    return (
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => setView('search')} style={styles.backBtn}>
          <Text style={styles.backText}>← Retour</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Publier un trajet</Text>
        <Text style={styles.subtitle}>Proposez des places à des passagers</Text>

        <TextInput
          style={styles.input}
          placeholder="Ville de départ"
          value={pubDeparture}
          onChangeText={setPubDeparture}
          placeholderTextColor={colors.textLight}
        />
        <TextInput
          style={styles.input}
          placeholder="Adresse précise de départ"
          value={pubDepartureAddr}
          onChangeText={setPubDepartureAddr}
          placeholderTextColor={colors.textLight}
        />
        <TextInput
          style={styles.input}
          placeholder="Ville d'arrivée"
          value={pubArrival}
          onChangeText={setPubArrival}
          placeholderTextColor={colors.textLight}
        />
        <TextInput
          style={styles.input}
          placeholder="Adresse précise d'arrivée"
          value={pubArrivalAddr}
          onChangeText={setPubArrivalAddr}
          placeholderTextColor={colors.textLight}
        />
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1, marginRight: spacing.sm }]}
            placeholder="Date (YYYY-MM-DD)"
            value={pubDate}
            onChangeText={setPubDate}
            placeholderTextColor={colors.textLight}
          />
          <TextInput
            style={[styles.input, { width: 100 }]}
            placeholder="Heure (HH:MM)"
            value={pubTime}
            onChangeText={setPubTime}
            placeholderTextColor={colors.textLight}
          />
        </View>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1, marginRight: spacing.sm }]}
            placeholder="Places disponibles"
            value={pubSeats}
            onChangeText={setPubSeats}
            keyboardType="numeric"
            placeholderTextColor={colors.textLight}
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Prix/place (XAF)"
            value={pubPrice}
            onChangeText={setPubPrice}
            keyboardType="numeric"
            placeholderTextColor={colors.textLight}
          />
        </View>
        <TextInput
          style={[styles.input, { height: 80 }]}
          placeholder="Description (optionnel): climatisation, bagages autorisés..."
          value={pubDesc}
          onChangeText={setPubDesc}
          multiline
          placeholderTextColor={colors.textLight}
        />

        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handlePublish}
          disabled={isLoading}
          accessibilityRole="button"
        >
          {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Publier le trajet</Text>}
        </TouchableOpacity>

        <View style={{ height: 100 }} />
      </ScrollView>
    );
  }

  // Vue: Mes trajets / réservations
  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => setView('search')} style={styles.backBtn}>
        <Text style={styles.backText}>← Rechercher</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Mes réservations</Text>

      <FlatList
        data={myBookings}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🎫</Text>
            <Text style={styles.emptyText}>Aucune réservation</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.bookingCard}>
            <Text style={styles.bookingRoute}>
              {item.carpool.departureCity} → {item.carpool.arrivalCity}
            </Text>
            <Text style={styles.bookingDate}>
              {new Date(item.carpool.departureTime).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
            </Text>
            <Text style={styles.bookingSeats}>{item.seats} place(s)</Text>
            <View style={[styles.statusBadge, { backgroundColor: item.status === 'CONFIRMED' ? '#E8F5E9' : '#FFF8E1' }]}>
              <Text style={{ color: item.status === 'CONFIRMED' ? colors.success : colors.warning, fontWeight: '600', fontSize: 12 }}>
                {item.status === 'CONFIRMED' ? '✅ Confirmé' : '⏳ En attente'}
              </Text>
            </View>

            {/* Actions escrow : confirmer l'arrivée pour libérer le paiement au chauffeur */}
            {item.status === 'CONFIRMED' && (
              <EscrowActions
                serviceType="carpool"
                serviceId={item.carpool.id}
                amount={item.seats * item.carpool.pricePerSeat}
                onDone={fetchMyBookings}
              />
            )}
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
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 4, marginBottom: spacing.lg },
  tab: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: typography.sm, color: colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  searchForm: { marginBottom: spacing.lg },
  input: {
    backgroundColor: '#fff', padding: spacing.md, borderRadius: 12,
    fontSize: typography.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  row: { flexDirection: 'row' },
  button: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: 12, alignItems: 'center', marginTop: spacing.sm },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: typography.md, fontWeight: '700' },
  sectionTitle: { fontSize: typography.lg, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  popularGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  popularCard: {
    width: '48%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    padding: spacing.md, backgroundColor: '#fff', borderRadius: 10, marginBottom: spacing.sm,
  },
  popularFrom: { fontSize: typography.sm, fontWeight: '600', color: colors.text },
  popularArrow: { marginHorizontal: 6, color: colors.primary, fontWeight: '700' },
  popularTo: { fontSize: typography.sm, fontWeight: '600', color: colors.text },
  resultCard: { backgroundColor: '#fff', padding: spacing.lg, borderRadius: 12, marginBottom: spacing.md, elevation: 2 },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  resultRoute: { fontSize: typography.md, fontWeight: '700', color: colors.text },
  resultTime: { fontSize: typography.sm, color: colors.textSecondary, marginTop: 4 },
  resultPrice: { fontSize: typography.lg, fontWeight: '800', color: colors.primary },
  resultDetails: { marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  resultDetail: { fontSize: typography.sm, color: colors.textSecondary, marginBottom: 2 },
  resultDriver: { marginTop: spacing.md },
  driverName: { fontSize: typography.sm, fontWeight: '600', color: colors.text },
  driverRating: { fontSize: typography.xs, color: colors.textSecondary },
  resultDesc: { fontSize: typography.sm, color: colors.textSecondary, fontStyle: 'italic', marginTop: spacing.sm },
  bookButton: { backgroundColor: colors.primary, padding: spacing.sm + 2, borderRadius: 10, alignItems: 'center', marginTop: spacing.md },
  bookButtonText: { color: '#fff', fontWeight: '700' },
  chatButton: { paddingVertical: spacing.sm, borderRadius: 10, alignItems: 'center', marginTop: spacing.sm, borderWidth: 1, borderColor: colors.primary, backgroundColor: '#E8F5E9' },
  chatButtonText: { color: colors.primary, fontWeight: '700', fontSize: typography.sm },
  emptyState: { alignItems: 'center', marginTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyText: { fontSize: typography.md, color: colors.textSecondary },
  emptyHint: { fontSize: typography.sm, color: colors.textLight, marginTop: 4 },
  bookingCard: { backgroundColor: '#fff', padding: spacing.lg, borderRadius: 12, marginBottom: spacing.sm },
  bookingRoute: { fontSize: typography.md, fontWeight: '700', color: colors.text },
  bookingDate: { fontSize: typography.sm, color: colors.textSecondary, marginTop: 4 },
  bookingSeats: { fontSize: typography.sm, color: colors.primary, fontWeight: '600', marginTop: 2 },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, marginTop: spacing.sm },
});
