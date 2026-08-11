import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useWalletStore } from '../store/walletStore';
import { colors, spacing, typography } from '../theme';

type PaymentProvider = 'ORANGE_MONEY' | 'MTN_MOMO' | 'EXPRESS_UNION';

const providers: { id: PaymentProvider; name: string; icon: string; color: string }[] = [
  { id: 'ORANGE_MONEY', name: 'Orange Money', icon: '🟠', color: '#FF6600' },
  { id: 'MTN_MOMO', name: 'MTN MoMo', icon: '🟡', color: '#FFCC00' },
  { id: 'EXPRESS_UNION', name: 'Express Union', icon: '🔵', color: '#0066CC' },
];

const quickAmounts = [1000, 2000, 5000, 10000, 20000, 50000];

export default function WalletScreen() {
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw' | 'loyalty'>('deposit');
  const [amount, setAmount] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<PaymentProvider>('ORANGE_MONEY');
  const [phone, setPhone] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const {
    balance,
    loyaltyPoints,
    loyaltyTier,
    fetchBalance,
    fetchLoyalty,
    deposit,
    withdraw,
    redeemPoints,
  } = useWalletStore();

  useEffect(() => {
    fetchBalance();
    fetchLoyalty();
  }, []);

  const handleDeposit = async () => {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount < 100) {
      Alert.alert('Erreur', 'Montant minimum: 100 XAF');
      return;
    }

    setIsProcessing(true);
    try {
      const result = await deposit(numAmount, selectedProvider, phone);
      Alert.alert(
        '✅ Recharge réussie !',
        `${numAmount.toLocaleString()} XAF ajoutés${result.bonus > 0 ? ` + ${result.bonus.toLocaleString()} XAF bonus 🎉` : ''}`
      );
      setAmount('');
    } catch {
      Alert.alert('Erreur', 'La recharge a échoué. Réessayez.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWithdraw = async () => {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount < 500) {
      Alert.alert('Erreur', 'Montant minimum de retrait: 500 XAF');
      return;
    }
    if (!phone.match(/^6[0-9]{8}$/)) {
      Alert.alert('Erreur', 'Numéro de téléphone invalide');
      return;
    }

    setIsProcessing(true);
    try {
      await withdraw(numAmount, selectedProvider, phone);
      Alert.alert('✅ Retrait effectué', `${numAmount.toLocaleString()} XAF envoyés vers ${phone}`);
      setAmount('');
    } catch {
      Alert.alert('Erreur', 'Le retrait a échoué. Vérifiez votre solde.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRedeemPoints = () => {
    if (loyaltyPoints < 100) {
      Alert.alert('Points insuffisants', 'Il faut minimum 100 points pour échanger');
      return;
    }

    Alert.alert(
      'Échanger vos points',
      `${loyaltyPoints} points = ${(loyaltyPoints * 10).toLocaleString()} XAF\nVoulez-vous échanger tous vos points ?`,
      [
        { text: 'Annuler' },
        {
          text: 'Échanger',
          onPress: async () => {
            try {
              await redeemPoints(loyaltyPoints);
              Alert.alert('🎉 Échange réussi !', `${(loyaltyPoints * 10).toLocaleString()} XAF ajoutés à votre portefeuille`);
            } catch {
              Alert.alert('Erreur', 'L\'échange a échoué');
            }
          },
        },
      ]
    );
  };

  const getTierColor = () => {
    switch (loyaltyTier) {
      case 'BRONZE': return '#CD7F32';
      case 'SILVER': return '#C0C0C0';
      case 'GOLD': return '#FFD700';
      case 'PLATINUM': return '#E5E4E2';
      default: return '#CD7F32';
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Balance Card */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Solde disponible</Text>
        <Text style={styles.balanceAmount}>{balance.toLocaleString()} XAF</Text>
        <View style={styles.loyaltyRow}>
          <View style={[styles.tierBadge, { backgroundColor: getTierColor() }]}>
            <Text style={styles.tierText}>{loyaltyTier}</Text>
          </View>
          <Text style={styles.pointsText}>⭐ {loyaltyPoints} points</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'deposit' && styles.tabActive]}
          onPress={() => setActiveTab('deposit')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'deposit' }}
        >
          <Text style={[styles.tabText, activeTab === 'deposit' && styles.tabTextActive]}>Recharger</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'withdraw' && styles.tabActive]}
          onPress={() => setActiveTab('withdraw')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'withdraw' }}
        >
          <Text style={[styles.tabText, activeTab === 'withdraw' && styles.tabTextActive]}>Retirer</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'loyalty' && styles.tabActive]}
          onPress={() => setActiveTab('loyalty')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'loyalty' }}
        >
          <Text style={[styles.tabText, activeTab === 'loyalty' && styles.tabTextActive]}>Fidélité</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {(activeTab === 'deposit' || activeTab === 'withdraw') && (
        <View style={styles.content}>
          {/* Quick amounts */}
          <Text style={styles.label}>Montant</Text>
          <View style={styles.quickAmounts}>
            {quickAmounts.map((amt) => (
              <TouchableOpacity
                key={amt}
                style={[styles.quickAmount, amount === String(amt) && styles.quickAmountSelected]}
                onPress={() => setAmount(String(amt))}
                accessibilityLabel={`${amt.toLocaleString()} francs`}
              >
                <Text style={[styles.quickAmountText, amount === String(amt) && styles.quickAmountTextSelected]}>
                  {amt >= 1000 ? `${amt / 1000}k` : amt}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.amountInput}
            placeholder="Ou entrez un montant"
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholderTextColor={colors.textLight}
            accessibilityLabel="Montant personnalisé"
          />

          {amount && parseFloat(amount) >= 5000 && activeTab === 'deposit' && (
            <View style={styles.bonusBanner}>
              <Text style={styles.bonusText}>🎉 Bonus 5% : +{Math.floor(parseFloat(amount) * 0.05).toLocaleString()} XAF offerts !</Text>
            </View>
          )}

          {/* Provider selection */}
          <Text style={styles.label}>Via</Text>
          {providers.map((provider) => (
            <TouchableOpacity
              key={provider.id}
              style={[styles.providerCard, selectedProvider === provider.id && styles.providerSelected]}
              onPress={() => setSelectedProvider(provider.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: selectedProvider === provider.id }}
              accessibilityLabel={provider.name}
            >
              <Text style={styles.providerIcon}>{provider.icon}</Text>
              <Text style={styles.providerName}>{provider.name}</Text>
              {selectedProvider === provider.id && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
          ))}

          {/* Phone for withdrawal */}
          {activeTab === 'withdraw' && (
            <TextInput
              style={styles.phoneInput}
              placeholder="Numéro de téléphone (6XXXXXXXX)"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              maxLength={9}
              placeholderTextColor={colors.textLight}
              accessibilityLabel="Numéro pour le retrait"
            />
          )}

          <TouchableOpacity
            style={[styles.button, isProcessing && styles.buttonDisabled]}
            onPress={activeTab === 'deposit' ? handleDeposit : handleWithdraw}
            disabled={isProcessing}
            accessibilityLabel={activeTab === 'deposit' ? 'Confirmer la recharge' : 'Confirmer le retrait'}
            accessibilityRole="button"
          >
            {isProcessing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {activeTab === 'deposit' ? 'Recharger' : 'Retirer'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {activeTab === 'loyalty' && (
        <View style={styles.content}>
          <View style={styles.loyaltyCard}>
            <Text style={styles.loyaltyTitle}>Programme de fidélité 237GO</Text>
            <Text style={styles.loyaltyPointsBig}>⭐ {loyaltyPoints} points</Text>
            <Text style={styles.loyaltyEquiv}>= {(loyaltyPoints * 10).toLocaleString()} XAF</Text>

            <View style={styles.tierProgress}>
              <Text style={styles.tierLabel}>Niveau actuel: {loyaltyTier}</Text>
            </View>

            <View style={styles.howToEarn}>
              <Text style={styles.howToEarnTitle}>Comment gagner des points ?</Text>
              <Text style={styles.howToEarnItem}>• 1 point par course de 100 XAF</Text>
              <Text style={styles.howToEarnItem}>• 1 point par recharge de 500 XAF</Text>
              <Text style={styles.howToEarnItem}>• Bonus x2 les week-ends</Text>
              <Text style={styles.howToEarnItem}>• Parrainage: 50 points par filleul</Text>
            </View>

            <TouchableOpacity
              style={[styles.button, loyaltyPoints < 100 && styles.buttonDisabled]}
              onPress={handleRedeemPoints}
              disabled={loyaltyPoints < 100}
              accessibilityLabel="Échanger mes points"
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>Échanger mes points</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={{ height: 50 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: spacing.xl + 20,
  },
  balanceCard: {
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: 16,
    elevation: 4,
  },
  balanceLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: typography.sm,
  },
  balanceAmount: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '800',
    marginTop: 4,
  },
  loyaltyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  tierBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    marginRight: spacing.sm,
  },
  tierText: {
    fontSize: typography.xs,
    fontWeight: '700',
    color: '#fff',
  },
  pointsText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: typography.sm,
  },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#fff',
  },
  content: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  label: {
    fontSize: typography.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  quickAmounts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: spacing.md,
  },
  quickAmount: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 8,
    margin: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickAmountSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  quickAmountText: {
    fontSize: typography.sm,
    color: colors.text,
    fontWeight: '600',
  },
  quickAmountTextSelected: {
    color: '#fff',
  },
  amountInput: {
    backgroundColor: '#fff',
    padding: spacing.md,
    borderRadius: 12,
    fontSize: typography.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    textAlign: 'center',
    fontWeight: '700',
  },
  bonusBanner: {
    backgroundColor: '#FFF8E1',
    padding: spacing.sm,
    borderRadius: 8,
    marginBottom: spacing.md,
  },
  bonusText: {
    color: '#F57C00',
    fontSize: typography.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
  providerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: '#fff',
    borderRadius: 10,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  providerSelected: {
    borderColor: colors.primary,
    backgroundColor: '#E8F5E9',
  },
  providerIcon: {
    fontSize: 20,
    marginRight: spacing.md,
  },
  providerName: {
    flex: 1,
    fontSize: typography.md,
    color: colors.text,
  },
  checkmark: {
    fontSize: typography.md,
    color: colors.primary,
    fontWeight: '700',
  },
  phoneInput: {
    backgroundColor: '#fff',
    padding: spacing.md,
    borderRadius: 12,
    fontSize: typography.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.md,
  },
  button: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: typography.md,
    fontWeight: '700',
  },
  loyaltyCard: {
    backgroundColor: '#fff',
    padding: spacing.lg,
    borderRadius: 16,
  },
  loyaltyTitle: {
    fontSize: typography.lg,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  loyaltyPointsBig: {
    fontSize: 36,
    fontWeight: '800',
    color: colors.secondary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  loyaltyEquiv: {
    fontSize: typography.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  tierProgress: {
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  tierLabel: {
    fontSize: typography.sm,
    color: colors.textSecondary,
  },
  howToEarn: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.background,
    borderRadius: 12,
  },
  howToEarnTitle: {
    fontSize: typography.sm,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  howToEarnItem: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    marginBottom: 4,
  },
});
