import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/useAuth';
import PizzaFireScreen from '../components/PizzaFireScreen';
import { Icons } from '../components/Icons';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { saveCompanyProfile, subscribeCompanyProfile } from '../services/companyProfile';
import { DEFAULT_COMPANY_PROFILE, type CompanyProfile } from '../utils/companyProfile';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import { pizzaFireUi } from '../theme/pizzaFireUi';
import { formColumnFrame, useAppLayout } from '../theme/responsiveLayout';

type Props = NativeStackScreenProps<RootStackParamList, 'Company'>;

type CompanyTextKey = Exclude<keyof CompanyProfile, 'teamId' | 'smallBusiness'>;

type FieldDef = {
  key: CompanyTextKey;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  keyboard?: 'email-address' | 'phone-pad' | 'default';
  autoCapitalize?: 'none' | 'sentences' | 'characters';
};

type SectionDef = {
  title: string;
  fields: FieldDef[];
  smallBusiness?: boolean;
};

const SECTIONS: SectionDef[] = [
  {
    title: 'Name',
    fields: [
      { key: 'displayName', label: 'Display Name' },
      { key: 'legalName', label: 'Company name', placeholder: 'Michaud & Imhoff GbR' },
      { key: 'email', label: 'Email', keyboard: 'email-address', autoCapitalize: 'none' },
      { key: 'phone', label: 'Phone', keyboard: 'phone-pad' },
      { key: 'address', label: 'Address', multiline: true },
    ],
  },
  {
    title: 'Legal',
    fields: [
      { key: 'legalForm', label: 'Legal form' },
      { key: 'registeredOffice', label: 'Registered office (Sitz)', multiline: true },
      { key: 'registerCourt', label: 'Register court' },
      { key: 'registerNumber', label: 'Register number' },
      { key: 'managingDirector', label: 'Managing director' },
    ],
  },
  {
    title: 'Tax',
    fields: [
      { key: 'taxNumber', label: 'Tax number (Steuernummer)' },
      { key: 'vatId', label: 'VAT ID (USt-IdNr)', autoCapitalize: 'characters' },
    ],
    smallBusiness: true,
  },
  {
    title: 'Billing',
    fields: [
      { key: 'invoiceContactName', label: 'Invoice contact' },
      { key: 'invoiceContactEmail', label: 'Invoice email', keyboard: 'email-address', autoCapitalize: 'none' },
      { key: 'invoiceContactPhone', label: 'Invoice phone', keyboard: 'phone-pad' },
      { key: 'billingAddress', label: 'Billing address', multiline: true },
      { key: 'bankAccountHolder', label: 'Account holder' },
      { key: 'iban', label: 'IBAN', autoCapitalize: 'characters' },
      { key: 'bic', label: 'BIC', autoCapitalize: 'characters' },
      { key: 'paymentTerms', label: 'Payment terms', multiline: true },
      { key: 'invoiceFooter', label: 'Invoice footer', multiline: true },
    ],
  },
  {
    title: 'Notes',
    fields: [{ key: 'notes', label: 'Notes', multiline: true }],
  },
];

export default function CompanyScreen({ navigation }: Props) {
  const layout = useAppLayout();
  const isAdmin = useAuth().status === 'admin';
  const [profile, setProfile] = useState<CompanyProfile>(DEFAULT_COMPANY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeCompanyProfile(
      next => {
        setProfile(next);
        setError(null);
        setLoading(false);
      },
      message => {
        setError(message);
        setLoading(false);
      }
    );
  }, []);

  const updateField = (key: CompanyTextKey, value: string) => {
    setProfile(current => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    if (!isAdmin || saving) return;
    setSaving(true);
    try {
      await saveCompanyProfile(profile);
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Unable to save company details.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PizzaFireScreen>
      <View style={styles.container}>
        <View style={pizzaFireUi.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button">
            <Icons.arrowLeft color={PIZZA_FIRE.gold} width={24} height={24} />
          </TouchableOpacity>
          <View style={styles.headerTitles}>
            <Text style={styles.headerContext}>Settings</Text>
            <Text style={[pizzaFireUi.headerTitle, styles.headerTitle]}>Account settings</Text>
          </View>
          {isAdmin ? (
            <TouchableOpacity onPress={() => void handleSave()} disabled={saving} style={styles.saveHit}>
              {saving ? <ActivityIndicator color={PIZZA_FIRE.accent} /> : <Text style={styles.saveText}>Save</Text>}
            </TouchableOpacity>
          ) : (
            <View style={styles.headerSpacer} />
          )}
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={PIZZA_FIRE.accent} />
          </View>
        ) : (
          <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView
              contentContainerStyle={[styles.scrollContent, formColumnFrame(layout)]}
              keyboardShouldPersistTaps="handled"
            >
              {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
              {SECTIONS.map(section => (
                <View key={section.title} style={styles.section}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  {section.fields.map(field => (
                    <View key={field.key} style={styles.field}>
                      <Text style={styles.label}>{field.label}</Text>
                      {isAdmin ? (
                        <TextInput
                          style={[styles.input, field.multiline ? styles.inputMultiline : null]}
                          value={profile[field.key]}
                          onChangeText={value => updateField(field.key, value)}
                          placeholder={field.placeholder}
                          placeholderTextColor={PIZZA_FIRE.textMuted}
                          autoCapitalize={field.autoCapitalize || 'sentences'}
                          keyboardType={field.keyboard || 'default'}
                          multiline={field.multiline}
                        />
                      ) : (
                        <Text style={styles.value}>{profile[field.key] || '—'}</Text>
                      )}
                    </View>
                  ))}
                  {section.smallBusiness ? (
                    <View style={styles.switchRow}>
                      <Text style={styles.switchLabel}>Small business (Kleinunternehmer)</Text>
                      {isAdmin ? (
                        <Switch
                          value={profile.smallBusiness}
                          onValueChange={value => setProfile(current => ({ ...current, smallBusiness: value }))}
                          trackColor={{ false: PIZZA_FIRE.inputBg, true: PIZZA_FIRE.accent }}
                          thumbColor={profile.smallBusiness ? '#F6EDE2' : '#A88E73'}
                        />
                      ) : (
                        <Text style={styles.value}>{profile.smallBusiness ? 'Yes' : 'No'}</Text>
                      )}
                    </View>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </View>
    </PizzaFireScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  backBtn: { padding: 4, minWidth: 32 },
  headerSpacer: { width: 48 },
  saveHit: { minWidth: 48, alignItems: 'flex-end', padding: 4 },
  headerTitles: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 0 },
  headerContext: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 1,
  },
  saveText: { color: PIZZA_FIRE.accent, fontSize: 16, fontWeight: '800' },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  section: { marginBottom: 10 },
  sectionTitle: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 12,
    marginTop: 8,
  },
  field: { marginBottom: 16 },
  label: { color: PIZZA_FIRE.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, marginBottom: 6 },
  input: {
    backgroundColor: PIZZA_FIRE.inputBg,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    borderRadius: 7,
    color: PIZZA_FIRE.textPrimary,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputMultiline: { minHeight: 88, textAlignVertical: 'top' },
  value: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '600' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  switchLabel: {
    flex: 1,
    color: PIZZA_FIRE.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  errorBanner: {
    marginBottom: 12,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(158, 60, 46, 0.2)',
    color: PIZZA_FIRE.textPrimary,
    fontSize: 13,
  },
});
