import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRideStore } from '../store/rideStore';
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
    clearRide,
  } = useRideStore();

  // Simulated coordinates (en production: utiliser expo-location)
  const pickup = { lat: 4.0511, lng: 9.7679, address: pickupAddress }; // Douala
  const dropoff = { lat: 4.0611, lng: 9.7879, address: dropoffAddress };

  useEffect(() => {
    if (currentRide?.status === 'COMPLETED') {
      Alert.alert('Course terminée !', 'Merci d\'avoir voyagé avec 237GO 🎉', [
        { text: 'Évaluer', onPress: () => navigation.navigate('Rating', { rideId: currentRide.id }) },
        { text: 'Fermer', onPress: () => clearRide() },
      ]);
    }
  }, [currentRide?.status]);

  const handleGetEstimates = async () => {
    if (!pickupAddress || !dropoffAddress) {
      Alert.alert('Attention', 'Veuillez entrer les adresses de départ et d\'arrivée');
      return;
    }
    await getAllEstimates(pickup, dropoff);
    setStep('vehicle');
  };

  const handleConfirmRide = async () => {
    try {
      await createRide({
        pickup: { ...pickup, address: pickupAddress },
        dropoff: { ...dropoff, address: dropoffAddress },
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

  // Step: Entrer les adresses
  if (step === 'location') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Où allez-vous ?</Text>

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

        <View style={styles.inputContainer}>
          <View style={styles.dotRed} />
          <TextInput
            style={styles.input}
            placeholder="📍 Destination"
            value={dropoffAddress}
            onChangeText={setDropoffAddress}
            placeholderTextColor={colors.textLight}
            accessibilityLabel="Adresse de destination"
          />
        </View>

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

  // Step: Course en cours
  return (
    <View style={styles.container}>
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
            onPress={() => Alert.alert('SOS', 'Alerte envoyée aux contacts d\'urgence et à 237GO')}
            accessibilityLabel="Bouton SOS urgence"
            accessibilityRole="button"
          >
            <Text style={styles.sosText}>🚨 SOS</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.shareButton}
            onPress={() => Alert.alert('Partager', 'Lien de suivi envoyé à votre contact')}
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
