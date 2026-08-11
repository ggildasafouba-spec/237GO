import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { ActivityIndicator, View, Text } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { colors } from '../theme';

// Screens
import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import RideScreen from '../screens/RideScreen';
import WalletScreen from '../screens/WalletScreen';
import DeliveryScreen from '../screens/DeliveryScreen';
import MarketScreen from '../screens/MarketScreen';
import CarpoolScreen from '../screens/CarpoolScreen';
import ProfileScreen from '../screens/ProfileScreen';
import RatingScreen from '../screens/RatingScreen';
import DriverScreen from '../screens/DriverScreen';
import HistoryScreen from '../screens/HistoryScreen';
import RentalScreen from '../screens/RentalScreen';
import BusinessScreen from '../screens/BusinessScreen';
import PlaceholderScreen from '../screens/PlaceholderScreen';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Accueil: '🏠',
    Course: '🚗',
    Portefeuille: '💰',
    Chauffeur: '🚕',
    Plus: '⚙️',
  };
  return (
    <Text style={{ fontSize: focused ? 22 : 18, opacity: focused ? 1 : 0.5 }}>
      {icons[label] || '📱'}
    </Text>
  );
}

function PassengerTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { height: 60, paddingBottom: 8, paddingTop: 4 },
        tabBarIcon: ({ focused }) => <TabIcon label={route.name} focused={focused} />,
      })}
    >
      <Tab.Screen
        name="Accueil"
        component={HomeScreen}
        options={{ tabBarAccessibilityLabel: "Page d'accueil" }}
      />
      <Tab.Screen
        name="Course"
        component={RideScreen}
        options={{ tabBarAccessibilityLabel: 'Commander une course' }}
      />
      <Tab.Screen
        name="Portefeuille"
        component={WalletScreen}
        options={{ tabBarAccessibilityLabel: 'Mon portefeuille' }}
      />
      <Tab.Screen
        name="Plus"
        component={ProfileScreen}
        options={{ tabBarAccessibilityLabel: "Plus d'options" }}
      />
    </Tab.Navigator>
  );
}

function DriverTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { height: 60, paddingBottom: 8, paddingTop: 4 },
        tabBarIcon: ({ focused }) => <TabIcon label={route.name} focused={focused} />,
      })}
    >
      <Tab.Screen
        name="Chauffeur"
        component={DriverScreen}
        options={{ tabBarAccessibilityLabel: 'Mode chauffeur' }}
      />
      <Tab.Screen
        name="Accueil"
        component={HomeScreen}
        options={{ tabBarAccessibilityLabel: "Page d'accueil" }}
      />
      <Tab.Screen
        name="Portefeuille"
        component={WalletScreen}
        options={{ tabBarAccessibilityLabel: 'Mon portefeuille' }}
      />
      <Tab.Screen
        name="Plus"
        component={ProfileScreen}
        options={{ tabBarAccessibilityLabel: "Plus d'options" }}
      />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { isAuthenticated, isLoading, loadUser, user } = useAuthStore();

  useEffect(() => {
    loadUser();
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.primary }}>
        <Text style={{ fontSize: 36, fontWeight: '900', color: '#fff', marginBottom: 12 }}>237GO</Text>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : (
          <>
            <Stack.Screen
              name="Main"
              component={user?.role === 'DRIVER' ? DriverTabs : PassengerTabs}
            />
            <Stack.Screen name="Ride" component={RideScreen} />
            <Stack.Screen name="Delivery" component={DeliveryScreen} />
            <Stack.Screen name="Market" component={MarketScreen} />
            <Stack.Screen name="Carpool" component={CarpoolScreen} />
            <Stack.Screen name="Rental" component={RentalScreen} />
            <Stack.Screen name="Business" component={BusinessScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="Rating" component={RatingScreen} />
            <Stack.Screen name="DriverMode" component={DriverScreen} />
            <Stack.Screen name="History" component={HistoryScreen} />
            <Stack.Screen name="BecomeDriver" component={PlaceholderScreen} />
            <Stack.Screen name="BecomeMerchant" component={PlaceholderScreen} />
            <Stack.Screen name="Wallet" component={WalletScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
