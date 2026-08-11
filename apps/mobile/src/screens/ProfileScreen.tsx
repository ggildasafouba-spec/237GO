import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Switch,
} from 'react-native';
import { useAuthStore } from '../store/authStore';
import { useWalletStore } from '../store/walletStore';
import api from '../config/api';
import { colors, spacing, typography } from '../theme';

interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relation?: string;
}

export default function ProfileScreen({ navigation }: { navigation: any }) {
  const { user, logout } = useAuthStore();
  const { balance, loyaltyPoints, loyaltyTier } = useWalletStore();

  const [isEditing, setIsEditing] = useState(false);
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [email, setEmail] = useState('');
  const [language, setLanguage] = useState(user?.language || 'fr');

  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactRelation, setNewContactRelation] = useState('');
  const [showAddContact, setShowAddContact] = useState(false);

  useEffect(() => {
    fetchEmergencyContacts();
  }, []);

  const fetchEmergencyContacts = async () => {
    try {
      const response = await api.get('/users/emergency-contacts');
      setEmergencyContacts(response.data.data);
    } catch {}
  };

  const handleUpdateProfile = async () => {
    try {
      await api.patch('/users/profile', { firstName, lastName, email: email || undefined, language });
      Alert.alert('✅ Profil mis à jour');
      setIsEditing(false);
    } catch {
      Alert.alert('Erreur', 'Impossible de mettre à jour le profil');
    }
  };

  const handleAddContact = async () => {
    if (!newContactName || !newContactPhone) {
      Alert.alert('Attention', 'Nom et téléphone requis');
      return;
    }
    if (!newContactPhone.match(/^6[0-9]{8}$/)) {
      Alert.alert('Erreur', 'Numéro invalide (format: 6XXXXXXXX)');
      return;
    }

    try {
      await api.post('/users/emergency-contacts', {
        name: newContactName,
        phone: newContactPhone,
        relation: newContactRelation || undefined,
      });
      Alert.alert('✅ Contact ajouté');
      setNewContactName('');
      setNewContactPhone('');
      setNewContactRelation('');
      setShowAddContact(false);
      fetchEmergencyContacts();
    } catch {
      Alert.alert('Erreur', 'Impossible d\'ajouter le contact');
    }
  };

  const handleDeleteContact = (id: string, name: string) => {
    Alert.alert('Supprimer ?', `Supprimer ${name} des contacts d'urgence ?`, [
      { text: 'Non' },
      {
        text: 'Oui',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/users/emergency-contacts/${id}`);
            fetchEmergencyContacts();
          } catch {}
        },
      },
    ]);
  };

  const handleLogout = () => {
    Alert.alert('Déconnexion', 'Voulez-vous vraiment vous déconnecter ?', [
      { text: 'Non' },
      { text: 'Oui', style: 'destructive', onPress: logout },
    ]);
  };

  const languages = [
    { id: 'fr', name: 'Français' },
    { id: 'en', name: 'English' },
    { id: 'pidgin', name: 'Pidgin' },
  ];

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Text style={styles.backText}>← Retour</Text>
      </TouchableOpacity>

      {/* Profile Header */}
      <View style={styles.profileHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </Text>
        </View>
        <Text style={styles.profileName}>{user?.firstName} {user?.lastName}</Text>
        <Text style={styles.profilePhone}>+237 {user?.phone}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>
            {user?.role === 'DRIVER' ? '🚗 Chauffeur' : user?.role === 'MERCHANT' ? '🏪 Marchand' : '👤 Passager'}
          </Text>
        </View>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{balance.toLocaleString()}</Text>
          <Text style={styles.statLabel}>XAF</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{loyaltyPoints}</Text>
          <Text style={styles.statLabel}>Points</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{loyaltyTier}</Text>
          <Text style={styles.statLabel}>Niveau</Text>
        </View>
      </View>

      {/* Edit Profile */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Informations personnelles</Text>
          <TouchableOpacity onPress={() => setIsEditing(!isEditing)}>
            <Text style={styles.editBtn}>{isEditing ? 'Annuler' : '✏️ Modifier'}</Text>
          </TouchableOpacity>
        </View>

        {isEditing ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="Prénom"
              value={firstName}
              onChangeText={setFirstName}
              accessibilityLabel="Prénom"
            />
            <TextInput
              style={styles.input}
              placeholder="Nom"
              value={lastName}
              onChangeText={setLastName}
              accessibilityLabel="Nom"
            />
            <TextInput
              style={styles.input}
              placeholder="Email (optionnel)"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              accessibilityLabel="Email"
            />

            <Text style={styles.labelSmall}>Langue</Text>
            <View style={styles.languageRow}>
              {languages.map((lang) => (
                <TouchableOpacity
                  key={lang.id}
                  style={[styles.langChip, language === lang.id && styles.langChipActive]}
                  onPress={() => setLanguage(lang.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: language === lang.id }}
                >
                  <Text style={[styles.langChipText, language === lang.id && styles.langChipTextActive]}>
                    {lang.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.saveButton} onPress={handleUpdateProfile} accessibilityRole="button">
              <Text style={styles.saveButtonText}>Enregistrer</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.infoList}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Nom</Text>
              <Text style={styles.infoValue}>{user?.firstName} {user?.lastName}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Téléphone</Text>
              <Text style={styles.infoValue}>+237 {user?.phone}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Langue</Text>
              <Text style={styles.infoValue}>{languages.find((l) => l.id === user?.language)?.name}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Emergency Contacts */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>🚨 Contacts d'urgence</Text>
          <TouchableOpacity onPress={() => setShowAddContact(!showAddContact)}>
            <Text style={styles.editBtn}>{showAddContact ? 'Annuler' : '+ Ajouter'}</Text>
          </TouchableOpacity>
        </View>

        {showAddContact && (
          <View style={styles.addContactForm}>
            <TextInput
              style={styles.input}
              placeholder="Nom du contact"
              value={newContactName}
              onChangeText={setNewContactName}
              accessibilityLabel="Nom du contact d'urgence"
            />
            <TextInput
              style={styles.input}
              placeholder="Téléphone (6XXXXXXXX)"
              value={newContactPhone}
              onChangeText={setNewContactPhone}
              keyboardType="phone-pad"
              maxLength={9}
              accessibilityLabel="Téléphone du contact d'urgence"
            />
            <TextInput
              style={styles.input}
              placeholder="Relation (frère, mère, ami...)"
              value={newContactRelation}
              onChangeText={setNewContactRelation}
              accessibilityLabel="Relation avec le contact"
            />
            <TouchableOpacity style={styles.saveButton} onPress={handleAddContact} accessibilityRole="button">
              <Text style={styles.saveButtonText}>Ajouter le contact</Text>
            </TouchableOpacity>
          </View>
        )}

        {emergencyContacts.length === 0 ? (
          <Text style={styles.emptyText}>
            Ajoutez des contacts d'urgence pour votre sécurité
          </Text>
        ) : (
          emergencyContacts.map((contact) => (
            <View key={contact.id} style={styles.contactCard}>
              <View style={styles.contactInfo}>
                <Text style={styles.contactName}>{contact.name}</Text>
                <Text style={styles.contactPhone}>+237 {contact.phone}</Text>
                {contact.relation && <Text style={styles.contactRelation}>{contact.relation}</Text>}
              </View>
              <TouchableOpacity
                onPress={() => handleDeleteContact(contact.id, contact.name)}
                accessibilityLabel={`Supprimer ${contact.name}`}
              >
                <Text style={styles.deleteBtn}>🗑️</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      {/* Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Actions</Text>

        {user?.role === 'PASSENGER' && (
          <>
            <TouchableOpacity
              style={styles.actionItem}
              onPress={() => navigation.navigate('BecomeDriver')}
              accessibilityRole="button"
            >
              <Text style={styles.actionIcon}>🚗</Text>
              <Text style={styles.actionText}>Devenir chauffeur</Text>
              <Text style={styles.actionArrow}>→</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionItem}
              onPress={() => navigation.navigate('BecomeMerchant')}
              accessibilityRole="button"
            >
              <Text style={styles.actionIcon}>🏪</Text>
              <Text style={styles.actionText}>Devenir marchand</Text>
              <Text style={styles.actionArrow}>→</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={styles.actionItem} accessibilityRole="button">
          <Text style={styles.actionIcon}>📋</Text>
          <Text style={styles.actionText}>Historique des courses</Text>
          <Text style={styles.actionArrow}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionItem} accessibilityRole="button">
          <Text style={styles.actionIcon}>❓</Text>
          <Text style={styles.actionText}>Aide et support</Text>
          <Text style={styles.actionArrow}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionItem} accessibilityRole="button">
          <Text style={styles.actionIcon}>📜</Text>
          <Text style={styles.actionText}>Conditions d'utilisation</Text>
          <Text style={styles.actionArrow}>→</Text>
        </TouchableOpacity>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} accessibilityRole="button">
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </TouchableOpacity>

      <Text style={styles.version}>237GO v1.0.0</Text>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, paddingTop: spacing.xl + 20 },
  backBtn: { marginBottom: spacing.md },
  backText: { color: colors.primary, fontSize: typography.md, fontWeight: '600' },
  profileHeader: { alignItems: 'center', marginBottom: spacing.lg },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { color: '#fff', fontSize: 28, fontWeight: '800' },
  profileName: { fontSize: typography.xl, fontWeight: '700', color: colors.text, marginTop: spacing.md },
  profilePhone: { fontSize: typography.sm, color: colors.textSecondary, marginTop: 4 },
  roleBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 14, paddingVertical: 4, borderRadius: 12, marginTop: spacing.sm },
  roleText: { fontSize: typography.xs, color: colors.primary, fontWeight: '600' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.lg },
  statCard: { flex: 1, backgroundColor: '#fff', padding: spacing.md, borderRadius: 12, alignItems: 'center', marginHorizontal: 4 },
  statValue: { fontSize: typography.lg, fontWeight: '800', color: colors.primary },
  statLabel: { fontSize: typography.xs, color: colors.textSecondary, marginTop: 2 },
  section: { backgroundColor: '#fff', padding: spacing.lg, borderRadius: 12, marginBottom: spacing.lg },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  sectionTitle: { fontSize: typography.md, fontWeight: '700', color: colors.text },
  editBtn: { fontSize: typography.sm, color: colors.primary, fontWeight: '600' },
  input: {
    backgroundColor: colors.background, padding: spacing.md, borderRadius: 10,
    fontSize: typography.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
  },
  labelSmall: { fontSize: typography.xs, color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.xs },
  languageRow: { flexDirection: 'row', marginBottom: spacing.md },
  langChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: colors.background, marginRight: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  langChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  langChipText: { fontSize: typography.sm, color: colors.text },
  langChipTextActive: { color: '#fff' },
  saveButton: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: 10, alignItems: 'center', marginTop: spacing.sm },
  saveButtonText: { color: '#fff', fontWeight: '700' },
  infoList: {},
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  infoLabel: { fontSize: typography.sm, color: colors.textSecondary },
  infoValue: { fontSize: typography.sm, color: colors.text, fontWeight: '500' },
  addContactForm: { marginBottom: spacing.md },
  emptyText: { fontSize: typography.sm, color: colors.textSecondary, fontStyle: 'italic' },
  contactCard: {
    flexDirection: 'row', alignItems: 'center', padding: spacing.md,
    backgroundColor: colors.background, borderRadius: 10, marginBottom: spacing.xs,
  },
  contactInfo: { flex: 1 },
  contactName: { fontSize: typography.md, fontWeight: '600', color: colors.text },
  contactPhone: { fontSize: typography.sm, color: colors.textSecondary },
  contactRelation: { fontSize: typography.xs, color: colors.primary, marginTop: 2 },
  deleteBtn: { fontSize: 18, padding: spacing.sm },
  actionItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  actionIcon: { fontSize: 20, marginRight: spacing.md },
  actionText: { flex: 1, fontSize: typography.md, color: colors.text },
  actionArrow: { color: colors.textSecondary, fontSize: typography.md },
  logoutButton: {
    padding: spacing.md, borderRadius: 12, alignItems: 'center',
    borderWidth: 1, borderColor: colors.error, marginBottom: spacing.md,
  },
  logoutText: { color: colors.error, fontSize: typography.md, fontWeight: '700' },
  version: { textAlign: 'center', fontSize: typography.xs, color: colors.textLight },
});
