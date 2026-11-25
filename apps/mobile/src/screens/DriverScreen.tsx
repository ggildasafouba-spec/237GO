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
  Linking,
  Modal,
  TextInput,
} from 'react-native';
import { useAuthStore } from '../store/authStore';
import { getSocket } from '../config/socket';
import { useLocation } from '../hooks/useLocation';
import RideMap from '../components/RideMap';
import SOSButton from '../components/SOSButton';
import api from '../config/api';
import { useSafeScreen } from '../hooks/useSafeScreen';
import { colors, spacing, typography } from '../theme';
import { formatPhone } from '../utils/phone';

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
  packageDesc?: string | null;
  isMarketOrder?: boolean; // commande de restaurant / boutique (GO Market)
}

// Une offre de prix n'est valable que 3 minutes (même durée que sur le serveur)
const OFFER_TTL_MS = 3 * 60 * 1000;

interface SentOffer {
  price: number;
  at: number;
  declined?: boolean;
}

interface ActiveJob {
  type: 'ride' | 'delivery';
  id: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  price: number;
  passengerPhone?: string;
  pickupCoords?: { lat: number; lng: number };
  dropoffCoords?: { lat: number; lng: number };
}

export default function DriverScreen({ navigation }: { navigation: any }) {
  const { user } = useAuthStore();
  const [isOnline, setIsOnline] = useState(false);
  const [rideRequests, setRideRequests] = useState<RideRequest[]>([]);
  const [deliveryRequests, setDeliveryRequests] = useState<DeliveryRequest[]>([]);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [earnings, setEarnings] = useState({ today: 0, trips: 0 });

  // Négociation : le chauffeur peut proposer un AUTRE prix au lieu d'accepter celui demandé
  const [offerFor, setOfferFor] = useState<RideRequest | null>(null);
  const [offerPrice, setOfferPrice] = useState('');
  const [sendingOffer, setSendingOffer] = useState(false);
  const [sentOffers, setSentOffers] = useState<Record<string, SentOffer>>({});
  // Fait passer les offres de plus de 3 min à « expirées » sans action de l'utilisateur
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 20000);
    return () => clearInterval(timer);
  }, []);

  const socketRef = useRef(getSocket());
  const { getCurrentLocation } = useLocation();
  const safe = useSafeScreen();

  // Envoi automatique de la position GPS réelle quand une course/livraison est active,
  // pour que le passager voie le chauffeur approcher en temps réel (ETA + marqueur carte).
  useEffect(() => {
    if (!activeJob || activeJob.type !== 'ride') return;
    let cancelled = false;

    const pushLocation = async () => {
      const loc = await getCurrentLocation();
      const socket = socketRef.current;
      if (loc && socket && !cancelled) {
        socket.emit('driver:location', { lat: loc.latitude, lng: loc.longitude, rideId: activeJob.id });
      }
    };

    pushLocation(); // envoi immédiat
    const interval = setInterval(pushLocation, 8000); // puis toutes les 8s

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeJob?.id]);

  // Copie de isOnline lisible depuis les écouteurs du socket (qui ne voient pas l'état à jour)
  const isOnlineRef = useRef(false);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);

  // Envoie au serveur la mise en ligne avec la position GPS actuelle
  const emitOnline = async (): Promise<boolean> => {
    const socket = socketRef.current;
    const loc = await getCurrentLocation();
    if (!socket || !loc) return false;
    socket.emit('driver:online', { lat: loc.latitude, lng: loc.longitude });
    return true;
  };

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socketRef.current = socket;

    // Écouter les nouvelles demandes de course (sans doublon si le rattrapage la renvoie)
    socket.on('new_ride_request', (data: RideRequest) => {
      Vibration.vibrate([0, 300, 100, 300]);
      setRideRequests((prev) => [data, ...prev.filter((r) => r.rideId !== data.rideId)]);
    });

    // Écouter les nouvelles demandes de livraison
    socket.on('new_delivery_request', (data: DeliveryRequest) => {
      Vibration.vibrate([0, 200, 100, 200]);
      setDeliveryRequests((prev) => [data, ...prev.filter((d) => d.deliveryId !== data.deliveryId)]);
    });

    // Le passager a choisi MON offre : la course démarre au prix convenu
    socket.on('ride_offer_accepted', (d: any) => {
      Vibration.vibrate([0, 300, 100, 300]);
      setActiveJob({
        type: 'ride',
        id: d.rideId,
        status: 'ACCEPTED',
        pickupAddress: d.pickup?.address || '',
        dropoffAddress: d.dropoff?.address || '',
        price: d.price,
        passengerPhone: d.passengerPhone || undefined,
        pickupCoords: d.pickup ? { lat: d.pickup.lat, lng: d.pickup.lng } : undefined,
        dropoffCoords: d.dropoff ? { lat: d.dropoff.lat, lng: d.dropoff.lng } : undefined,
      });
      setRideRequests([]);
      setSentOffers({});
      setOfferFor(null);
      Alert.alert('✅ Offre acceptée !', `Le passager a accepté ${Number(d.price).toLocaleString()} F.\nDirection : ${d.pickup?.address || 'le point de départ'}`);
    });

    // Le passager a refusé mon offre
    socket.on('ride_offer_declined', (d: any) => {
      setSentOffers((prev) => (prev[d?.rideId] ? { ...prev, [d.rideId]: { ...prev[d.rideId], declined: true } } : prev));
    });

    // Course annulée, ou un autre chauffeur a été choisi : la demande disparaît
    socket.on('ride_offer_closed', (d: any) => {
      setSentOffers((prev) => {
        const next = { ...prev };
        delete next[d?.rideId];
        return next;
      });
      setRideRequests((prev) => prev.filter((r) => r.rideId !== d?.rideId));
    });

    // Mise en ligne refusée par le serveur (dossier non validé, GPS invalide...) : on l'affiche
    // au lieu de laisser croire au chauffeur qu'il est en ligne.
    socket.on('driver:online_error', (data: { message?: string }) => {
      setIsOnline(false);
      Alert.alert('Mise en ligne impossible', data?.message || 'Réessayez dans un instant.');
    });

    // RECONNEXION : après une coupure (veille, changement de réseau), le serveur considère
    // le chauffeur hors ligne. Avant, l'app affichait toujours "En ligne" sans rien recevoir.
    // On se remet donc en ligne automatiquement.
    const onReconnect = () => {
      if (isOnlineRef.current) emitOnline();
    };
    socket.on('connect', onReconnect);

    return () => {
      socket.off('new_ride_request');
      socket.off('new_delivery_request');
      socket.off('ride_offer_accepted');
      socket.off('ride_offer_declined');
      socket.off('ride_offer_closed');
      socket.off('driver:online_error');
      socket.off('connect', onReconnect);
    };
  }, []);

  // En ligne SANS course : position envoyée toutes les 30 s, pour rester visible et être
  // trouvé au bon endroit par les clients (avant, la position n'était envoyée que pendant
  // une course, donc celle de la mise en ligne restait figée).
  useEffect(() => {
    if (!isOnline || activeJob) return;
    const interval = setInterval(async () => {
      const loc = await getCurrentLocation();
      if (loc && socketRef.current) {
        socketRef.current.emit('driver:location', { lat: loc.latitude, lng: loc.longitude });
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [isOnline, !!activeJob]);

  const toggleOnline = async () => {
    const socket = socketRef.current || getSocket();
    if (!socket) {
      Alert.alert('Connexion indisponible', 'Connexion au serveur impossible. Vérifiez votre réseau puis réessayez.');
      return;
    }
    socketRef.current = socket;

    if (!isOnline) {
      // 1) Récupérer la VRAIE position GPS du chauffeur (indispensable pour le
      //    matching de proximité : moto 4 km, voiture 6 km, livraison 7 km).
      const loc = await getCurrentLocation();
      if (!loc) {
        Alert.alert(
          'Localisation requise',
          "Impossible de récupérer votre position. Activez le GPS et autorisez la localisation pour vous mettre en ligne."
        );
        return;
      }

      // 2) Récupérer le VRAI type de véhicule depuis le profil chauffeur.
      //    On interroge /auth/me (qui inclut driverProfile). Repli = CAR_ECONOMY.
      let vehicleType = 'CAR_ECONOMY';
      try {
        const me = await api.get('/auth/me');
        const profileType = me.data?.data?.driverProfile?.vehicleType;
        if (profileType) vehicleType = profileType;
      } catch {
        /* en cas d'échec réseau, on garde le repli pour ne pas bloquer la mise en ligne */
      }

      // 3) Se mettre en ligne avec la vraie position + le vrai véhicule.
      socket.emit('driver:online', {
        vehicleType,
        lat: loc.latitude,
        lng: loc.longitude,
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
      const ride = response.data?.data;
      const passengerPhone = ride?.passenger?.phone;
      setActiveJob({
        type: 'ride',
        id: request.rideId,
        status: 'ACCEPTED',
        pickupAddress: ride?.pickupAddress || request.pickup.address,
        dropoffAddress: ride?.dropoffAddress || request.dropoff.address,
        price: request.proposedPrice || request.estimatedPrice,
        passengerPhone,
        pickupCoords: { lat: request.pickup.lat, lng: request.pickup.lng },
        dropoffCoords: { lat: request.dropoff.lat, lng: request.dropoff.lng },
      });
      setRideRequests([]);
      setSentOffers({});
      Alert.alert('✅ Course acceptée !', `Direction: ${request.pickup.address}`);
    } catch (error: any) {
      // 402 = solde insuffisant pour couvrir la commission d'une course en espèces
      if (error?.response?.status === 402) {
        Alert.alert(
          'Solde insuffisant 💰',
          error.response.data.message,
          [
            { text: 'Plus tard' },
            { text: 'Recharger', onPress: () => navigation.navigate('Wallet') },
          ]
        );
      } else {
        Alert.alert('Erreur', error?.response?.data?.message || 'Course déjà prise par un autre chauffeur');
        setRideRequests((prev) => prev.filter((r) => r.rideId !== request.rideId));
      }
    }
  };

  // ---- Négociation : proposer un autre prix au passager ----
  const openOffer = (request: RideRequest) => {
    const current = sentOffers[request.rideId]?.price ?? (request.proposedPrice || request.estimatedPrice);
    setOfferPrice(String(Math.round(current)));
    setOfferFor(request);
  };

  const adjustOffer = (delta: number) => {
    const current = parseFloat(offerPrice.replace(',', '.')) || offerFor?.estimatedPrice || 0;
    setOfferPrice(String(Math.max(1, Math.round(current + delta))));
  };

  const sendOffer = async () => {
    if (!offerFor || sendingOffer) return;
    const price = Math.round(parseFloat(offerPrice.replace(',', '.')));
    if (!price || price <= 0) {
      Alert.alert('Prix invalide', 'Entrez un prix en francs, par exemple 1500.');
      return;
    }
    setSendingOffer(true);
    const rideId = offerFor.rideId;
    try {
      await api.post(`/rides/${rideId}/offers`, { price });
      setSentOffers((prev) => ({ ...prev, [rideId]: { price, at: Date.now() } }));
      setOfferFor(null);
    } catch (error: any) {
      const status = error?.response?.status;
      const message: string = error?.response?.data?.message || 'Impossible d\'envoyer l\'offre. Réessayez.';
      if (status === 402) {
        // Course en espèces : il faut de quoi couvrir la commission sur le portefeuille
        setOfferFor(null);
        Alert.alert('Solde insuffisant 💰', message, [
          { text: 'Plus tard' },
          { text: 'Recharger', onPress: () => navigation.navigate('Wallet') },
        ]);
      } else {
        if (status === 409) setSentOffers((prev) => ({ ...prev, [rideId]: { price, at: Date.now(), declined: true } }));
        if (status === 400 && /non disponible/i.test(message)) {
          setRideRequests((prev) => prev.filter((r) => r.rideId !== rideId));
          setOfferFor(null);
        }
        Alert.alert('Offre non envoyée', message);
      }
    } finally {
      setSendingOffer(false);
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
        pickupCoords: { lat: request.pickup.lat, lng: request.pickup.lng },
        dropoffCoords: { lat: request.dropoff.lat, lng: request.dropoff.lng },
      });
      setDeliveryRequests([]);
      Alert.alert('✅ Livraison acceptée !', `Récupération: ${request.pickup.address}`);
    } catch (error: any) {
      if (error?.response?.status === 402) {
        Alert.alert(
          'Solde insuffisant 💰',
          error.response.data.message,
          [
            { text: 'Plus tard' },
            { text: 'Recharger', onPress: () => navigation.navigate('Wallet') },
          ]
        );
      } else {
        Alert.alert('Erreur', error?.response?.data?.message || 'Livraison déjà prise');
        setDeliveryRequests((prev) => prev.filter((d) => d.deliveryId !== request.deliveryId));
      }
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
        const jobId = activeJob.id;
        const isRide = activeJob.type === 'ride';
        // Proposer au chauffeur/livreur d'évaluer le client
        Alert.alert('🎉 Terminé !', `+${activeJob.price.toLocaleString()} XAF\n\nÉvaluer le client ?`, [
          { text: 'Plus tard', style: 'cancel', onPress: () => setActiveJob(null) },
          {
            text: 'Évaluer',
            onPress: () => {
              setActiveJob(null);
              navigation.navigate('Rating', {
                serviceType: isRide ? 'RIDE' : 'DELIVERY',
                serviceId: jobId,
                serviceLabel: isRide ? 'course' : 'livraison',
                ratedName: 'le client',
              });
            },
          },
        ]);
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
      <View style={[styles.container, safe.topBottom]}>
        <View style={styles.activeJobCard}>
          <View style={styles.jobHeader}>
            <Text style={styles.jobType}>
              {activeJob.type === 'ride' ? '🚗 Course en cours' : '📦 Livraison en cours'}
            </Text>
            <Text style={styles.jobPrice}>{activeJob.price.toLocaleString()} XAF</Text>
          </View>

          {/* Carte du trajet : point de départ (passager) → destination */}
          {activeJob.pickupCoords && (
            <RideMap
              pickup={activeJob.pickupCoords}
              dropoff={activeJob.dropoffCoords}
              pickupLabel={activeJob.pickupAddress}
              dropoffLabel={activeJob.dropoffAddress}
              height={180}
            />
          )}

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

          {/* Contact passager (dernier maillon : l'appel pour affiner le point de prise en charge) */}
          {activeJob.passengerPhone && (
            <TouchableOpacity
              style={styles.callPassenger}
              onPress={() => Linking.openURL(`tel:${activeJob.passengerPhone}`)}
              accessibilityRole="button"
              accessibilityLabel="Appeler le passager"
            >
              <Text style={styles.callPassengerText}>📞 Appeler le passager ({formatPhone(activeJob.passengerPhone)})</Text>
            </TouchableOpacity>
          )}

          <View style={styles.statusInfo}>
            <Text style={styles.statusLabel}>Statut actuel</Text>
            <Text style={styles.statusValue}>{activeJob.status}</Text>
          </View>

          {/* Le chauffeur / livreur aussi peut être en danger */}
          <SOSButton
            context={{ serviceType: activeJob.type === 'ride' ? 'RIDE' : 'DELIVERY', serviceId: activeJob.id }}
            style={{ marginBottom: spacing.md }}
          />

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

          {/* La position réelle est envoyée automatiquement toutes les 8 s pendant une course.
              (L'ancien bouton « Envoyer ma position » envoyait une position FIXE à Douala.) */}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, safe.topBottom]}>
      {/* Header chauffeur */}
      <View style={styles.driverHeader}>
        <TouchableOpacity
          style={styles.driverAvatar}
          onPress={() => navigation.navigate('Profile')}
          accessibilityLabel="Voir le profil et se déconnecter"
          accessibilityRole="button"
        >
          <Text style={styles.driverAvatarText}>
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </Text>
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: spacing.md }}>
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
                extraData={{ sentOffers, tick }}
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

                    {/* Négociation : proposer un autre prix, ou suivre l'offre déjà envoyée */}
                    {(() => {
                      const sent = sentOffers[item.rideId];
                      const live = !!sent && Date.now() - sent.at < OFFER_TTL_MS;
                      if (live && sent.declined) {
                        return (
                          <Text style={styles.offerDeclinedText}>
                            ❌ Le passager a refusé votre offre de {sent.price.toLocaleString()} F
                          </Text>
                        );
                      }
                      if (live) {
                        return (
                          <View style={styles.offerSentRow}>
                            <Text style={styles.offerSentText}>
                              ⏳ Offre envoyée : {sent.price.toLocaleString()} F, en attente du passager
                            </Text>
                            <TouchableOpacity onPress={() => openOffer(item)} accessibilityRole="button" accessibilityLabel="Modifier mon offre">
                              <Text style={styles.offerEditText}>Modifier</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      }
                      return (
                        <TouchableOpacity
                          style={styles.proposeButton}
                          onPress={() => openOffer(item)}
                          accessibilityRole="button"
                          accessibilityLabel="Proposer un autre prix"
                        >
                          <Text style={styles.proposeText}>💬 Proposer un autre prix</Text>
                        </TouchableOpacity>
                      );
                    })()}
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
                        {(item.distance ?? 0).toFixed(1)} km • {item.isMarketOrder ? `🍽️ ${item.packageDesc || 'Commande GO Market'}` : item.packageType}
                      </Text>
                      {item.isMarketOrder && (
                        <Text style={styles.requestDetails}>Déjà payée par le client : rien à encaisser</Text>
                      )}
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

      {/* Fenêtre de saisie du prix proposé */}
      <Modal visible={!!offerFor} transparent animationType="fade" onRequestClose={() => setOfferFor(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>💬 Proposer un autre prix</Text>
            {offerFor && (
              <Text style={styles.modalHint}>
                Prix demandé : {(offerFor.proposedPrice || offerFor.estimatedPrice).toLocaleString()} F{'\n'}
                Prix conseillé : {offerFor.estimatedPrice.toLocaleString()} F
              </Text>
            )}
            <View style={styles.modalInputRow}>
              <TextInput
                style={styles.modalInput}
                value={offerPrice}
                onChangeText={(t) => setOfferPrice(t.replace(/[^0-9]/g, ''))}
                keyboardType="numeric"
                placeholder="Ex : 1500"
                placeholderTextColor={colors.textLight}
                autoFocus
                accessibilityLabel="Prix proposé en francs"
              />
              <Text style={styles.modalUnit}>F</Text>
            </View>
            <View style={styles.chipsRow}>
              {[-100, 100, 200, 500].map((delta) => (
                <TouchableOpacity key={delta} style={styles.chip} onPress={() => adjustOffer(delta)} accessibilityRole="button">
                  <Text style={styles.chipText}>{delta > 0 ? `+${delta}` : delta}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.chip}
                onPress={() => offerFor && setOfferPrice(String(Math.round(offerFor.estimatedPrice)))}
                accessibilityRole="button"
              >
                <Text style={styles.chipText}>Conseillé</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalNote}>Le passager choisit parmi les offres reçues. Votre offre reste valable 3 minutes.</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setOfferFor(null)} accessibilityRole="button">
                <Text style={styles.modalCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSend, sendingOffer && { opacity: 0.6 }]}
                onPress={sendOffer}
                disabled={sendingOffer}
                accessibilityRole="button"
              >
                <Text style={styles.modalSendText}>{sendingOffer ? 'Envoi…' : 'Envoyer l\'offre'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg },
  driverHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#fff', padding: spacing.lg, borderRadius: 12, marginBottom: spacing.lg,
  },
  driverAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
  },
  driverAvatarText: { color: '#fff', fontSize: typography.md, fontWeight: '800' },
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
  // Négociation
  proposeButton: { marginTop: spacing.sm, padding: spacing.sm, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.primary },
  proposeText: { color: colors.primary, fontWeight: '700', fontSize: typography.sm },
  offerSentRow: { marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFF8E1', padding: spacing.sm, borderRadius: 8 },
  offerSentText: { flex: 1, color: '#8D6E00', fontSize: typography.xs, fontWeight: '600' },
  offerEditText: { color: colors.primary, fontWeight: '700', fontSize: typography.xs, marginLeft: spacing.sm },
  offerDeclinedText: { marginTop: spacing.sm, color: colors.error, fontSize: typography.xs, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: spacing.lg },
  modalTitle: { fontSize: typography.lg, fontWeight: '800', color: colors.text },
  modalHint: { fontSize: typography.sm, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 20 },
  modalInputRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md },
  modalInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md, fontSize: typography.xl, fontWeight: '800', color: colors.text },
  modalUnit: { marginLeft: spacing.sm, fontSize: typography.lg, fontWeight: '700', color: colors.textSecondary },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  chip: { backgroundColor: colors.background, borderRadius: 16, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, marginRight: spacing.sm, marginTop: spacing.xs },
  chipText: { color: colors.text, fontWeight: '600', fontSize: typography.sm },
  modalNote: { fontSize: typography.xs, color: colors.textSecondary, marginTop: spacing.md },
  modalActions: { flexDirection: 'row', marginTop: spacing.lg },
  modalCancel: { flex: 1, padding: spacing.md, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.border, marginRight: spacing.sm },
  modalCancelText: { color: colors.textSecondary, fontWeight: '700' },
  modalSend: { flex: 2, padding: spacing.md, borderRadius: 10, alignItems: 'center', backgroundColor: colors.primary },
  modalSendText: { color: '#fff', fontWeight: '700' },
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
  callPassenger: { backgroundColor: '#E8F5E9', padding: spacing.md, borderRadius: 10, alignItems: 'center', marginBottom: spacing.md },
  callPassengerText: { color: colors.primaryDark, fontWeight: '700' },
});
