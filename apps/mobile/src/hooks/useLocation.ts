import { useState, useEffect, useRef } from 'react';
import * as Location from 'expo-location';

interface LocationData {
  latitude: number;
  longitude: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
}

interface UseLocationReturn {
  location: LocationData | null;
  address: string | null;
  errorMsg: string | null;
  isLoading: boolean;
  requestPermission: () => Promise<boolean>;
  getCurrentLocation: () => Promise<LocationData | null>;
  startWatching: () => Promise<void>;
  stopWatching: () => void;
  reverseGeocode: (lat: number, lng: number) => Promise<string>;
}

export function useLocation(): UseLocationReturn {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const watcherRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    return () => {
      stopWatching();
    };
  }, []);

  const requestPermission = async (): Promise<boolean> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        return true;
      }
      setErrorMsg('Permission de localisation refusée');
      return false;
    } catch {
      setErrorMsg('Erreur lors de la demande de permission');
      return false;
    }
  };

  const getCurrentLocation = async (): Promise<LocationData | null> => {
    setIsLoading(true);
    try {
      const hasPermission = await requestPermission();
      if (!hasPermission) {
        setIsLoading(false);
        return null;
      }

      const result = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const locationData: LocationData = {
        latitude: result.coords.latitude,
        longitude: result.coords.longitude,
        accuracy: result.coords.accuracy || undefined,
        heading: result.coords.heading || undefined,
        speed: result.coords.speed || undefined,
      };

      setLocation(locationData);
      setIsLoading(false);

      // Obtenir l'adresse
      const addr = await reverseGeocode(locationData.latitude, locationData.longitude);
      setAddress(addr);

      return locationData;
    } catch {
      setErrorMsg('Impossible d\'obtenir la position');
      setIsLoading(false);
      return null;
    }
  };

  const startWatching = async (): Promise<void> => {
    const hasPermission = await requestPermission();
    if (!hasPermission) return;

    // Demander aussi la permission background pour le tracking chauffeur
    const { status } = await Location.requestBackgroundPermissionsAsync();

    watcherRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000, // Toutes les 5 secondes
        distanceInterval: 10, // Ou tous les 10 mètres
      },
      (newLocation) => {
        setLocation({
          latitude: newLocation.coords.latitude,
          longitude: newLocation.coords.longitude,
          accuracy: newLocation.coords.accuracy || undefined,
          heading: newLocation.coords.heading || undefined,
          speed: newLocation.coords.speed || undefined,
        });
      }
    );
  };

  const stopWatching = () => {
    if (watcherRef.current) {
      watcherRef.current.remove();
      watcherRef.current = null;
    }
  };

  // Libellé de repli lisible quand aucun nom de lieu n'est trouvé (fréquent au Cameroun).
  // On n'affiche plus de coordonnées brutes à l'utilisateur/chauffeur.
  const FALLBACK_LABEL = '📍 Position GPS (voir sur la carte)';

  /**
   * Convertit des coordonnées en nom de lieu lisible.
   * 1) Essaie le géocodeur natif Expo (rapide, mais couvre mal le Cameroun).
   * 2) Si échec/vide, interroge Nominatim (OpenStreetMap), bien plus riche localement.
   * 3) En dernier recours, renvoie un libellé propre (pas de chiffres bruts).
   */
  const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
    // 1) Géocodeur natif Expo
    try {
      const [result] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (result) {
        const parts = [result.name, result.street, result.district, result.city, result.region]
          .filter(Boolean)
          // éviter les doublons (ex. name == street)
          .filter((v, i, arr) => arr.indexOf(v) === i);
        if (parts.length > 0) return parts.join(', ');
      }
    } catch {
      /* on tente Nominatim ci-dessous */
    }

    // 2) Nominatim (OpenStreetMap) — meilleure couverture des quartiers camerounais
    try {
      const osm = await reverseGeocodeOSM(lat, lng);
      if (osm) return osm;
    } catch {
      /* on retombe sur le libellé propre */
    }

    // 3) Libellé propre (plus de "4.0511, 9.7679")
    return FALLBACK_LABEL;
  };

  /**
   * Géocodage inverse via l'API publique Nominatim d'OpenStreetMap.
   * Construit un libellé court à partir des composants d'adresse les plus parlants.
   */
  const reverseGeocodeOSM = async (lat: number, lng: number): Promise<string | null> => {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${lat}&lon=${lng}&zoom=17&addressdetails=1&accept-language=fr`;
    const res = await fetch(url, {
      headers: {
        // Nominatim exige un User-Agent identifiant l'application.
        'User-Agent': '237GO/1.0 (support@237go.app)',
      },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const a = data?.address || {};
    // Priorité aux repères parlants : lieu/commerce, rue, quartier, arrondissement, ville.
    const parts = [
      a.amenity || a.shop || a.building || a.name,
      a.road,
      a.neighbourhood || a.suburb || a.quarter,
      a.city_district,
      a.city || a.town || a.village,
    ]
      .filter(Boolean)
      .filter((v: string, i: number, arr: string[]) => arr.indexOf(v) === i);

    if (parts.length > 0) return parts.slice(0, 3).join(', ');
    // Nominatim renvoie parfois un display_name complet : on le raccourcit.
    if (data?.display_name) {
      return String(data.display_name).split(',').slice(0, 3).join(',').trim();
    }
    return null;
  };

  return {
    location,
    address,
    errorMsg,
    isLoading,
    requestPermission,
    getCurrentLocation,
    startWatching,
    stopWatching,
    reverseGeocode,
  };
}
