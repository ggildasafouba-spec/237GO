import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useDeliveryStore } from '../store/deliveryStore';
import { colors, spacing, typography } from '../theme';

type PackageType = 'DOCUMENT' | 'SMALL_PACKAGE' | 'MEDIUM_PACKAGE' | 'LARGE_PACKAGE' | 'FOOD' | 'FRAGILE';

const packageTypes: { id: PackageType; name: string; icon: string; desc: string }[] = [
  { id: 'DOCUMENT', name: 'Document', icon: '📄', desc: 'Lettres, papiers' },
  { id: 'SMALL_PACKAGE', name: 'Petit colis', icon: '📦', desc: 'Moins de 5kg' },
  { id: 'MEDIUM_PACKAGE', name: 'Moyen colis', icon: '📫', desc: '5 à 20kg' },
  { id: 'LARGE_PACKAGE', name: 'Gros colis', icon: '🏗️', desc: 'Plus de 20kg' },
  { id: 'FOOD', name: 'Nourriture', icon: '🍲', desc: 'Repas, aliments' },
  { id: 'FRAGILE', name: 'Fragile', icon: '⚠️', desc: 'Manipulation délicate' },
];

const paymentMethods = [
  { id: 'ORANGE_MONEY', name: 'Orange Money', icon: '🟠' },
  { id: 'MTN_MOMO', name: 'MTN MoMo', icon: '🟡' },
  { id: 'CASH', name: 'Espèces', icon: '💵' },
  { id: 'WALLET', name: 'Portefeuille 237GO', icon: '👛' },
];

