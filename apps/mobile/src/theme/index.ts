export const colors = {
  // Vert Cameroun en couleur d'accent, sur base sombre élégante
  primary: '#1DB954',        // Vert vif (accent principal)
  primaryLight: '#2EE066',   // Vert clair
  primaryDark: '#0E7A35',    // Vert foncé
  secondary: '#FCD116',      // Jaune (étoile du drapeau)
  secondaryDark: '#E6B800',
  accent: '#CE1126',         // Rouge Cameroun
  accentDark: '#A50E1F',

  // Base sombre (Option 2 : anthracite premium)
  dark: '#121A17',           // Fond sombre principal (vert-nuit)
  darkElevated: '#1C2621',   // Surfaces sombres surélevées
  darkBorder: '#2C3A33',

  background: '#F4F7F4',     // Fond clair du contenu
  surface: '#FFFFFF',
  text: '#141A17',
  textSecondary: '#6B7B70',
  textLight: '#B0BDB4',
  error: '#CE1126',
  success: '#1DB954',
  warning: '#F57C00',
  info: '#1976D2',
  border: '#E2EAE4',
  disabled: '#9E9E9E',
};

// Dégradés
export const gradients = {
  flag: ['#1DB954', '#FCD116', '#CE1126'] as const,          // tricolore
  dark: ['#0C1310', '#1C2621', '#121A17'] as const,          // anthracite premium (Option 2)
  green: ['#0E7A35', '#1DB954'] as const,                    // vert
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const typography = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 28,
  title: 32,
};

export const borderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  round: 9999,
};
