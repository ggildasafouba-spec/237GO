import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '../store/authStore';
import { useWalletStore } from '../store/walletStore';
import Logo from '../components/Logo';
import { colors, spacing, typography, gradients } from '../theme';

const { width } = Dimensions.get('window');

interface ServiceItem {
  id: string;
  name: string;
  icon: string;
  description: string;
  screen: string;
  color: string;
  phase: number;
}

const services: ServiceItem[] = [
  {
    id: 'ride',
    name: 'GO Ride',
    icon: '🚗',
    description: 'Transport à la demande',
    screen: 'Ride',
    color: colors.primary, // vert
    phase: 1,
  },
  {
    id: 'deliver',
    name: 'GO Deliver',
    icon: '📦',
    description: 'Livraison de colis',
    screen: 'Delivery',
    color: colors.secondaryDark, // jaune/or
    phase: 1,
  },
  {
    id: 'market',
    name: 'GO Market',
    icon: '🛒',
    description: 'Marché à domicile',
    screen: 'Market',
    color: colors.accent, // rouge Cameroun
    phase: 2,
  },
  {
    id: 'share',
    name: 'GO Share',
    icon: '🚌',
    description: 'Covoiturage inter-villes',
    screen: 'Carpool',
    color: colors.primaryDark, // vert foncé
    phase: 2,
  },
  {
    id: 'rent',
    name: 'GO Rent',
    icon: '🔑',
    description: 'Location de véhicules',
    screen: 'Rental',
    color: colors.info, // bleu
    phase: 3,
  },
  {
    id: 'business',
    name: 'GO Business',
    icon: '💼',
    description: 'Entreprises',
    screen: 'Business',
    color: colors.dark, // anthracite
    phase: 3,
  },
];

