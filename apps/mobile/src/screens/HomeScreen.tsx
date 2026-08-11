import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import { useAuthStore } from '../store/authStore';
import { useWalletStore } from '../store/walletStore';
import { colors, spacing, typography } from '../theme';

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
    color: '#1B5E20',
    phase: 1,
  },
  {
    id: 'deliver',
    name: 'GO Deliver',
    icon: '📦',
    description: 'Livraison de colis',
    screen: 'Delivery',
    color: '#E65100',
    phase: 1,
  },
  {
    id: 'market',
    name: 'GO Market',
    icon: '🛒',
    description: 'Marché à domicile',
    screen: 'Market',
    color: '#4A148C',
    phase: 2,
  },
  {
    id: 'share',
    name: 'GO Share',
    icon: '🚌',
    description: 'Covoiturage inter-villes',
    screen: 'Carpool',
    color: '#01579B',
    phase: 2,
  },
  {
    id: 'rent',
    name: 'GO Rent',
    icon: '🔑',
    description: 'Location de véhicules',
    screen: 'Rental',
    color: '#BF360C',
    phase: 3,
  },
  {
    id: 'business',
    name: 'GO Business',
    icon: '💼',
    description: 'Entreprises',
    screen: 'Business',
    color: '#263238',
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
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{getGreeting()},</Text>
          <Text style={styles.userName}>{user?.firstName} 👋</Text>
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

      {/* Wallet Card */}
      <TouchableOpacity
        style={styles.walletCard}
        onPress={() => navigation.navigate('Wallet')}
        accessibilityLabel={`Solde: ${balance} francs CFA. ${loyaltyPoints} points de fidélité`}
        accessibilityRole="button"
      >
        <View style={styles.walletTop}>
          <Text style={styles.walletLabel}>Mon portefeuille</Text>
          <Text style={styles.walletBalance}>{balance.toLocaleString()} XAF</Text>
        </View>
        <View style={styles.walletBottom}>
          <View style={styles.loyaltyBadge}>
            <Text style={styles.loyaltyText}>⭐ {loyaltyPoints} pts</Text>
          </View>
          <Text style={styles.walletAction}>Recharger →</Text>
        </View>
      </TouchableOpacity>

      {/* Services */}
      <Text style={styles.sectionTitle}>Services</Text>
      <View style={styles.servicesGrid}>
        {services.map((service) => (
          <TouchableOpacity
            key={service.id}
            style={[styles.serviceCard, { borderLeftColor: service.color }]}
            onPress={() => navigation.navigate(service.screen)}
            accessibilityLabel={`${service.name}: ${service.description}`}
            accessibilityRole="button"
          >
            <Text style={styles.serviceIcon}>{service.icon}</Text>
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

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + 20,
    paddingBottom: spacing.md,
  },
  greeting: {
    fontSize: typography.sm,
    color: colors.textSecondary,
  },
  userName: {
    fontSize: typography.xl,
    fontWeight: '700',
    color: colors.text,
  },
  profileButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInitial: {
    color: '#fff',
    fontSize: typography.md,
    fontWeight: '700',
  },
  walletCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: 16,
    elevation: 4,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  walletTop: {
    marginBottom: spacing.md,
  },
  walletLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: typography.sm,
  },
  walletBalance: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 4,
  },
  walletBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  loyaltyBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  loyaltyText: {
    color: '#fff',
    fontSize: typography.xs,
    fontWeight: '600',
  },
  walletAction: {
    color: '#fff',
    fontSize: typography.sm,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: typography.lg,
    fontWeight: '700',
    color: colors.text,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
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
    borderRadius: 12,
    borderLeftWidth: 4,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  serviceIcon: {
    fontSize: 28,
    marginBottom: spacing.xs,
  },
  serviceName: {
    fontSize: typography.md,
    fontWeight: '700',
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
