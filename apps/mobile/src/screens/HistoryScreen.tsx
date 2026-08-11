import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import api from '../config/api';
import { colors, spacing, typography } from '../theme';

type HistoryTab = 'rides' | 'deliveries' | 'orders';

interface RideHistory {
  id: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  estimatedPrice: number;
  finalPrice?: number;
  vehicleType: string;
  createdAt: string;
  driver?: { firstName: string; lastName: string };
}

interface DeliveryHistory {
  id: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  packageType: string;
  estimatedPrice: number;
  createdAt: string;
}

export default function HistoryScreen({ navigation }: { navigation: any }) {
  const [activeTab, setActiveTab] = useState<HistoryTab>('rides');
  const [rides, setRides] = useState<RideHistory[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryHistory[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      if (activeTab === 'rides') {
        const response = await api.get('/rides/history');
        setRides(response.data.data.rides);
      } else if (activeTab === 'deliveries') {
        const response = await api.get('/deliveries/history');
        setDeliveries(response.data.data.deliveries);
      }
    } catch {}
    setIsLoading(false);
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { color: string; bg: string; label: string }> = {
      COMPLETED: { color: colors.success, bg: '#E8F5E9', label: '✅ Terminée' },
      DELIVERED: { color: colors.success, bg: '#E8F5E9', label: '✅ Livrée' },
      CANCELLED: { color: colors.error, bg: '#FFEBEE', label: '❌ Annulée' },
      IN_PROGRESS: { color: colors.info, bg: '#E3F2FD', label: '🚗 En cours' },
      PENDING: { color: colors.warning, bg: '#FFF8E1', label: '⏳ En attente' },
    };
    return badges[status] || { color: colors.textSecondary, bg: '#f5f5f5', label: status };
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Text style={styles.backText}>← Retour</Text>
      </TouchableOpacity>

      <Text style={styles.title}>📋 Historique</Text>

      {/* Tabs */}
      <View style={styles.tabs}>
        {[
          { id: 'rides' as HistoryTab, label: 'Courses' },
          { id: 'deliveries' as HistoryTab, label: 'Livraisons' },
        ].map((tab) => (
          <TouchableOpacity
            key={tab.id}
            style={[styles.tab, activeTab === tab.id && styles.tabActive]}
            onPress={() => setActiveTab(tab.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab.id }}
          >
            <Text style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <>
          {activeTab === 'rides' && (
            <FlatList
              data={rides}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Text style={styles.emptyIcon}>🚗</Text>
                  <Text style={styles.emptyText}>Aucune course pour le moment</Text>
                </View>
              }
              renderItem={({ item }) => {
                const badge = getStatusBadge(item.status);
                return (
                  <View style={styles.historyCard}>
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardDate}>{formatDate(item.createdAt)}</Text>
                      <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                        <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
                      </View>
                    </View>
                    <View style={styles.cardRoute}>
                      <Text style={styles.routeFrom}>📍 {item.pickupAddress}</Text>
                      <Text style={styles.routeTo}>🏁 {item.dropoffAddress}</Text>
                    </View>
                    <View style={styles.cardFooter}>
                      <Text style={styles.vehicleType}>{item.vehicleType}</Text>
                      <Text style={styles.cardPrice}>
                        {(item.finalPrice || item.estimatedPrice).toLocaleString()} XAF
                      </Text>
                    </View>
                    {item.driver && (
                      <Text style={styles.driverName}>
                        Chauffeur: {item.driver.firstName} {item.driver.lastName}
                      </Text>
                    )}
                  </View>
                );
              }}
            />
          )}

          {activeTab === 'deliveries' && (
            <FlatList
              data={deliveries}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Text style={styles.emptyIcon}>📦</Text>
                  <Text style={styles.emptyText}>Aucune livraison pour le moment</Text>
                </View>
              }
              renderItem={({ item }) => {
                const badge = getStatusBadge(item.status);
                return (
                  <View style={styles.historyCard}>
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardDate}>{formatDate(item.createdAt)}</Text>
                      <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                        <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
                      </View>
                    </View>
                    <View style={styles.cardRoute}>
                      <Text style={styles.routeFrom}>📍 {item.pickupAddress}</Text>
                      <Text style={styles.routeTo}>🏁 {item.dropoffAddress}</Text>
                    </View>
                    <View style={styles.cardFooter}>
                      <Text style={styles.vehicleType}>{item.packageType}</Text>
                      <Text style={styles.cardPrice}>{item.estimatedPrice.toLocaleString()} XAF</Text>
                    </View>
                  </View>
                );
              }}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, paddingTop: spacing.xl + 20 },
  backBtn: { marginBottom: spacing.md },
  backText: { color: colors.primary, fontSize: typography.md, fontWeight: '600' },
  title: { fontSize: typography.xl, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 4, marginBottom: spacing.lg },
  tab: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: typography.sm, color: colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  historyCard: { backgroundColor: '#fff', padding: spacing.lg, borderRadius: 12, marginBottom: spacing.sm, elevation: 1 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  cardDate: { fontSize: typography.xs, color: colors.textSecondary },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  cardRoute: { marginBottom: spacing.sm },
  routeFrom: { fontSize: typography.sm, color: colors.text, marginBottom: 4 },
  routeTo: { fontSize: typography.sm, color: colors.text },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  vehicleType: { fontSize: typography.xs, color: colors.textSecondary, textTransform: 'capitalize' },
  cardPrice: { fontSize: typography.md, fontWeight: '800', color: colors.primary },
  driverName: { fontSize: typography.xs, color: colors.textSecondary, marginTop: spacing.xs },
  emptyState: { alignItems: 'center', marginTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyText: { fontSize: typography.md, color: colors.textSecondary },
});
