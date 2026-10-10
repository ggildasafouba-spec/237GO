import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import * as Location from 'expo-location';
import { useRideStore } from '../store/rideStore';
import { useLocation } from '../hooks/useLocation';
import RideMap from '../components/RideMap';
import DestinationPicker, { PickedPlace } from '../components/DestinationPicker';
import { colors, spacing, typography } from '../theme';

type VehicleType = 'MOTO' | 'CAR_ECONOMY' | 'CAR_COMFORT' | 'CAR_VIP';

interface VehicleOption {
  type: VehicleType;
  name: string;
  icon: string;
  description: string;
}

const vehicleOptions: VehicleOption[] = [
  { type: 'MOTO', name: 'Moto', icon: '🏍️', description: 'Rapide et économique' },
  { type: 'CAR_ECONOMY', name: 'Éco', icon: '🚗', description: 'Confortable et abordable' },
  { type: 'CAR_COMFORT', name: 'Confort', icon: '🚙', description: 'Plus d\'espace' },
  { type: 'CAR_VIP', name: 'VIP', icon: '✨', description: 'Expérience premium' },
];

type PaymentMethod = 'ORANGE_MONEY' | 'MTN_MOMO' | 'CASH' | 'WALLET';

const paymentMethods: { id: PaymentMethod; name: string; icon: string }[] = [
  { id: 'ORANGE_MONEY', name: 'Orange Money', icon: '🟠' },
  { id: 'MTN_MOMO', name: 'MTN MoMo', icon: '🟡' },
  { id: 'CASH', name: 'Espèces', icon: '💵' },
  { id: 'WALLET', name: 'Portefeuille 237GO', icon: '👛' },
];

