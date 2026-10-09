import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  info: string;
}

/**
 * Capture toute erreur de rendu React et l'affiche à l'écran
 * au lieu de laisser l'app crasher silencieusement.
 * Utile pour diagnostiquer les crashs sur un build natif (APK)
 * où la console n'est pas accessible.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, info: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, info: '' };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    this.setState({ error, info: info.componentStack });
  }

  render() {
    if (this.state.hasError) {
      return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          <Text style={styles.title}>⚠️ Erreur 237GO</Text>
          <Text style={styles.subtitle}>Message :</Text>
          <Text style={styles.message}>
            {this.state.error?.message || 'Erreur inconnue'}
          </Text>
          <Text style={styles.subtitle}>Détail :</Text>
          <Text style={styles.stack}>
            {this.state.error?.stack || 'Pas de stack'}
          </Text>
          <Text style={styles.subtitle}>Composant :</Text>
          <Text style={styles.stack}>{this.state.info || 'N/A'}</Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121A17' },
  content: { padding: 20, paddingTop: 60 },
  title: { color: '#FCD116', fontSize: 22, fontWeight: '900', marginBottom: 16 },
  subtitle: { color: '#1DB954', fontSize: 15, fontWeight: '700', marginTop: 16, marginBottom: 4 },
  message: { color: '#fff', fontSize: 14 },
  stack: { color: '#B0BDB4', fontSize: 11, fontFamily: 'monospace' },
});
