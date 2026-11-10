import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { collection, doc, getFirestore, onSnapshot } from '@react-native-firebase/firestore';
import { useAuth } from '../auth/useAuth';
import PizzaFireScreen from '../components/PizzaFireScreen';
import { Icons } from '../components/Icons';
import type { RootStackParamList } from '../navigation/AppNavigator';
import Share from 'react-native-share';
import { auth, signOutUser } from '../services/firebase';
import { createTeamInvite, revokeTeamInvite, subscribePendingTeamInvites } from '../services/teamInvites';
import {
  getAutoShiftEnabled,
  getWorksiteAlertsEnabled,
  getWorksiteLocationEnabled,
  setAutoShiftEnabled,
  setWorksiteAlertsEnabled,
  setWorksiteLocationEnabled,
  subscribeLocationFeatureSettings,
} from '../geofencing/storage';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import { pizzaFireUi } from '../theme/pizzaFireUi';
import { formColumnFrame, useAppLayout } from '../theme/responsiveLayout';
import { resolveAvatarSource } from '../utils/avatar';
import { requestLocationForFeature } from '../utils/geo';
import {
  roleLabel,
  type RoleHolder,
} from '../utils/teamRoles';
import { orgStatusLabel, sortEmployeesByOrgActive } from '../utils/orgStatus';
import {
  buildInviteHttpsUrl,
  inviteShareMessage,
  toExpiryMs,
  type TeamInviteRecord,
} from '../utils/teamInvites';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

type MemberRecord = RoleHolder & {
  name?: string;
  email?: string;
  emailLower?: string;
  orgActive?: boolean;
  avatarUrl?: string | null;
  customAvatarUrl?: string | null;
};