export default function RideScreen({ navigation, route }: { navigation: any; route: any }) {
  const [step, setStep] = useState<'location' | 'vehicle' | 'confirm' | 'waiting' | 'inride'>('location');
  const [pickupAddress, setPickupAddress] = useState('');
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [landmark, setLandmark] = useState(''); // repère / indication complémentaire
  const [showDestPicker, setShowDestPicker] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleType>(route?.params?.vehicleType || 'MOTO');
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod>('ORANGE_MONEY');
  const [proposedPrice, setProposedPrice] = useState('');

  const {
    estimates,
    currentRide,
    isLoading,
    driverLocation,
    getAllEstimates,
    createRide,
    cancelRide,
    confirmArrival,
    openDispute,
    sendSOS,
    shareTrip,
    clearRide,
  } = useRideStore();

  const { getCurrentLocation, reverseGeocode } = useLocation();

  // Coordonnées réelles (remplies par le GPS / géocodage). Fallback Douala si indispo.
  const [pickupCoords, setPickupCoords] = useState({ lat: 4.0511, lng: 9.7679 });
  const [dropoffCoords, setDropoffCoords] = useState({ lat: 4.0611, lng: 9.7879 });
  const [locating, setLocating] = useState(false);

  const pickup = { lat: pickupCoords.lat, lng: pickupCoords.lng, address: pickupAddress };
  const dropoff = { lat: dropoffCoords.lat, lng: dropoffCoords.lng, address: dropoffAddress };

  // 1) GÉOLOCALISATION : récupérer la position réelle du passager au démarrage
  useEffect(() => {
    (async () => {
      setLocating(true);
      const loc = await getCurrentLocation();
      if (loc) {
        setPickupCoords({ lat: loc.latitude, lng: loc.longitude });
        const addr = await reverseGeocode(loc.latitude, loc.longitude);
        if (addr && !pickupAddress) setPickupAddress(addr);
      }
      setLocating(false);
    })();
  }, []);

  // Utiliser ma position actuelle pour le départ (bouton)
  const useMyLocation = async () => {
    setLocating(true);
    const loc = await getCurrentLocation();
    if (loc) {
      setPickupCoords({ lat: loc.latitude, lng: loc.longitude });
      const addr = await reverseGeocode(loc.latitude, loc.longitude);
      setPickupAddress(addr || `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`);
    } else {
      Alert.alert('Localisation', "Impossible d'obtenir votre position. Vérifiez que le GPS est activé.");
    }
    setLocating(false);
  };

  const [confirming, setConfirming] = useState(false);

  const handleConfirmArrival = async () => {
    if (!currentRide) return;
    setConfirming(true);
    try {
      const message = await confirmArrival(currentRide.id);
      const driverName = currentRide.driver ? `${currentRide.driver.firstName} ${currentRide.driver.lastName}` : undefined;
      Alert.alert('Course validée ✅', message, [
        { text: 'Évaluer', onPress: () => { navigation.navigate('Rating', { rideId: currentRide.id, driverName }); clearRide(); } },
        { text: 'Fermer', onPress: () => clearRide() },
      ]);
    } catch (error: any) {
      Alert.alert('Erreur', error?.response?.data?.message || 'Impossible de valider la course');
    } finally {
      setConfirming(false);
    }
  };

  const handleDispute = () => {
    if (!currentRide) return;
    Alert.prompt?.(
      'Signaler un problème',
      'Décrivez le problème rencontré :',
      async (reason?: string) => {
        if (!reason) return;
        try {
          await openDispute(currentRide.id, reason);
          Alert.alert('Litige ouvert', 'Un administrateur va examiner votre dossier. Le paiement reste bloqué en attendant.');
        } catch (error: any) {
          Alert.alert('Erreur', error?.response?.data?.message || 'Impossible d\'ouvrir le litige');
        }
      }
    );
    // Fallback Android (Alert.prompt n'existe pas) : litige avec motif générique
    if (!Alert.prompt) {
      Alert.alert('Signaler un problème', 'Confirmer l\'ouverture d\'un litige sur cette course ?', [
        { text: 'Annuler' },
        {
          text: 'Ouvrir le litige',
          style: 'destructive',
          onPress: async () => {
            try {
              await openDispute(currentRide.id, 'Problème signalé par le passager');
              Alert.alert('Litige ouvert', 'Un administrateur va examiner votre dossier.');
            } catch (error: any) {
              Alert.alert('Erreur', error?.response?.data?.message || 'Erreur');
            }
          },
        },
      ]);
    }
  };

  const handleSOS = () => {
    if (!currentRide) return;
    sendSOS(pickup.lat, pickup.lng, currentRide.id);
    Alert.alert('🚨 SOS envoyé', 'Alerte envoyée à vos contacts d\'urgence et à 237GO.');
  };

  const handleShare = () => {
    if (!currentRide) return;
    Alert.prompt?.(
      'Partager le trajet',
      'Numéro du contact (6XXXXXXXX) :',
      (phone?: string) => {
        if (phone && /^6[0-9]{8}$/.test(phone)) {
          shareTrip(currentRide.id, phone);
          Alert.alert('Partagé', 'Lien de suivi envoyé par SMS à votre contact.');
        } else if (phone) {
          Alert.alert('Numéro invalide', 'Format attendu : 6XXXXXXXX');
        }
      },
      'plain-text',
      '',
      'phone-pad'
    );
    if (!Alert.prompt) {
      Alert.alert('Partager', 'Le partage de trajet nécessite iOS. Fonctionnalité bientôt disponible sur Android.');
    }
  };

  // Destination choisie via la carte (épingle) ou la recherche OSM
  const onDestinationPicked = (place: PickedPlace) => {
    setDropoffCoords({ lat: place.lat, lng: place.lng });
    setDropoffAddress(place.label);
    setShowDestPicker(false);
  };

  const handleGetEstimates = async () => {
    if (!pickupAddress) {
      Alert.alert('Attention', 'Indiquez votre point de départ (ou utilisez votre position).');
      return;
    }
    if (!dropoffAddress) {
      Alert.alert('Attention', 'Choisissez votre destination sur la carte.');
      return;
    }
    // La destination vient déjà du sélecteur (coordonnées exactes) : pas de géocodage incertain
    await getAllEstimates(pickup, dropoff);
    setStep('vehicle');
  };

  const handleConfirmRide = async () => {
    try {
      // On joint le repère à l'adresse de destination pour qu'il parvienne au chauffeur
      const dropoffWithLandmark = landmark.trim()
        ? `${dropoffAddress} — Repère : ${landmark.trim()}`
        : dropoffAddress;
      await createRide({
        pickup: { ...pickup, address: pickupAddress },
        dropoff: { ...dropoff, address: dropoffWithLandmark },
        vehicleType: selectedVehicle,
        paymentMethod: selectedPayment,
        proposedPrice: proposedPrice ? parseFloat(proposedPrice) : undefined,
      });
      setStep('waiting');
    } catch {
      Alert.alert('Erreur', 'Impossible de créer la course. Réessayez.');
    }
  };

  const handleCancel = () => {
    if (currentRide) {
      Alert.alert('Annuler la course ?', 'Des frais d\'annulation peuvent s\'appliquer.', [
        { text: 'Non' },
        { text: 'Oui, annuler', style: 'destructive', onPress: () => cancelRide(currentRide.id) },
      ]);
    }
  };

  const selectedEstimate = estimates.find((e) => e.vehicleType === selectedVehicle);

  // 3) ETA : estimer le temps d'arrivée du chauffeur à partir de sa position temps réel
  const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  };

  const driverEta = (): { minutes: number; km: number } | null => {
    if (!driverLocation) return null;
    const km = haversineKm(driverLocation, pickupCoords);
    // Vitesse moyenne en ville ~22 km/h ; minimum 1 min
    const minutes = Math.max(1, Math.round((km / 22) * 60));
    return { minutes, km };
  };

  const eta = driverEta();

  // Step: Entrer les adresses
  if (step === 'location') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Où allez-vous ?</Text>

        {/* Carte avec la position du passager */}
        <RideMap pickup={pickupCoords} height={180} />

        <View style={styles.inputContainer}>
          <View style={styles.dotGreen} />
          <TextInput
            style={styles.input}
            placeholder="📍 Point de départ"
            value={pickupAddress}
            onChangeText={setPickupAddress}
            placeholderTextColor={colors.textLight}
            accessibilityLabel="Adresse de départ"
          />
        </View>

        <TouchableOpacity
          style={styles.myLocationBtn}
          onPress={useMyLocation}
          disabled={locating}
          accessibilityLabel="Utiliser ma position actuelle"
          accessibilityRole="button"
        >
          {locating ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <Text style={styles.myLocationText}>📍 Utiliser ma position actuelle</Text>
          )}
        </TouchableOpacity>

        {/* Destination : choisie sur la carte (pas de saisie d'adresse postale) */}
        <View style={styles.inputContainer}>
          <View style={styles.dotRed} />
          <TouchableOpacity
            style={styles.destBtn}
            onPress={() => setShowDestPicker(true)}
            accessibilityLabel="Choisir la destination sur la carte"
            accessibilityRole="button"
          >
            <Text style={[styles.destBtnText, !dropoffAddress && styles.destBtnPlaceholder]} numberOfLines={1}>
              {dropoffAddress ? dropoffAddress : '📍 Choisir la destination sur la carte'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Repère / indication (adapté au Cameroun) */}
        <TextInput
          style={styles.landmarkInput}
          placeholder="🧭 Repère / indication (ex: portail bleu, après la pharmacie)"
          value={landmark}
          onChangeText={setLandmark}
          placeholderTextColor={colors.textLight}
          accessibilityLabel="Repère ou indication complémentaire"
        />

        <TouchableOpacity
          style={[styles.button, (!pickupAddress || !dropoffAddress) && styles.buttonDisabled]}
          onPress={handleGetEstimates}
          disabled={!pickupAddress || !dropoffAddress || isLoading}
          accessibilityLabel="Rechercher un trajet"
          accessibilityRole="button"
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Voir les tarifs</Text>
          )}
        </TouchableOpacity>

        {/* Sélecteur de destination plein écran (carte OSM + recherche) */}
        <DestinationPicker
          visible={showDestPicker}
          initialCenter={dropoffCoords}
          onConfirm={onDestinationPicked}
          onClose={() => setShowDestPicker(false)}
        />
      </View>
    );
  }

  // Step: Choisir le véhicule
  if (step === 'vehicle') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Choisir votre véhicule</Text>

        <FlatList
          data={vehicleOptions}
          keyExtractor={(item) => item.type}
          renderItem={({ item }) => {
            const estimate = estimates.find((e) => e.vehicleType === item.type);
            const isSelected = selectedVehicle === item.type;

            return (
              <TouchableOpacity
                style={[styles.vehicleCard, isSelected && styles.vehicleCardSelected]}
                onPress={() => setSelectedVehicle(item.type)}
                accessibilityLabel={`${item.name}: ${estimate?.estimatedPrice || ''} francs. ${item.description}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
              >
                <Text style={styles.vehicleIcon}>{item.icon}</Text>
                <View style={styles.vehicleInfo}>
                  <Text style={styles.vehicleName}>{item.name}</Text>
                  <Text style={styles.vehicleDesc}>{item.description}</Text>
                  {estimate && (
                    <Text style={styles.vehicleEta}>{estimate.duration} min • {estimate.distance} km</Text>
                  )}
                </View>
                <Text style={[styles.vehiclePrice, isSelected && styles.vehiclePriceSelected]}>
                  {estimate ? `${estimate.estimatedPrice.toLocaleString()} F` : '...'}
                </Text>
              </TouchableOpacity>
            );
          }}
        />

        <TouchableOpacity
          style={styles.button}
          onPress={() => setStep('confirm')}
          accessibilityLabel="Continuer"
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Continuer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Step: Confirmer et payer
  if (step === 'confirm') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Confirmer votre course</Text>

        {/* Résumé */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>De:</Text>
          <Text style={styles.summaryValue}>{pickupAddress}</Text>
          <Text style={styles.summaryLabel}>À:</Text>
          <Text style={styles.summaryValue}>{dropoffAddress}</Text>
          <Text style={styles.summaryLabel}>Véhicule:</Text>
          <Text style={styles.summaryValue}>
            {vehicleOptions.find((v) => v.type === selectedVehicle)?.name}
          </Text>
          <Text style={styles.summaryLabel}>Prix estimé:</Text>
          <Text style={styles.summaryPrice}>
            {selectedEstimate?.estimatedPrice.toLocaleString()} XAF
          </Text>
        </View>

        {/* Négociation de prix */}
        <View style={styles.negotiateSection}>
          <Text style={styles.negotiateLabel}>💬 Proposer un prix (optionnel)</Text>
          <TextInput
            style={styles.negotiateInput}
            placeholder="Ex: 1500"
            value={proposedPrice}
            onChangeText={setProposedPrice}
            keyboardType="numeric"
            placeholderTextColor={colors.textLight}
            accessibilityLabel="Proposer un prix personnalisé"
          />
        </View>

        {/* Méthode de paiement */}
        <Text style={styles.paymentTitle}>Paiement</Text>
        {paymentMethods.map((method) => (
          <TouchableOpacity
            key={method.id}
            style={[styles.paymentOption, selectedPayment === method.id && styles.paymentSelected]}
            onPress={() => setSelectedPayment(method.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: selectedPayment === method.id }}
            accessibilityLabel={method.name}
          >
            <Text style={styles.paymentIcon}>{method.icon}</Text>
            <Text style={styles.paymentName}>{method.name}</Text>
            {selectedPayment === method.id && <Text style={styles.checkmark}>✓</Text>}
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={styles.button}
          onPress={handleConfirmRide}
          disabled={isLoading}
          accessibilityLabel="Commander la course"
          accessibilityRole="button"
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Commander 🚀</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  // Step: En attente d'un chauffeur
  if (step === 'waiting' || currentRide?.status === 'PENDING') {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.waitingTitle}>Recherche d'un chauffeur...</Text>
        <Text style={styles.waitingSubtitle}>Veuillez patienter</Text>

        <TouchableOpacity
          style={[styles.button, styles.cancelButton]}
          onPress={handleCancel}
          accessibilityLabel="Annuler la course"
          accessibilityRole="button"
        >
          <Text style={[styles.buttonText, { color: colors.error }]}>Annuler</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Step: Course terminée → confirmation d'arrivée (escrow)
  if (currentRide?.status === 'COMPLETED') {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <Text style={{ fontSize: 56, marginBottom: spacing.md }}>🏁</Text>
        <Text style={styles.waitingTitle}>Course terminée</Text>
        <Text style={styles.waitingSubtitle}>
          Prix : {(currentRide.finalPrice || currentRide.estimatedPrice).toLocaleString()} XAF
        </Text>
        <Text style={[styles.waitingSubtitle, { textAlign: 'center', marginTop: spacing.md, paddingHorizontal: spacing.lg }]}>
          Confirmez votre arrivée pour libérer le paiement au chauffeur. Le paiement reste protégé jusqu'à votre validation.
        </Text>

        <TouchableOpacity
          style={[styles.button, { width: '100%' }, confirming && styles.buttonDisabled]}
          onPress={handleConfirmArrival}
          disabled={confirming}
          accessibilityLabel="Confirmer mon arrivée"
          accessibilityRole="button"
        >
          {confirming ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>✅ Confirmer mon arrivée</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.cancelButton, { width: '100%' }]}
          onPress={handleDispute}
          accessibilityLabel="Signaler un problème"
          accessibilityRole="button"
        >
          <Text style={[styles.buttonText, { color: colors.error }]}>⚠️ Signaler un problème</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Step: Course en cours
  return (
    <View style={styles.container}>
      {/* Carte temps réel : passager + chauffeur */}
      <RideMap
        pickup={pickupCoords}
        dropoff={currentRide?.status === 'IN_PROGRESS' ? dropoffCoords : null}
        driver={driverLocation}
        height={220}
      />

      {/* Bandeau ETA / temps d'attente du chauffeur */}
      {(currentRide?.status === 'ACCEPTED' || currentRide?.status === 'DRIVER_ARRIVING') && (
        <View style={styles.etaBanner}>
          {eta ? (
            <>
              <Text style={styles.etaMinutes}>{eta.minutes} min</Text>
              <Text style={styles.etaLabel}>
                Votre chauffeur arrive • {eta.km.toFixed(1)} km
              </Text>
            </>
          ) : (
            <Text style={styles.etaLabel}>📡 En attente de la position du chauffeur...</Text>
          )}
        </View>
      )}

      <View style={styles.rideActiveCard}>
        <Text style={styles.rideStatus}>
          {currentRide?.status === 'ACCEPTED' && '🚗 Chauffeur en route'}
          {currentRide?.status === 'DRIVER_ARRIVING' && '🚗 Chauffeur arrive'}
          {currentRide?.status === 'IN_PROGRESS' && '🛣️ En course'}
        </Text>

        {currentRide?.driver && (
          <View style={styles.driverInfo}>
            <Text style={styles.driverName}>
              {currentRide.driver.firstName} {currentRide.driver.lastName}
            </Text>
            {currentRide.driver.driverProfile && (
              <>
                <Text style={styles.driverVehicle}>
                  {currentRide.driver.driverProfile.vehicleBrand} • {currentRide.driver.driverProfile.vehiclePlate}
                </Text>
                <Text style={styles.driverRating}>
                  ⭐ {currentRide.driver.driverProfile.averageRating.toFixed(1)}
                </Text>
              </>
            )}
          </View>
        )}

        {/* Actions */}
        <View style={styles.rideActions}>
          <TouchableOpacity
            style={styles.sosButton}
            onPress={handleSOS}
            accessibilityLabel="Bouton SOS urgence"
            accessibilityRole="button"
          >
            <Text style={styles.sosText}>🚨 SOS</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.shareButton}
            onPress={handleShare}
            accessibilityLabel="Partager le trajet"
            accessibilityRole="button"
          >
            <Text style={styles.shareText}>📤 Partager</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    paddingTop: spacing.xl + 20,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: typography.xl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  dotGreen: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.success,
    marginRight: spacing.sm,
  },
  dotRed: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.error,
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    padding: spacing.md,
    borderRadius: 12,
    fontSize: typography.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  button: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: typography.md,
    fontWeight: '700',
  },
  vehicleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  vehicleCardSelected: {
    borderColor: colors.primary,
    backgroundColor: '#E8F5E9',
  },
  vehicleIcon: {
    fontSize: 28,
    marginRight: spacing.md,
  },
  vehicleInfo: {
    flex: 1,
  },
  vehicleName: {
    fontSize: typography.md,
    fontWeight: '700',
    color: colors.text,
  },
  vehicleDesc: {
    fontSize: typography.xs,
    color: colors.textSecondary,
  },
  vehicleEta: {
    fontSize: typography.xs,
    color: colors.primary,
    marginTop: 2,
  },
  vehiclePrice: {
    fontSize: typography.lg,
    fontWeight: '800',
    color: colors.text,
  },
  vehiclePriceSelected: {
    color: colors.primary,
  },
  summaryCard: {
    backgroundColor: '#fff',
    padding: spacing.lg,
    borderRadius: 12,
    marginBottom: spacing.md,
  },
  summaryLabel: {
    fontSize: typography.xs,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  summaryValue: {
    fontSize: typography.md,
    color: colors.text,
    fontWeight: '500',
  },
  summaryPrice: {
    fontSize: typography.xl,
    fontWeight: '800',
    color: colors.primary,
    marginTop: 4,
  },
  negotiateSection: {
    marginBottom: spacing.md,
  },
  negotiateLabel: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  negotiateInput: {
    backgroundColor: '#fff',
    padding: spacing.md,
    borderRadius: 12,
    fontSize: typography.md,
    borderWidth: 1,
    borderColor: colors.secondary,
  },
  paymentTitle: {
    fontSize: typography.md,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
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
  paymentSelected: {
    borderColor: colors.primary,
    backgroundColor: '#E8F5E9',
  },
  paymentIcon: {
    fontSize: 20,
    marginRight: spacing.sm,
  },
  paymentName: {
    flex: 1,
    fontSize: typography.sm,
    color: colors.text,
  },
  checkmark: {
    fontSize: typography.md,
    color: colors.primary,
    fontWeight: '700',
  },
  waitingTitle: {
    fontSize: typography.lg,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.lg,
  },
  waitingSubtitle: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  cancelButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.error,
  },
  destBtn: {
    flex: 1,
    backgroundColor: '#fff',
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  destBtnText: {
    fontSize: typography.md,
    color: colors.text,
  },
  destBtnPlaceholder: {
    color: colors.textLight,
  },
  landmarkInput: {
    backgroundColor: '#fff',
    padding: spacing.md,
    borderRadius: 12,
    fontSize: typography.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  myLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8F5E9',
    paddingVertical: spacing.sm,
    borderRadius: 10,
    marginBottom: spacing.sm,
  },
  myLocationText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: typography.sm,
  },
  etaBanner: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  etaMinutes: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '900',
  },
  etaLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: typography.sm,
    fontWeight: '600',
    marginTop: 2,
  },
  rideActiveCard: {
    backgroundColor: '#fff',
    padding: spacing.lg,
    borderRadius: 16,
    elevation: 4,
  },
  rideStatus: {
    fontSize: typography.lg,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: spacing.md,
  },
  driverInfo: {
    marginBottom: spacing.md,
  },
  driverName: {
    fontSize: typography.md,
    fontWeight: '700',
    color: colors.text,
  },
  driverVehicle: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  driverRating: {
    fontSize: typography.sm,
    marginTop: 2,
  },
  rideActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.md,
  },
  sosButton: {
    backgroundColor: '#FFEBEE',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 8,
  },
  sosText: {
    color: colors.error,
    fontWeight: '700',
  },
  shareButton: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 8,
  },
  shareText: {
    color: colors.info,
    fontWeight: '700',
  },
});