export default function HomeScreen({ navigation }: { navigation: any }) {
  const { user } = useAuthStore();
  const { balance, loyaltyPoints, fetchBalance, fetchLoyalty } = useWalletStore();

  useEffect(() => {
    fetchBalance();
    fetchLoyalty();
  }, []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bonjour';
    if (hour < 18) return 'Bon après-midi';
    return 'Bonsoir';
  };

  return (
    <View style={{ flex: 1 }}>
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header en dégradé sombre premium */}
      <LinearGradient
        colors={gradients.dark}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Logo size={44} variant="light" />
            <View style={{ marginLeft: spacing.sm }}>
              <Text style={styles.brand}>237GO</Text>
              <Text style={styles.greeting}>{getGreeting()}, {user?.firstName} 👋</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => navigation.navigate('Profile')}
            accessibilityLabel="Voir le profil"
            accessibilityRole="button"
          >
            <Text style={styles.profileInitial}>
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Wallet Card dans le header */}
        <TouchableOpacity
          style={styles.walletCard}
          onPress={() => navigation.navigate('Wallet')}
          accessibilityLabel={`Solde: ${balance} francs CFA. ${loyaltyPoints} points de fidélité`}
          accessibilityRole="button"
        >
          <View style={styles.walletTop}>
            <Text style={styles.walletLabel}>💰 Mon portefeuille</Text>
            <View style={styles.loyaltyBadge}>
              <Text style={styles.loyaltyText}>⭐ {loyaltyPoints} pts</Text>
            </View>
          </View>
          <Text style={styles.walletBalance}>{balance.toLocaleString()} XAF</Text>
          <View style={styles.walletBottom}>
            <Text style={styles.walletAction}>Recharger →</Text>
          </View>
        </TouchableOpacity>
      </LinearGradient>

      {/* Barre aux couleurs du Cameroun : vert - rouge - jaune */}
      <View style={styles.flagBar}>
        <View style={[styles.flagStripe, { backgroundColor: colors.primary }]} />
        <View style={[styles.flagStripe, { backgroundColor: colors.accent }]} />
        <View style={[styles.flagStripe, { backgroundColor: colors.secondary }]} />
      </View>

      {/* Services */}
      <View style={styles.body}>
      <Text style={styles.sectionTitle}>Nos services</Text>
      <View style={styles.servicesGrid}>
        {services.map((service) => (
          <TouchableOpacity
            key={service.id}
            style={styles.serviceCard}
            onPress={() => navigation.navigate(service.screen)}
            accessibilityLabel={`${service.name}: ${service.description}`}
            accessibilityRole="button"
          >
            <View style={[styles.serviceIconWrap, { backgroundColor: service.color + '18' }]}>
              <Text style={styles.serviceIcon}>{service.icon}</Text>
            </View>
            <Text style={styles.serviceName}>{service.name}</Text>
            <Text style={styles.serviceDesc}>{service.description}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>Actions rapides</Text>
      <View style={styles.quickActions}>
        <TouchableOpacity
          style={styles.quickAction}
          onPress={() => navigation.navigate('Ride')}
          accessibilityLabel="Commander une course"
          accessibilityRole="button"
        >
          <Text style={styles.quickActionIcon}>🏍️</Text>
          <Text style={styles.quickActionText}>Moto</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickAction}
          onPress={() => navigation.navigate('Ride', { vehicleType: 'CAR_ECONOMY' })}
          accessibilityLabel="Commander un taxi"
          accessibilityRole="button"
        >
          <Text style={styles.quickActionIcon}>🚕</Text>
          <Text style={styles.quickActionText}>Taxi</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickAction}
          onPress={() => navigation.navigate('Delivery')}
          accessibilityLabel="Envoyer un colis"
          accessibilityRole="button"
        >
          <Text style={styles.quickActionIcon}>📦</Text>
          <Text style={styles.quickActionText}>Colis</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickAction}
          onPress={() => navigation.navigate('Market')}
          accessibilityLabel="Commander au marché"
          accessibilityRole="button"
        >
          <Text style={styles.quickActionIcon}>🛒</Text>
          <Text style={styles.quickActionText}>Marché</Text>
        </TouchableOpacity>
      </View>
      </View>

      <View style={styles.bottomSpacer} />
    </ScrollView>

    {/* Bouton flottant Assistant IA */}
    <TouchableOpacity
      style={styles.aiFab}
      onPress={() => navigation.navigate('Assistant')}
      accessibilityLabel="Ouvrir l'assistant 237GO"
      accessibilityRole="button"
    >
      <Text style={styles.aiFabIcon}>🤖</Text>
    </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerGradient: {
    paddingTop: spacing.xl + 20,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brand: {
    fontSize: 24,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 1,
  },
  greeting: {
    fontSize: typography.sm,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 2,
  },
  flagBar: {
    flexDirection: 'row',
    height: 5,
    marginBottom: spacing.sm,
  },
  flagStripe: {
    flex: 1,
    height: 5,
  },
  body: {
    paddingBottom: spacing.lg,
  },
  profileButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  aiFab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  aiFabIcon: {
    fontSize: 28,
  },
  profileInitial: {
    color: '#fff',
    fontSize: typography.md,
    fontWeight: '700',
  },
  walletCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.lg,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  walletTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  walletLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: typography.sm,
    fontWeight: '600',
  },
  walletBalance: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '900',
    marginVertical: 4,
  },
  walletBottom: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  loyaltyBadge: {
    backgroundColor: colors.secondary,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  loyaltyText: {
    color: colors.primaryDark,
    fontSize: typography.xs,
    fontWeight: '800',
  },
  walletAction: {
    color: '#fff',
    fontSize: typography.sm,
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: typography.lg,
    fontWeight: '800',
    color: colors.text,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  servicesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
  },
  serviceCard: {
    width: (width - spacing.lg * 2 - spacing.md) / 2,
    margin: spacing.xs,
    padding: spacing.md,
    backgroundColor: '#fff',
    borderRadius: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  serviceIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  serviceIcon: {
    fontSize: 26,
  },
  serviceName: {
    fontSize: typography.md,
    fontWeight: '800',
    color: colors.text,
  },
  serviceDesc: {
    fontSize: typography.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  quickActions: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    justifyContent: 'space-between',
  },
  quickAction: {
    alignItems: 'center',
    width: (width - spacing.lg * 2 - spacing.md * 3) / 4,
    padding: spacing.sm,
    backgroundColor: '#fff',
    borderRadius: 12,
    elevation: 1,
  },
  quickActionIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  quickActionText: {
    fontSize: typography.xs,
    color: colors.text,
    fontWeight: '500',
  },
  bottomSpacer: {
    height: 100,
  },
});
