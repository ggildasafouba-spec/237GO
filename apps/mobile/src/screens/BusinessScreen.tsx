import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useBusinessStore } from '../store/businessStore';
import { colors, spacing, typography } from '../theme';

type ViewMode = 'list' | 'create' | 'dashboard' | 'add-member';

export default function BusinessScreen({ navigation }: { navigation: any }) {
  const [view, setView] = useState<ViewMode>('list');
  const [name, setName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [address, setAddress] = useState('');
  const [monthlyBudget, setMonthlyBudget] = useState('');
  const [memberPhone, setMemberPhone] = useState('');
  const [memberRole, setMemberRole] = useState('EMPLOYEE');
  const [memberLimit, setMemberLimit] = useState('');

  const {
    myAccounts,
    currentAccount,
    isLoading,
    fetchMyAccounts,
    createAccount,
    fetchDashboard,
    addMember,
  } = useBusinessStore();

  useEffect(() => {
    fetchMyAccounts();
  }, []);

  const handleCreate = async () => {
    if (!name || !contactEmail || !contactPhone) {
      Alert.alert('Attention', 'Nom, email et téléphone requis');
      return;
    }
    if (!contactPhone.match(/^6[0-9]{8}$/)) {
      Alert.alert('Erreur', 'Numéro de téléphone invalide');
      return;
    }

    try {
      await createAccount({
        name,
        contactEmail,
        contactPhone,
        address: address || undefined,
        monthlyBudget: monthlyBudget ? parseFloat(monthlyBudget) : undefined,
      });
      Alert.alert('✅ Compte entreprise créé !', 'Vous pouvez maintenant ajouter des membres.');
      fetchMyAccounts();
      setView('list');
      setName(''); setContactEmail(''); setContactPhone(''); setAddress(''); setMonthlyBudget('');
    } catch {
      Alert.alert('Erreur', 'Impossible de créer le compte');
    }
  };

  const handleAddMember = async () => {
    if (!memberPhone || !currentAccount) {
      Alert.alert('Attention', 'Numéro de téléphone requis');
      return;
    }

    try {
      // Note: en prod, chercher l'userId par téléphone
      await addMember(currentAccount.account.id, {
        userId: memberPhone, // TODO: résoudre userId depuis le téléphone
        role: memberRole,
        monthlyLimit: memberLimit ? parseFloat(memberLimit) : undefined,
      });
      Alert.alert('✅ Membre ajouté !');
      fetchDashboard(currentAccount.account.id);
      setMemberPhone(''); setMemberLimit('');
      setView('dashboard');
    } catch {
      Alert.alert('Erreur', 'Impossible d\'ajouter le membre');
    }
  };

  // Vue: Liste des comptes
  if (view === 'list') {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Retour</Text>
        </TouchableOpacity>

        <Text style={styles.title}>💼 GO Business</Text>
        <Text style={styles.subtitle}>Gestion des déplacements entreprise</Text>

        {isLoading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={myAccounts}
            keyExtractor={(item) => item.business.id}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <TouchableOpacity
                style={styles.createCard}
                onPress={() => setView('create')}
                accessibilityRole="button"
                accessibilityLabel="Créer un compte entreprise"
              >
                <Text style={styles.createIcon}>➕</Text>
                <Text style={styles.createText}>Créer un compte entreprise</Text>
              </TouchableOpacity>
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>💼</Text>
                <Text style={styles.emptyText}>Aucun compte entreprise</Text>
                <Text style={styles.emptyHint}>Créez un compte pour gérer les déplacements de vos employés</Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.accountCard}
                onPress={() => { fetchDashboard(item.business.id); setView('dashboard'); }}
                accessibilityRole="button"
              >
                <View style={styles.accountHeader}>
                  <Text style={styles.accountName}>{item.business.name}</Text>
                  <View style={[styles.roleBadge, { backgroundColor: item.role === 'ADMIN' ? '#E8F5E9' : '#E3F2FD' }]}>
                    <Text style={[styles.roleBadgeText, { color: item.role === 'ADMIN' ? colors.primary : colors.info }]}>
                      {item.role}
                    </Text>
                  </View>
                </View>
                <Text style={styles.accountEmail}>{item.business.contactEmail}</Text>
                {item.business.monthlyBudget && (
                  <Text style={styles.accountBudget}>
                    Budget: {item.business.monthlyBudget.toLocaleString()} XAF/mois
                  </Text>
                )}
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    );
  }

  // Vue: Créer un compte
  if (view === 'create') {
    return (
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => setView('list')} style={styles.backBtn}>
          <Text style={styles.backText}>← Mes comptes</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Nouveau compte entreprise</Text>
        <Text style={styles.subtitle}>Centralisez la gestion des déplacements</Text>

        <Text style={styles.sectionLabel}>Informations de l'entreprise</Text>
        <TextInput
          style={styles.input}
          placeholder="Nom de l'entreprise"
          value={name}
          onChangeText={setName}
          placeholderTextColor={colors.textLight}
          accessibilityLabel="Nom de l'entreprise"
        />
        <TextInput
          style={styles.input}
          placeholder="Adresse (optionnel)"
          value={address}
          onChangeText={setAddress}
          placeholderTextColor={colors.textLight}
          accessibilityLabel="Adresse de l'entreprise"
        />

        <Text style={styles.sectionLabel}>Contact</Text>
        <TextInput
          style={styles.input}
          placeholder="Email de contact"
          value={contactEmail}
          onChangeText={setContactEmail}
          keyboardType="email-address"
          placeholderTextColor={colors.textLight}
          accessibilityLabel="Email de contact"
        />
        <TextInput
          style={styles.input}
          placeholder="Téléphone (6XXXXXXXX)"
          value={contactPhone}
          onChangeText={setContactPhone}
          keyboardType="phone-pad"
          maxLength={9}
          placeholderTextColor={colors.textLight}
          accessibilityLabel="Téléphone de contact"
        />

        <Text style={styles.sectionLabel}>Budget mensuel (optionnel)</Text>
        <TextInput
          style={styles.input}
          placeholder="Budget en XAF (ex: 500000)"
          value={monthlyBudget}
          onChangeText={setMonthlyBudget}
          keyboardType="numeric"
          placeholderTextColor={colors.textLight}
          accessibilityLabel="Budget mensuel de l'entreprise"
        />

        <View style={styles.infoBox}>
          <Text style={styles.infoBoxTitle}>✨ Avantages GO Business</Text>
          <Text style={styles.infoBoxItem}>• Facturation mensuelle centralisée</Text>
          <Text style={styles.infoBoxItem}>• Suivi des déplacements en temps réel</Text>
          <Text style={styles.infoBoxItem}>• Rapports détaillés par employé</Text>
          <Text style={styles.infoBoxItem}>• Limites budgétaires par membre</Text>
          <Text style={styles.infoBoxItem}>• Tarifs préférentiels entreprise</Text>
        </View>

        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleCreate}
          disabled={isLoading}
          accessibilityRole="button"
        >
          {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Créer le compte</Text>}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // Vue: Dashboard
  if (view === 'dashboard' && currentAccount) {
    return (
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => setView('list')} style={styles.backBtn}>
          <Text style={styles.backText}>← Mes comptes</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{currentAccount.account.name}</Text>

        {/* Stats */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{currentAccount.stats.totalMembers}</Text>
            <Text style={styles.statLabel}>Membres</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{currentAccount.stats.totalTrips}</Text>
            <Text style={styles.statLabel}>Courses</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{currentAccount.stats.budgetUsed.toLocaleString()}</Text>
            <Text style={styles.statLabel}>XAF dépensés</Text>
          </View>
        </View>

        {/* Budget */}
        {currentAccount.stats.monthlyBudget > 0 && (
          <View style={styles.budgetCard}>
            <View style={styles.budgetHeader}>
              <Text style={styles.budgetLabel}>Budget mensuel</Text>
              <Text style={styles.budgetAmount}>{currentAccount.stats.monthlyBudget.toLocaleString()} XAF</Text>
            </View>
            <View style={styles.budgetBarBg}>
              <View
                style={[
                  styles.budgetBarFill,
                  { width: `${Math.min(100, (currentAccount.stats.budgetUsed / currentAccount.stats.monthlyBudget) * 100)}%` },
                ]}
              />
            </View>
            <Text style={styles.budgetUsed}>
              {currentAccount.stats.budgetUsed.toLocaleString()} / {currentAccount.stats.monthlyBudget.toLocaleString()} XAF utilisés
            </Text>
          </View>
        )}

        {/* Membres */}
        <View style={styles.membersSection}>
          <View style={styles.membersHeader}>
            <Text style={styles.membersTitle}>Membres ({currentAccount.account.members.length})</Text>
            <TouchableOpacity onPress={() => setView('add-member')}>
              <Text style={styles.addMemberBtn}>+ Ajouter</Text>
            </TouchableOpacity>
          </View>

          {currentAccount.account.members.map((member) => (
            <View key={member.id} style={styles.memberCard}>
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>{member.user.firstName} {member.user.lastName}</Text>
                <Text style={styles.memberPhone}>{member.user.phone}</Text>
              </View>
              <View>
                <View style={[styles.roleBadge, { backgroundColor: member.role === 'ADMIN' ? '#E8F5E9' : member.role === 'MANAGER' ? '#E3F2FD' : '#F5F5F5' }]}>
                  <Text style={[styles.roleBadgeText, { color: member.role === 'ADMIN' ? colors.primary : member.role === 'MANAGER' ? colors.info : colors.textSecondary }]}>
                    {member.role}
                  </Text>
                </View>
                {member.monthlyLimit && (
                  <Text style={styles.memberLimit}>Limite: {member.monthlyLimit.toLocaleString()} XAF</Text>
                )}
              </View>
            </View>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // Vue: Ajouter un membre
  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <TouchableOpacity onPress={() => setView('dashboard')} style={styles.backBtn}>
        <Text style={styles.backText}>← Dashboard</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Ajouter un membre</Text>
      <Text style={styles.subtitle}>Ajoutez un employé au compte entreprise</Text>

      <Text style={styles.sectionLabel}>Téléphone de l'employé</Text>
      <TextInput
        style={styles.input}
        placeholder="Numéro 237GO de l'employé (6XXXXXXXX)"
        value={memberPhone}
        onChangeText={setMemberPhone}
        keyboardType="phone-pad"
        maxLength={9}
        placeholderTextColor={colors.textLight}
        accessibilityLabel="Téléphone de l'employé"
      />

      <Text style={styles.sectionLabel}>Rôle</Text>
      <View style={styles.roleOptions}>
        {[
          { id: 'EMPLOYEE', label: 'Employé', desc: 'Peut commander des courses' },
          { id: 'MANAGER', label: 'Manager', desc: 'Peut voir les rapports' },
        ].map((role) => (
          <TouchableOpacity
            key={role.id}
            style={[styles.roleOption, memberRole === role.id && styles.roleOptionActive]}
            onPress={() => setMemberRole(role.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: memberRole === role.id }}
          >
            <Text style={[styles.roleOptionLabel, memberRole === role.id && styles.roleOptionLabelActive]}>
              {role.label}
            </Text>
            <Text style={styles.roleOptionDesc}>{role.desc}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Limite mensuelle (optionnel)</Text>
      <TextInput
        style={styles.input}
        placeholder="Limite en XAF (ex: 50000)"
        value={memberLimit}
        onChangeText={setMemberLimit}
        keyboardType="numeric"
        placeholderTextColor={colors.textLight}
        accessibilityLabel="Limite budgétaire mensuelle"
      />

      <TouchableOpacity
        style={[styles.button, isLoading && styles.buttonDisabled]}
        onPress={handleAddMember}
        disabled={isLoading}
        accessibilityRole="button"
      >
        {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Ajouter le membre</Text>}
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, paddingTop: spacing.xl + 20 },
  backBtn: { marginBottom: spacing.md },
  backText: { color: colors.primary, fontSize: typography.md, fontWeight: '600' },
  title: { fontSize: typography.xl, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: typography.sm, color: colors.textSecondary, marginBottom: spacing.md },
  sectionLabel: { fontSize: typography.md, fontWeight: '600', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  input: { backgroundColor: '#fff', padding: spacing.md, borderRadius: 12, fontSize: typography.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  button: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: 12, alignItems: 'center', marginTop: spacing.lg },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: typography.md, fontWeight: '700' },
  createCard: {
    flexDirection: 'row', alignItems: 'center', padding: spacing.lg,
    backgroundColor: '#E8F5E9', borderRadius: 12, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.primary, borderStyle: 'dashed',
  },
  createIcon: { fontSize: 24, marginRight: spacing.md },
  createText: { fontSize: typography.md, color: colors.primary, fontWeight: '600' },
  accountCard: { backgroundColor: '#fff', padding: spacing.lg, borderRadius: 12, marginBottom: spacing.sm, elevation: 1 },
  accountHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  accountName: { fontSize: typography.md, fontWeight: '700', color: colors.text },
  accountEmail: { fontSize: typography.sm, color: colors.textSecondary },
  accountBudget: { fontSize: typography.sm, color: colors.primary, fontWeight: '600', marginTop: spacing.xs },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 },
  roleBadgeText: { fontSize: 11, fontWeight: '700' },
  emptyState: { alignItems: 'center', marginTop: 40 },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyText: { fontSize: typography.md, color: colors.textSecondary },
  emptyHint: { fontSize: typography.sm, color: colors.textLight, marginTop: 4, textAlign: 'center' },
  // Dashboard
  statsGrid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.lg, marginBottom: spacing.lg },
  statCard: { flex: 1, backgroundColor: '#fff', padding: spacing.md, borderRadius: 12, alignItems: 'center', marginHorizontal: 4 },
  statValue: { fontSize: typography.lg, fontWeight: '800', color: colors.primary },
  statLabel: { fontSize: typography.xs, color: colors.textSecondary, marginTop: 2 },
  budgetCard: { backgroundColor: '#fff', padding: spacing.lg, borderRadius: 12, marginBottom: spacing.lg },
  budgetHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  budgetLabel: { fontSize: typography.sm, color: colors.textSecondary },
  budgetAmount: { fontSize: typography.sm, fontWeight: '700', color: colors.text },
  budgetBarBg: { height: 8, backgroundColor: colors.border, borderRadius: 4, marginBottom: spacing.xs },
  budgetBarFill: { height: 8, backgroundColor: colors.primary, borderRadius: 4 },
  budgetUsed: { fontSize: typography.xs, color: colors.textSecondary },
  membersSection: { backgroundColor: '#fff', padding: spacing.lg, borderRadius: 12 },
  membersHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  membersTitle: { fontSize: typography.md, fontWeight: '700', color: colors.text },
  addMemberBtn: { color: colors.primary, fontWeight: '700', fontSize: typography.sm },
  memberCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  memberInfo: { flex: 1 },
  memberName: { fontSize: typography.sm, fontWeight: '600', color: colors.text },
  memberPhone: { fontSize: typography.xs, color: colors.textSecondary },
  memberLimit: { fontSize: 10, color: colors.textSecondary, marginTop: 2 },
  // Add member
  roleOptions: { flexDirection: 'row', marginBottom: spacing.md },
  roleOption: { flex: 1, padding: spacing.md, backgroundColor: '#fff', borderRadius: 10, marginRight: spacing.sm, borderWidth: 1, borderColor: colors.border },
  roleOptionActive: { borderColor: colors.primary, backgroundColor: '#E8F5E9' },
  roleOptionLabel: { fontSize: typography.sm, fontWeight: '700', color: colors.text },
  roleOptionLabelActive: { color: colors.primary },
  roleOptionDesc: { fontSize: typography.xs, color: colors.textSecondary, marginTop: 2 },
  infoBox: { backgroundColor: '#E3F2FD', padding: spacing.lg, borderRadius: 12, marginTop: spacing.lg },
  infoBoxTitle: { fontSize: typography.md, fontWeight: '700', color: colors.info, marginBottom: spacing.sm },
  infoBoxItem: { fontSize: typography.sm, color: colors.text, marginBottom: 4 },
});