export default function DeliveryScreen({ navigation }: { navigation: any }) {
  const [step, setStep] = useState<'type' | 'addresses' | 'confirm' | 'tracking'>('type');
  const [selectedType, setSelectedType] = useState<PackageType>('SMALL_PACKAGE');
  const [packageDesc, setPackageDesc] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [pickupContact, setPickupContact] = useState('');
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [dropoffContact, setDropoffContact] = useState('');
  const [selectedPayment, setSelectedPayment] = useState('ORANGE_MONEY');

  const { currentDelivery, estimate, isLoading, getEstimate, createDelivery, clearDelivery } = useDeliveryStore();

  useEffect(() => {
    if (currentDelivery?.status === 'DELIVERED') {
      Alert.alert('✅ Livraison effectuée !', 'Votre colis a été livré avec succès.', [
        { text: 'OK', onPress: () => { clearDelivery(); setStep('type'); } },
      ]);
    }
  }, [currentDelivery?.status]);

  const handleEstimate = async () => {
    if (!pickupAddress || !dropoffAddress || !pickupContact || !dropoffContact) {
      Alert.alert('Attention', 'Veuillez remplir tous les champs');
      return;
    }
    if (!pickupContact.match(/^6[0-9]{8}$/) || !dropoffContact.match(/^6[0-9]{8}$/)) {
      Alert.alert('Erreur', 'Numéros de téléphone invalides (format: 6XXXXXXXX)');
      return;
    }

    try {
      // Coordonnées simulées (en prod: geocoding)
      await getEstimate({
        pickupLat: 4.0511,
        pickupLng: 9.7679,
        dropoffLat: 4.0611,
        dropoffLng: 9.7879,
        packageType: selectedType,
      });
      setStep('confirm');
    } catch {
      Alert.alert('Erreur', 'Impossible d\'estimer le prix');
    }
  };

  const handleCreate = async () => {
    try {
      await createDelivery({
        pickupLat: 4.0511,
        pickupLng: 9.7679,
        pickupAddress,
        pickupContact,
        dropoffLat: 4.0611,
        dropoffLng: 9.7879,
        dropoffAddress,
        dropoffContact,
        packageType: selectedType,
        packageDesc: packageDesc || undefined,
        paymentMethod: selectedPayment,
      });
      setStep('tracking');
    } catch {
      Alert.alert('Erreur', 'Impossible de créer la livraison');
    }
  };

  // Step 1: Type de colis
  if (step === 'type') {
    return (
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Retour</Text>
        </TouchableOpacity>

        <Text style={styles.title}>📦 GO Deliver</Text>
        <Text style={styles.subtitle}>Que souhaitez-vous envoyer ?</Text>

        <View style={styles.typeGrid}>
          {packageTypes.map((pkg) => (
            <TouchableOpacity
              key={pkg.id}
              style={[styles.typeCard, selectedType === pkg.id && styles.typeCardSelected]}
              onPress={() => setSelectedType(pkg.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: selectedType === pkg.id }}
              accessibilityLabel={`${pkg.name}: ${pkg.desc}`}
            >
              <Text style={styles.typeIcon}>{pkg.icon}</Text>
              <Text style={styles.typeName}>{pkg.name}</Text>
              <Text style={styles.typeDesc}>{pkg.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={styles.input}
          placeholder="Description du colis (optionnel)"
          value={packageDesc}
          onChangeText={setPackageDesc}
          multiline
          placeholderTextColor={colors.textLight}
          accessibilityLabel="Description du colis"
        />

        <TouchableOpacity style={styles.button} onPress={() => setStep('addresses')} accessibilityRole="button">
          <Text style={styles.buttonText}>Continuer</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // Step 2: Adresses
  if (step === 'addresses') {
    return (
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => setStep('type')} style={styles.backBtn}>
          <Text style={styles.backText}>← Type de colis</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Adresses</Text>

        <Text style={styles.sectionLabel}>📍 Point de retrait</Text>
        <TextInput
          style={styles.input}
          placeholder="Adresse de retrait"
          value={pickupAddress}
          onChangeText={setPickupAddress}
          placeholderTextColor={colors.textLight}
          accessibilityLabel="Adresse de retrait du colis"
        />
        <TextInput
          style={styles.input}
          placeholder="Téléphone contact retrait (6XXXXXXXX)"
          value={pickupContact}
          onChangeText={setPickupContact}
          keyboardType="phone-pad"
          maxLength={9}
          placeholderTextColor={colors.textLight}
          accessibilityLabel="Téléphone du contact au point de retrait"
        />

        <Text style={styles.sectionLabel}>📍 Point de livraison</Text>
        <TextInput
          style={styles.input}
          placeholder="Adresse de livraison"
          value={dropoffAddress}
          onChangeText={setDropoffAddress}
          placeholderTextColor={colors.textLight}
          accessibilityLabel="Adresse de livraison du colis"
        />
        <TextInput
          style={styles.input}
          placeholder="Téléphone destinataire (6XXXXXXXX)"
          value={dropoffContact}
          onChangeText={setDropoffContact}
          keyboardType="phone-pad"
          maxLength={9}
          placeholderTextColor={colors.textLight}
          accessibilityLabel="Téléphone du destinataire"
        />

        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleEstimate}
          disabled={isLoading}
          accessibilityRole="button"
          accessibilityLabel="Voir le prix estimé"
        >
          {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Estimer le prix</Text>}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // Step 3: Confirmation
  if (step === 'confirm') {
    return (
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => setStep('addresses')} style={styles.backBtn}>
          <Text style={styles.backText}>← Modifier</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Confirmer la livraison</Text>

        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Colis</Text>
            <Text style={styles.summaryValue}>
              {packageTypes.find((p) => p.id === selectedType)?.icon}{' '}
              {packageTypes.find((p) => p.id === selectedType)?.name}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Retrait</Text>
            <Text style={styles.summaryValue}>{pickupAddress}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Livraison</Text>
            <Text style={styles.summaryValue}>{dropoffAddress}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Distance</Text>
            <Text style={styles.summaryValue}>{estimate?.distance} km</Text>
          </View>
          <View style={[styles.summaryRow, styles.priceRow]}>
            <Text style={styles.priceLabel}>Prix</Text>
            <Text style={styles.priceValue}>{estimate?.estimatedPrice.toLocaleString()} XAF</Text>
          </View>
        </View>

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
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleCreate}
          disabled={isLoading}
          accessibilityRole="button"
        >
          {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Envoyer 📦</Text>}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // Step 4: Suivi en temps réel
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Suivi de livraison</Text>

      <View style={styles.trackingCard}>
        <View style={styles.statusTimeline}>
          {['PENDING', 'ACCEPTED', 'PICKING_UP', 'IN_TRANSIT', 'DELIVERED'].map((status, index) => {
            const statusLabels: Record<string, string> = {
              PENDING: 'En attente',
              ACCEPTED: 'Livreur trouvé',
              PICKING_UP: 'Récupération',
              IN_TRANSIT: 'En route',
              DELIVERED: 'Livré',
            };
            const statusIcons: Record<string, string> = {
              PENDING: '⏳',
              ACCEPTED: '✅',
              PICKING_UP: '📍',
              IN_TRANSIT: '🚗',
              DELIVERED: '🎉',
            };
            const statuses = ['PENDING', 'ACCEPTED', 'PICKING_UP', 'IN_TRANSIT', 'DELIVERED'];
            const currentIdx = statuses.indexOf(currentDelivery?.status || 'PENDING');
            const isActive = index <= currentIdx;
            const isCurrent = index === currentIdx;

            return (
              <View key={status} style={styles.timelineItem}>
                <View style={[styles.timelineDot, isActive && styles.timelineDotActive, isCurrent && styles.timelineDotCurrent]}>
                  <Text style={styles.timelineDotIcon}>{statusIcons[status]}</Text>
                </View>
                <Text style={[styles.timelineLabel, isActive && styles.timelineLabelActive]}>
                  {statusLabels[status]}
                </Text>
                {index < 4 && <View style={[styles.timelineLine, isActive && styles.timelineLineActive]} />}
              </View>
            );
          })}
        </View>

        {currentDelivery?.driver && (
          <View style={styles.driverCard}>
            <Text style={styles.driverLabel}>Votre livreur</Text>
            <Text style={styles.driverName}>
              {currentDelivery.driver.firstName} {currentDelivery.driver.lastName}
            </Text>
            <TouchableOpacity
              style={styles.callButton}
              onPress={() => Alert.alert('Appeler', currentDelivery.driver!.phone)}
              accessibilityLabel="Appeler le livreur"
              accessibilityRole="button"
            >
              <Text style={styles.callButtonText}>📞 Appeler</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.error }]}
        onPress={() => { clearDelivery(); setStep('type'); navigation.goBack(); }}
        accessibilityRole="button"
      >
        <Text style={[styles.buttonText, { color: colors.error }]}>Fermer</Text>
      </TouchableOpacity>
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
  backBtn: {
    marginBottom: spacing.md,
  },
  backText: {
    color: colors.primary,
    fontSize: typography.md,
    fontWeight: '600',
  },
  title: {
    fontSize: typography.xl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    fontSize: typography.md,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  typeCard: {
    width: '48%',
    backgroundColor: '#fff',
    padding: spacing.md,
    borderRadius: 12,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  typeCardSelected: {
    borderColor: colors.primary,
    backgroundColor: '#E8F5E9',
  },
  typeIcon: {
    fontSize: 28,
    marginBottom: 4,
  },
  typeName: {
    fontSize: typography.sm,
    fontWeight: '700',
    color: colors.text,
  },
  typeDesc: {
    fontSize: typography.xs,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#fff',
    padding: spacing.md,
    borderRadius: 12,
    fontSize: typography.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
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
  summaryCard: {
    backgroundColor: '#fff',
    padding: spacing.lg,
    borderRadius: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryLabel: {
    fontSize: typography.sm,
    color: colors.textSecondary,
  },
  summaryValue: {
    fontSize: typography.sm,
    color: colors.text,
    fontWeight: '500',
    maxWidth: '60%',
    textAlign: 'right',
  },
  priceRow: {
    borderBottomWidth: 0,
    marginTop: spacing.sm,
  },
  priceLabel: {
    fontSize: typography.lg,
    fontWeight: '700',
    color: colors.text,
  },
  priceValue: {
    fontSize: typography.lg,
    fontWeight: '800',
    color: colors.primary,
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
  trackingCard: {
    backgroundColor: '#fff',
    padding: spacing.lg,
    borderRadius: 16,
    marginTop: spacing.lg,
  },
  statusTimeline: {
    paddingLeft: spacing.md,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    position: 'relative',
  },
  timelineDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  timelineDotActive: {
    backgroundColor: '#E8F5E9',
  },
  timelineDotCurrent: {
    backgroundColor: colors.primary,
  },
  timelineDotIcon: {
    fontSize: 16,
  },
  timelineLabel: {
    fontSize: typography.sm,
    color: colors.textLight,
  },
  timelineLabelActive: {
    color: colors.text,
    fontWeight: '600',
  },
  timelineLine: {
    position: 'absolute',
    left: 17,
    top: 36,
    width: 2,
    height: 20,
    backgroundColor: colors.border,
  },
  timelineLineActive: {
    backgroundColor: colors.primary,
  },
  driverCard: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.background,
    borderRadius: 12,
  },
  driverLabel: {
    fontSize: typography.xs,
    color: colors.textSecondary,
  },
  driverName: {
    fontSize: typography.md,
    fontWeight: '700',
    color: colors.text,
    marginTop: 2,
  },
  callButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    padding: spacing.sm,
    borderRadius: 8,
    alignItems: 'center',
  },
  callButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