export default function SettingsScreen({ navigation }: Props) {
  const layout = useAppLayout();
  const authState = useAuth();
  const isAdmin = authState.status === 'admin';
  const currentUid = auth.currentUser?.uid || null;

  const [profile, setProfile] = useState<MemberRecord | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);

  const [autoTracking, setAutoTracking] = useState(false);
  const [worksiteLocation, setWorksiteLocation] = useState(false);
  const [worksiteAlerts, setWorksiteAlerts] = useState(false);
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [prefBusy, setPrefBusy] = useState<'auto' | 'location' | 'alerts' | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [invites, setInvites] = useState<TeamInviteRecord[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState<'create' | string | null>(null);
  const [openSection, setOpenSection] = useState<'account' | 'team' | 'app' | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [invitesOpen, setInvitesOpen] = useState(false);
  const [locationSettingsOpen, setLocationSettingsOpen] = useState(false);

  useEffect(() => {
    if (!currentUid) {
      setProfile(null);
      setProfileLoading(false);
      setProfileError('Sign in to view account settings.');
      return undefined;
    }

    setProfileLoading(true);
    const unsub = onSnapshot(
      doc(getFirestore(), 'users', currentUid),
      snap => {
        if (!snap.exists()) {
          setProfile({
            id: currentUid,
            name: auth.currentUser?.displayName || '',
            email: auth.currentUser?.email || '',
            roles: [],
          });
        } else {
          setProfile({ id: snap.id, ...(snap.data() as Omit<MemberRecord, 'id'>) });
        }
        setProfileError(null);
        setProfileLoading(false);
      },
      err => {
        setProfileError(err?.message || 'Unable to load account details.');
        setProfileLoading(false);
      }
    );
    return () => unsub();
  }, [currentUid]);

  useEffect(() => {
    if (!isAdmin) {
      setMembers([]);
      setMembersLoading(false);
      setMembersError(null);
      return undefined;
    }

    setMembersLoading(true);
    const unsub = onSnapshot(
      collection(getFirestore(), 'users'),
      snap => {
        const items = (snap?.docs || []).map(docSnap => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<MemberRecord, 'id'>),
        }));
        setMembers(items);
        setMembersError(null);
        setMembersLoading(false);
      },
      err => {
        setMembersError(err?.message || 'Unable to load team members.');
        setMembers([]);
        setMembersLoading(false);
      }
    );
    return () => unsub();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setInvites([]);
      setInvitesLoading(false);
      setInvitesError(null);
      return undefined;
    }
    setInvitesLoading(true);
    return subscribePendingTeamInvites(
      items => {
        setInvites(items);
        setInvitesError(null);
        setInvitesLoading(false);
      },
      message => {
        setInvitesError(message);
        setInvites([]);
        setInvitesLoading(false);
      }
    );
  }, [isAdmin]);

  const refreshPrefs = useCallback(async () => {
    try {
      const [auto, location, alerts] = await Promise.all([
        getAutoShiftEnabled(),
        getWorksiteLocationEnabled(),
        getWorksiteAlertsEnabled(),
      ]);
      setAutoTracking(auto);
      setWorksiteLocation(location);
      setWorksiteAlerts(alerts);
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Unable to load personal settings.');
    } finally {
      setPrefsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPrefs();
    return subscribeLocationFeatureSettings(() => {
      void refreshPrefs();
    });
  }, [refreshPrefs]);

  const sortedMembers = useMemo(() => sortEmployeesByOrgActive(members), [members]);

  const displayName = profile?.name || auth.currentUser?.displayName || 'Unnamed member';
  const displayEmail = profile?.email || auth.currentUser?.email || '';
  const accountRole = roleLabel(profile?.roles, profile?.disabled);
  const accountMeta = displayEmail || accountRole;
  const teamMeta = membersLoading ? '…' : String(sortedMembers.length);

  const toggleSection = (section: 'account' | 'team' | 'app') => {
    setOpenSection(current => (current === section ? null : section));
  };

  const handleTogglePref = async (kind: 'auto' | 'location' | 'alerts', enabled: boolean) => {
    if (prefBusy) return;
    const previous =
      kind === 'auto' ? autoTracking : kind === 'location' ? worksiteLocation : worksiteAlerts;
    const setLocal =
      kind === 'auto' ? setAutoTracking : kind === 'location' ? setWorksiteLocation : setWorksiteAlerts;
    setLocal(enabled);
    setPrefBusy(kind);
    try {
      if (enabled && !(await requestLocationForFeature(true))) {
        setLocal(previous);
        return;
      }
      if (kind === 'auto') await setAutoShiftEnabled(enabled);
      else if (kind === 'location') await setWorksiteLocationEnabled(enabled);
      else await setWorksiteAlertsEnabled(enabled);
    } catch (err: any) {
      setLocal(previous);
      Alert.alert('Notice', err?.message || 'Unable to save this setting.');
    } finally {
      setPrefBusy(null);
    }
  };

  const handleSignOut = () => {
    Alert.alert('Logout', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          setSigningOut(true);
          void signOutUser()
            .catch(() => Alert.alert('Notice', 'Unable to sign out.'))
            .finally(() => setSigningOut(false));
        },
      },
    ]);
  };

  const shareInvite = async (token: string) => {
    try {
      await Share.open({
        title: 'Pizza Wala invite',
        message: inviteShareMessage(token),
        failOnCancel: false,
      });
    } catch (err: any) {
      const message = String(err?.message || '');
      if (/cancel/i.test(message)) return;
      Alert.alert('Share failed', message || 'Unable to open the share sheet.');
    }
  };

  const handleCreateInvite = async () => {
    if (!isAdmin || inviteBusy) return;
    const uid = currentUid;
    if (!uid) {
      Alert.alert('Notice', 'Sign in again to create an invite.');
      return;
    }
    setInviteBusy('create');
    try {
      const created = await createTeamInvite(uid);
      Alert.alert('Invite link ready', 'Share this link by WhatsApp, email, text, or any other app.', [
        { text: 'Close', style: 'cancel' },
        { text: 'Share', onPress: () => void shareInvite(created.token || created.id || '') },
      ]);
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Unable to create an invite.');
    } finally {
      setInviteBusy(null);
    }
  };

  const handleRevokeInvite = (invite: TeamInviteRecord) => {
    const token = invite.token || invite.id;
    if (!isAdmin || !token || inviteBusy) return;
    Alert.alert('Revoke invite', 'This link will stop working. You can create a new one later.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: () => {
          setInviteBusy(token);
          void revokeTeamInvite(token)
            .catch(err => Alert.alert('Notice', err?.message || 'Unable to revoke this invite.'))
            .finally(() => setInviteBusy(null));
        },
      },
    ]);
  };

  const formatInviteExpiry = (expiresAt: unknown) => {
    const ms = toExpiryMs(expiresAt);
    if (ms == null) return 'No expiry';
    return `Expires ${new Date(ms).toLocaleDateString()}`;
  };

  if (profileLoading && prefsLoading) {
    return (
      <PizzaFireScreen>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={PIZZA_FIRE.accent} />
        </View>
      </PizzaFireScreen>
    );
  }

  const accountOpen = openSection === 'account';
  const teamOpen = openSection === 'team';
  const appOpen = openSection === 'app';
  const headerTitle =
    openSection === 'account' ? 'My account' : openSection === 'team' ? 'Team' : openSection === 'app' ? 'App' : 'Settings';

  return (
    <PizzaFireScreen>
      <View style={styles.container}>
        <View style={pizzaFireUi.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button">
            <Icons.arrowLeft color={PIZZA_FIRE.gold} width={24} height={24} />
          </TouchableOpacity>
          <View style={styles.headerTitles}>
            {openSection ? <Text style={styles.headerContext}>Settings</Text> : null}
            <Text style={[pizzaFireUi.headerTitle, styles.headerTitle]}>{headerTitle}</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={[styles.scrollContent, formColumnFrame(layout)]}>
          <View style={styles.list}>
            <TouchableOpacity
              style={[styles.indexRow, accountOpen ? styles.indexRowOpen : null]}
              onPress={() => toggleSection('account')}
              accessibilityRole="button"
              accessibilityState={{ expanded: accountOpen }}
            >
              <Text style={[styles.indexLabel, accountOpen ? styles.indexLabelOpen : null]}>My account</Text>
              <Text style={styles.indexMeta} numberOfLines={1}>
                {accountMeta}
              </Text>
              <Text style={[styles.chevron, accountOpen ? styles.chevronOpen : null]}>›</Text>
            </TouchableOpacity>
            {accountOpen ? (
              <View style={styles.panel}>
                {profileError ? <Text style={styles.errorBanner}>{profileError}</Text> : null}
                <View style={styles.accountRow}>
                  <Image
                    source={resolveAvatarSource(profile?.avatarUrl, profile?.customAvatarUrl)}
                    style={styles.avatar}
                  />
                  <View style={styles.accountCopy}>
                    <Text style={styles.accountName}>{displayName}</Text>
                    <Text style={styles.accountMeta}>{displayEmail || 'No email'}</Text>
                    <Text style={styles.accountMeta}>{accountRole}</Text>
                  </View>
                </View>
                <TouchableOpacity style={styles.actionRow} onPress={() => navigation.navigate('EditProfile')}>
                  <Text style={styles.actionLabel}>Edit profile</Text>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionRow, styles.actionRowLast]}
                  onPress={() => navigation.navigate('ChangePassword')}
                >
                  <Text style={styles.actionLabel}>Change password</Text>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {isAdmin ? (
              <>
                <TouchableOpacity
                  style={[styles.indexRow, teamOpen ? styles.indexRowOpen : null]}
                  onPress={() => toggleSection('team')}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: teamOpen }}
                >
                  <Text style={[styles.indexLabel, teamOpen ? styles.indexLabelOpen : null]}>Team</Text>
                  <Text style={styles.indexMeta}>{teamMeta}</Text>
                  <Text style={[styles.chevron, teamOpen ? styles.chevronOpen : null]}>›</Text>
                </TouchableOpacity>
                {teamOpen ? (
                  <View style={styles.panel}>
                    <TouchableOpacity
                      style={[styles.subRow, membersOpen ? styles.subRowOpen : null]}
                      onPress={() => setMembersOpen(open => !open)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: membersOpen }}
                    >
                      <Text style={[styles.subLabel, membersOpen ? styles.indexLabelOpen : null]}>Members</Text>
                      <Text style={styles.indexMeta}>{teamMeta}</Text>
                      <Text style={[styles.chevron, membersOpen ? styles.chevronOpen : null]}>›</Text>
                    </TouchableOpacity>
                    {membersOpen ? (
                      <View style={styles.nested}>
                        {membersError ? <Text style={styles.errorBanner}>{membersError}</Text> : null}
                        {membersLoading ? (
                          <ActivityIndicator color={PIZZA_FIRE.gold} style={styles.inlineSpinner} />
                        ) : sortedMembers.length === 0 ? (
                          <Text style={styles.emptyText}>None</Text>
                        ) : (
                          sortedMembers.map(member => {
                            const label = member.name || member.email || 'Unnamed';
                            const inactive = orgStatusLabel(member);
                            return (
                              <TouchableOpacity
                                key={member.id}
                                style={styles.memberRow}
                                onPress={() =>
                                  navigation.navigate('EditProfile', { userId: member.id, userName: label })
                                }
                              >
                                <View style={styles.memberCopy}>
                                  <Text style={styles.memberName}>{label}</Text>
                                  <Text style={styles.memberMeta}>
                                    {roleLabel(member.roles, member.disabled)}
                                    {inactive ? ` · ${inactive}` : ''}
                                  </Text>
                                </View>
                                <Text style={styles.chevron}>›</Text>
                              </TouchableOpacity>
                            );
                          })
                        )}
                      </View>
                    ) : null}

                    <TouchableOpacity
                      style={[styles.subRow, invitesOpen ? styles.subRowOpen : null]}
                      onPress={() => setInvitesOpen(open => !open)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: invitesOpen }}
                    >
                      <Text style={[styles.subLabel, invitesOpen ? styles.indexLabelOpen : null]}>Invites</Text>
                      <Text style={styles.indexMeta}>{invitesLoading ? '…' : String(invites.length)}</Text>
                      <Text style={[styles.chevron, invitesOpen ? styles.chevronOpen : null]}>›</Text>
                    </TouchableOpacity>
                    {invitesOpen ? (
                      <View style={styles.nested}>
                        <TouchableOpacity
                          style={styles.actionRow}
                          onPress={() => void handleCreateInvite()}
                          disabled={Boolean(inviteBusy)}
                        >
                          <Text style={styles.actionLabel}>Create invite</Text>
                          {inviteBusy === 'create' ? (
                            <ActivityIndicator color={PIZZA_FIRE.gold} size="small" />
                          ) : (
                            <Text style={styles.chevron}>›</Text>
                          )}
                        </TouchableOpacity>
                        {invitesError ? <Text style={styles.errorBanner}>{invitesError}</Text> : null}
                        {invitesLoading ? (
                          <ActivityIndicator color={PIZZA_FIRE.gold} style={styles.inlineSpinner} />
                        ) : invites.length === 0 ? (
                          <Text style={styles.emptyText}>None pending</Text>
                        ) : (
                          invites.map(invite => {
                            const token = invite.token || invite.id || '';
                            const url = token ? buildInviteHttpsUrl(token) : '';
                            const busy = inviteBusy === token;
                            return (
                              <View key={token} style={styles.memberRow}>
                                <Text style={styles.memberMeta}>{formatInviteExpiry(invite.expiresAt)}</Text>
                                <Text selectable style={styles.inviteLink}>
                                  {url}
                                </Text>
                                <View style={styles.memberActions}>
                                  <TouchableOpacity disabled={busy || !token} onPress={() => void shareInvite(token)}>
                                    <Text style={styles.inlineAction}>Share</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity disabled={busy} onPress={() => handleRevokeInvite(invite)}>
                                    <Text style={[styles.inlineAction, styles.inlineDanger]}>Revoke</Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            );
                          })
                        )}
                      </View>
                    ) : null}

                    <TouchableOpacity style={styles.navRow} onPress={() => navigation.navigate('ManageUsers')}>
                      <Text style={styles.subLabel}>Employees</Text>
                      <Text style={styles.chevron}>›</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.navRow} onPress={() => navigation.navigate('Geofences')}>
                      <Text style={styles.subLabel}>Worksites</Text>
                      <Text style={styles.chevron}>›</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.navRow, styles.navRowLast]}
                      onPress={() => navigation.navigate('AdminOptions')}
                    >
                      <Text style={styles.subLabel}>Admin options</Text>
                      <Text style={styles.chevron}>›</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </>
            ) : null}

            <TouchableOpacity
              style={[styles.indexRow, appOpen ? styles.indexRowOpen : null]}
              onPress={() => toggleSection('app')}
              accessibilityRole="button"
              accessibilityState={{ expanded: appOpen }}
            >
              <Text style={[styles.indexLabel, appOpen ? styles.indexLabelOpen : null]}>App</Text>
              <Text style={[styles.chevron, appOpen ? styles.chevronOpen : null]}>›</Text>
            </TouchableOpacity>
            {appOpen ? (
              <View style={styles.panel}>
                <TouchableOpacity style={styles.navRow} onPress={() => navigation.navigate('Permissions')}>
                  <Text style={styles.subLabel}>Permissions</Text>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.subRow, locationSettingsOpen ? styles.subRowOpen : null]}
                  onPress={() => setLocationSettingsOpen(open => !open)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: locationSettingsOpen }}
                >
                  <Text style={[styles.subLabel, locationSettingsOpen ? styles.indexLabelOpen : null]}>
                    Location settings
                  </Text>
                  <Text style={styles.indexMeta}>
                    {prefsLoading ? '…' : autoTracking || worksiteLocation || worksiteAlerts ? 'on' : 'off'}
                  </Text>
                  <Text style={[styles.chevron, locationSettingsOpen ? styles.chevronOpen : null]}>›</Text>
                </TouchableOpacity>
                {locationSettingsOpen ? (
                  <View style={styles.nested}>
                    {prefsLoading ? (
                      <ActivityIndicator color={PIZZA_FIRE.gold} style={styles.inlineSpinner} />
                    ) : (
                      <>
                        <View style={styles.prefRow}>
                          <Text style={styles.prefLabel}>Auto-Tracking</Text>
                          <Switch
                            value={autoTracking}
                            disabled={prefBusy === 'auto'}
                            onValueChange={value => void handleTogglePref('auto', value)}
                            trackColor={{ false: PIZZA_FIRE.inputBg, true: PIZZA_FIRE.accent }}
                            thumbColor={autoTracking ? '#F6EDE2' : '#A88E73'}
                          />
                        </View>
                        <View style={styles.prefRow}>
                          <Text style={styles.prefLabel}>Worksite Location</Text>
                          <Switch
                            value={worksiteLocation}
                            disabled={prefBusy === 'location'}
                            onValueChange={value => void handleTogglePref('location', value)}
                            trackColor={{ false: PIZZA_FIRE.inputBg, true: PIZZA_FIRE.accent }}
                            thumbColor={worksiteLocation ? '#F6EDE2' : '#A88E73'}
                          />
                        </View>
                        <View style={[styles.prefRow, styles.prefRowLast]}>
                          <Text style={styles.prefLabel}>Worksite Alerts</Text>
                          <Switch
                            value={worksiteAlerts}
                            disabled={prefBusy === 'alerts'}
                            onValueChange={value => void handleTogglePref('alerts', value)}
                            trackColor={{ false: PIZZA_FIRE.inputBg, true: PIZZA_FIRE.accent }}
                            thumbColor={worksiteAlerts ? '#F6EDE2' : '#A88E73'}
                          />
                        </View>
                      </>
                    )}
                  </View>
                ) : null}
                <TouchableOpacity style={[styles.navRow, styles.navRowLast]} onPress={() => navigation.navigate('Company')}>
                  <Text style={styles.subLabel}>Account settings</Text>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <TouchableOpacity style={[styles.indexRow, styles.signOutRow]} onPress={handleSignOut} disabled={signingOut}>
              <Text style={styles.signOutLabel}>Sign out</Text>
              {signingOut ? <ActivityIndicator color={PIZZA_FIRE.danger} size="small" /> : null}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </PizzaFireScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  backBtn: { padding: 4, minWidth: 32 },
  headerSpacer: { width: 32 },
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
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  list: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: PIZZA_FIRE.divider,
  },
  indexRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: PIZZA_FIRE.divider,
    gap: 10,
  },
  indexRowOpen: {
    backgroundColor: PIZZA_FIRE.accentSoft,
    marginHorizontal: -16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderLeftWidth: 3,
    borderLeftColor: PIZZA_FIRE.accent,
  },
  indexLabel: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '700' },
  indexLabelOpen: { color: PIZZA_FIRE.accent },
  indexMeta: {
    flex: 1,
    color: PIZZA_FIRE.textMuted,
    fontSize: 13,
    textAlign: 'right',
  },
  chevron: { color: PIZZA_FIRE.gold, fontSize: 20, fontWeight: '300', marginTop: -1 },
  chevronOpen: { color: PIZZA_FIRE.accent, transform: [{ rotate: '90deg' }], marginTop: 0 },
  panel: {
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: PIZZA_FIRE.divider,
  },
  accountRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 12, paddingBottom: 8 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: PIZZA_FIRE.inputBg },
  accountCopy: { flex: 1, marginLeft: 12 },
  accountName: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '700' },
  accountMeta: { color: PIZZA_FIRE.textMuted, fontSize: 12, marginTop: 2 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: PIZZA_FIRE.divider,
  },
  actionLabel: { color: PIZZA_FIRE.textPrimary, fontSize: 14, fontWeight: '600' },
  actionRowLast: { paddingBottom: 4 },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: PIZZA_FIRE.divider,
  },
  prefRowLast: { paddingBottom: 4 },
  prefLabel: { color: PIZZA_FIRE.textPrimary, fontSize: 14, fontWeight: '600' },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: PIZZA_FIRE.divider,
    gap: 10,
  },
  subRowOpen: {
    backgroundColor: PIZZA_FIRE.accentSoft,
    marginHorizontal: -16,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderLeftWidth: 3,
    borderLeftColor: PIZZA_FIRE.accent,
  },
  subLabel: { color: PIZZA_FIRE.textPrimary, fontSize: 14, fontWeight: '600' },
  nested: { paddingLeft: 8, paddingBottom: 4 },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: PIZZA_FIRE.divider,
  },
  navRowLast: { paddingBottom: 4 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: PIZZA_FIRE.divider,
  },
  memberCopy: { flex: 1, paddingRight: 8 },
  memberName: { color: PIZZA_FIRE.textPrimary, fontSize: 14, fontWeight: '700' },
  memberMeta: { color: PIZZA_FIRE.textMuted, fontSize: 12, marginTop: 2 },
  memberActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 8 },
  inlineAction: { color: PIZZA_FIRE.gold, fontSize: 13, fontWeight: '700' },
  inlineDanger: { color: PIZZA_FIRE.danger },
  inviteLink: { color: PIZZA_FIRE.gold, fontSize: 12, marginTop: 4, lineHeight: 16 },
  emptyText: { color: PIZZA_FIRE.textMuted, fontSize: 13, paddingVertical: 8 },
  inlineSpinner: { marginVertical: 12 },
  errorBanner: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(158, 60, 46, 0.2)',
    color: PIZZA_FIRE.textPrimary,
    fontSize: 13,
  },
  signOutRow: { justifyContent: 'space-between' },
  signOutLabel: { color: PIZZA_FIRE.danger, fontSize: 16, fontWeight: '700' },
});
