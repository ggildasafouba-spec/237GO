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

  const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
    try {
      const [result] = await Location.reverseGeocodeAsync({
        latitude: lat,
        longitude: lng,
      });

      if (result) {
        const parts = [
          result.street,
          result.district,
          result.city,
          result.region,
        ].filter(Boolean);
        return parts.join(', ') || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      }

      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch {
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
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
