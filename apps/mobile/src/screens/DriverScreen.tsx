import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  FlatList,
  Alert,
  Vibration,
} from 'react-native';
import { useAuthStore } from '../store/authStore';
import { getSocket } from '../config/socket';
import api from '../config/api';
import { colors, spacing, typography } from '../theme';

interface RideRequest {
  rideId: string;
  pickup: { lat: number; lng: number; address: string };
  dropoff: { lat: number; lng: number; address: string };
  estimatedPrice: number;
  proposedPrice?: number;
  vehicleType: string;
  distance: number;
  duration: number;
}

interface DeliveryRequest {
  deliveryId: string;
  pickup: { lat: number; lng: number; address: string };
  dropoff: { lat: number; lng: number; address: string };
  packageType: string;
  estimatedPrice: number;
  distance: number;
}

interface ActiveJob {
  type: 'ride' | 'delivery';
  id: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  price: number;
  passengerPhone?: string;
}

export default function DriverScreen({ navigation }: { navigation: any }) {
  const { user } = useAuthStore();
  const [isOnline, setIsOnline] = useState(false);
  const [rideRequests, setRideRequests] = useState<RideRequest[]>([]);
  const [deliveryRequests, setDeliveryRequests] = useState<DeliveryRequest[]>([]);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [earnings, setEarnings] = useState({ today: 0, trips: 0 });

  const socketRef = useRef(getSocket());

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socketRef.current = socket;

    // Écouter les nouvelles demandes de course
    socket.on('new_ride_request', (data: RideRequest) => {
      Vibration.vibrate([0, 300, 100, 300]);
      setRideRequests((prev) => [data, ...prev]);
    });

    // Écouter les nouvelles demandes de livraison
    socket.on('new_delivery_request', (data: DeliveryRequest) => {
      Vibration.vibrate([0, 200, 100, 200]);
      setDeliveryRequests((prev) => [data, ...prev]);
    });

    return () => {
      socket.off('new_ride_request');
      socket.off('new_delivery_request');
    };
  }, []);

  const toggleOnline = async () => {
    const socket = socketRef.current;
    if (!socket) return;

    if (!isOnline) {
      // Se mettre en ligne
      socket.emit('driver:online', {
        vehicleType: 'CAR_ECONOMY', // TODO: récupérer du profil
        lat: 4.0511,
        lng: 9.7679,
      });
      setIsOnline(true);
    } else {
      // Se mettre hors ligne
      socket.emit('driver:offline');
      setIsOnline(false);
      setRideRequests([]);
      setDeliveryRequests([]);
    }
  };

  const acceptRide = async (request: RideRequest) => {
    try {
      const response = await api.patch(`/rides/${request.rideId}/accept`);
      setActiveJob({
        type: 'ride',
        id: request.rideId,
        status: 'ACCEPTED',
        pickupAddress: request.pickup.address,
        dropoffAddress: request.dropoff.address,
        price: request.proposedPrice || request.estimatedPrice,
      });
      setRideRequests([]);
      Alert.alert('✅ Course acceptée !', `Direction: ${request.pickup.address}`);
    } catch {
      Alert.alert('Erreur', 'Course déjà prise par un autre chauffeur');
      setRideRequests((prev) => prev.filter((r) => r.rideId !== request.rideId));
    }
  };

  const acceptDelivery = async (request: DeliveryRequest) => {
    try {
      await api.patch(`/deliveries/${request.deliveryId}/accept`);
      setActiveJob({
        type: 'delivery',
        id: request.deliveryId,
        status: 'ACCEPTED',
        pickupAddress: request.pickup.address,
        dropoffAddress: request.dropoff.address,
        price: request.estimatedPrice,
      });
      setDeliveryRequests([]);
      Alert.alert('✅ Livraison acceptée !', `Récupération: ${request.pickup.address}`);
    } catch {
      Alert.alert('Erreur', 'Livraison déjà prise');
      setDeliveryRequests((prev) => prev.filter((d) => d.deliveryId !== request.deliveryId));
    }
  };

  const updateJobStatus = async (newStatus: string) => {
    if (!activeJob) return;

    try {
      const endpoint = activeJob.type === 'ride'
        ? `/rides/${activeJob.id}/status`
        : `/deliveries/${activeJob.id}/status`;

      await api.patch(endpoint, { status: newStatus });

      if (newStatus === 'COMPLETED' || newStatus === 'DELIVERED') {
        setEarnings((prev) => ({ today: prev.today + activeJob.price, trips: prev.trips + 1 }));
        Alert.alert('🎉 Terminé !', `+${activeJob.price.toLocaleString()} XAF`);
        setActiveJob(null);
      } else {
        setActiveJob({ ...activeJob, status: newStatus });
      }
    } catch {
      Alert.alert('Erreur', 'Impossible de mettre à jour le statut');
    }
  };

  const getNextStatus = (): { status: string; label: string } | null => {
    if (!activeJob) return null;

    if (activeJob.type === 'ride') {
      switch (activeJob.status) {
        case 'ACCEPTED': return { status: 'DRIVER_ARRIVING', label: '📍 Je suis arrivé au point de départ' };
        case 'DRIVER_ARRIVING': return { status: 'IN_PROGRESS', label: '🚗 Démarrer la course' };
        case 'IN_PROGRESS': return { status: 'COMPLETED', label: '✅ Course terminée' };
        default: return null;
      }
    } else {
      switch (activeJob.status) {
        case 'ACCEPTED': return { status: 'PICKING_UP', label: '📍 Je suis au point de retrait' };
        case 'PICKING_UP': return { status: 'IN_TRANSIT', label: '📦 Colis récupéré, en route' };
        case 'IN_TRANSIT': return { status: 'DELIVERED', label: '✅ Colis livré' };
        default: return null;
      }
    }
  };

  // Si une course/livraison est en cours
  if (activeJob) {
    const nextAction = getNextStatus();
    return (
      <View style={styles.container}>
        <View style={styles.activeJobCard}>
          <View style={styles.jobHeader}>
            <Text style={styles.jobType}>
              {activeJob.type === 'ride' ? '🚗 Course en cours' : '📦 Livraison en cours'}
            </Text>
            <Text style={styles.jobPrice}>{activeJob.price.toLocaleString()} XAF</Text>
          </View>

          <View style={styles.jobRoute}>
            <View style={styles.routePoint}>
              <View style={[styles.dot, { backgroundColor: colors.success }]} />
              <Text style={styles.routeText}>{activeJob.pickupAddress}</Text>
            </View>
            <View style={styles.routeLine} />
            <View style={styles.routePoint}>
              <View style={[styles.dot, { backgroundColor: colors.error }]} />
              <Text style={styles.routeText}>{activeJob.dropoffAddress}</Text>
            </View>
          </View>

          <View style={styles.statusInfo}>
            <Text style={styles.statusLabel}>Statut actuel</Text>
            <Text style={styles.statusValue}>{activeJob.status}</Text>
          </View>

          {nextAction && (
            <TouchableOpacity
              style={styles.nextButton}
              onPress={() => updateJobStatus(nextAction.status)}
              accessibilityRole="button"
              accessibilityLabel={nextAction.label}
            >
              <Text style={styles.nextButtonText}>{nextAction.label}</Text>
            </TouchableOpacity>
          )}

          {/* Bouton pour envoyer la position GPS */}
          <TouchableOpacity
            style={styles.gpsButton}
            onPress={() => {
              const socket = socketRef.current;
              if (socket) {
                socket.emit('driver:location', { lat: 4.052, lng: 9.769, rideId: activeJob.type === 'ride' ? activeJob.id : undefined });
              }
            }}
            accessibilityRole="button"
          >
            <Text style={styles.gpsButtonText}>📡 Envoyer ma position</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header chauffeur */}
      <View style={styles.driverHeader}>
        <View>
          <Text style={styles.driverGreeting}>Salut {user?.firstName} 🚗</Text>
          <Text style={styles.driverStatus}>
            {isOnline ? '🟢 En ligne' : '🔴 Hors ligne'}
          </Text>
        </View>
        <Switch
          value={isOnline}
          onValueChange={toggleOnline}
          trackColor={{ false: '#ccc', true: colors.primaryLight }}
          thumbColor={isOnline ? colors.primary : '#f4f3f4'}
          accessibilityLabel="Mettre en ligne ou hors ligne"
        />
      </View>

      {/* Gains du jour */}
      <View style={styles.earningsCard}>
        <Text style={styles.earningsLabel}>Gains aujourd'hui</Text>
        <Text style={styles.earningsAmount}>{earnings.today.toLocaleString()} XAF</Text>
        <Text style={styles.earningsTrips}>{earnings.trips} course(s)</Text>
      </View>

      {!isOnline ? (
        <View style={styles.offlineState}>
          <Text style={styles.offlineIcon}>💤</Text>
          <Text style={styles.offlineText}>Mettez-vous en ligne pour recevoir des demandes</Text>
        </View>
      ) : (
        <>
          {/* Demandes de course */}
          {rideRequests.length > 0 && (
            <View style={styles.requestsSection}>
              <Text style={styles.requestsTitle}>🚗 Demandes de course ({rideRequests.length})</Text>
              <FlatList
                data={rideRequests}
                keyExtractor={(item) => item.rideId}
                renderItem={({ item }) => (
                  <View style={styles.requestCard}>
                    <View style={styles.requestInfo}>
                      <Text style={styles.requestRoute}>
                        {item.pickup.address} → {item.dropoff.address}
                      </Text>
                      <Text style={styles.requestDetails}>
                        {item.distance.toFixed(1)} km • {item.duration} min • {item.vehicleType}
                      </Text>
                    </View>
                    <View style={styles.requestPricing}>
                      <Text style={styles.requestPrice}>
                        {(item.proposedPrice || item.estimatedPrice).toLocaleString()} F
                      </Text>
                      {item.proposedPrice && item.proposedPrice < item.estimatedPrice && (
                        <Text style={styles.negotiatedTag}>Négocié</Text>
                      )}
                    </View>
                    <View style={styles.requestActions}>
                      <TouchableOpacity
                        style={styles.acceptButton}
                        onPress={() => acceptRide(item)}
                        accessibilityRole="button"
                        accessibilityLabel="Accepter la course"
                      >
                        <Text style={styles.acceptText}>✅ Accepter</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.rejectButton}
                        onPress={() => setRideRequests((prev) => prev.filter((r) => r.rideId !== item.rideId))}
                        accessibilityRole="button"
                        accessibilityLabel="Refuser la course"
                      >
                        <Text style={styles.rejectText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              />
            </View>
          )}

          {/* Demandes de livraison */}
          {deliveryRequests.length > 0 && (
            <View style={styles.requestsSection}>
              <Text style={styles.requestsTitle}>📦 Demandes de livraison ({deliveryRequests.length})</Text>
              <FlatList
                data={deliveryRequests}
                keyExtractor={(item) => item.deliveryId}
                renderItem={({ item }) => (
                  <View style={styles.requestCard}>
                    <View style={styles.requestInfo}>
                      <Text style={styles.requestRoute}>
                        {item.pickup.address} → {item.dropoff.address}
                      </Text>
                      <Text style={styles.requestDetails}>
                        {item.distance.toFixed(1)} km • {item.packageType}
                      </Text>
                    </View>
                    <Text style={styles.requestPrice}>{item.estimatedPrice.toLocaleString()} F</Text>
                    <TouchableOpacity
                      style={styles.acceptButton}
                      onPress={() => acceptDelivery(item)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.acceptText}>✅ Prendre</Text>
                    </TouchableOpacity>
                  </View>
                )}
              />
            </View>
          )}

          {rideRequests.length === 0 && deliveryRequests.length === 0 && (
            <View style={styles.waitingState}>
              <Text style={styles.waitingIcon}>📡</Text>
              <Text style={styles.waitingText}>En attente de demandes...</Text>
              <Text style={styles.waitingHint}>Les demandes apparaîtront ici automatiquement</Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, paddingTop: spacing.xl + 20 },
  driverHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#fff', padding: spacing.lg, borderRadius: 12, marginBottom: spacing.lg,
  },
  driverGreeting: { fontSize: typography.lg, fontWeight: '700', color: colors.text },
  driverStatus: { fontSize: typography.sm, color: colors.textSecondary, marginTop: 4 },
  earningsCard: {
    backgroundColor: colors.primary, padding: spacing.lg, borderRadius: 12,
    alignItems: 'center', marginBottom: spacing.lg,
  },
  earningsLabel: { color: 'rgba(255,255,255,0.8)', fontSize: typography.sm },
  earningsAmount: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 4 },
  earningsTrips: { color: 'rgba(255,255,255,0.8)', fontSize: typography.sm, marginTop: 4 },
  offlineState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  offlineIcon: { fontSize: 48, marginBottom: spacing.md },
  offlineText: { fontSize: typography.md, color: colors.textSecondary, textAlign: 'center' },
  waitingState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  waitingIcon: { fontSize: 48, marginBottom: spacing.md },
  waitingText: { fontSize: typography.md, color: colors.textSecondary },
  waitingHint: { fontSize: typography.sm, color: colors.textLight, marginTop: 4 },
  requestsSection: { marginBottom: spacing.lg },
  requestsTitle: { fontSize: typography.md, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  requestCard: { backgroundColor: '#fff', padding: spacing.md, borderRadius: 12, marginBottom: spacing.sm, elevation: 2 },
  requestInfo: { marginBottom: spacing.sm },
  requestRoute: { fontSize: typography.sm, fontWeight: '600', color: colors.text },
  requestDetails: { fontSize: typography.xs, color: colors.textSecondary, marginTop: 2 },
  requestPricing: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  requestPrice: { fontSize: typography.lg, fontWeight: '800', color: colors.primary },
  negotiatedTag: { marginLeft: 8, backgroundColor: '#FFF8E1', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, fontSize: 10, color: '#F57C00' },
  requestActions: { flexDirection: 'row', alignItems: 'center' },
  acceptButton: { flex: 1, backgroundColor: '#E8F5E9', padding: spacing.sm, borderRadius: 8, alignItems: 'center', marginRight: spacing.sm },
  acceptText: { color: colors.success, fontWeight: '700' },
  rejectButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFEBEE', justifyContent: 'center', alignItems: 'center' },
  rejectText: { color: colors.error, fontWeight: '700', fontSize: 18 },
  // Active job
  activeJobCard: { backgroundColor: '#fff', padding: spacing.lg, borderRadius: 16, elevation: 4 },
  jobHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  jobType: { fontSize: typography.md, fontWeight: '700', color: colors.text },
  jobPrice: { fontSize: typography.lg, fontWeight: '800', color: colors.primary },
  jobRoute: { marginBottom: spacing.lg },
  routePoint: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  dot: { width: 12, height: 12, borderRadius: 6, marginRight: spacing.sm },
  routeLine: { width: 2, height: 20, backgroundColor: colors.border, marginLeft: 5, marginVertical: 2 },
  routeText: { fontSize: typography.sm, color: colors.text, flex: 1 },
  statusInfo: { backgroundColor: colors.background, padding: spacing.md, borderRadius: 10, marginBottom: spacing.md },
  statusLabel: { fontSize: typography.xs, color: colors.textSecondary },
  statusValue: { fontSize: typography.md, fontWeight: '700', color: colors.primary, marginTop: 2 },
  nextButton: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: 12, alignItems: 'center', marginBottom: spacing.sm },
  nextButtonText: { color: '#fff', fontWeight: '700', fontSize: typography.md },
  gpsButton: { backgroundColor: '#E3F2FD', padding: spacing.sm, borderRadius: 8, alignItems: 'center' },
  gpsButtonText: { color: colors.info, fontWeight: '600' },
});
