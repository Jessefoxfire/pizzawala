import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from '@react-native-firebase/firestore';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { auth } from '../services/firebase';

type Props = NativeStackScreenProps<RootStackParamList, 'DepartureChecklist'>;

type ChecklistTeamKey = 'all' | 'shared' | 'front' | 'kitchen' | 'cleaning' | 'tools' | 'driver';
type ChecklistItemTeam = Exclude<ChecklistTeamKey, 'all'>;

type ChecklistItem = {
  id: string;
  text: string;
  done: boolean;
  team: ChecklistItemTeam;
  sequence: number;
};

const CHECKLIST_DOC_ID = 'team-1';
const CHECKLIST_SCHEMA_VERSION = 3;

const TEAM_META: Record<ChecklistTeamKey, { label: string; description: string; badge: string }> = {
  all: { label: 'All Teams', description: 'Everything that must be packed into the truck', badge: 'All' },
  shared: { label: 'Shared', description: 'Cross-team pack checks everyone should see', badge: 'Shared' },
  front: { label: 'Team Front', description: 'Counter, service, display and drinks gear', badge: 'Front' },
  kitchen: { label: 'Team Kitchen', description: 'Oven, ingredients and kitchen tool pack-out', badge: 'Kitchen' },
  cleaning: { label: 'Cleaning', description: 'Cleaning kit, rubbish flow and dirty linen', badge: 'Cleaning' },
  tools: { label: 'Tools', description: 'Tools and fixings that must not get left behind', badge: 'Tools' },
  driver: { label: 'Driver & Load', description: 'Utilities, truck loading positions and final securing', badge: 'Driver' },
};

const SEQUENCE_LABELS = [
  '1. Strip the service and display layer first.',
  '2. Shut down kitchen and move loose equipment into pack-ready groups.',
  '3. Clear cleaning, waste and utilities before load-out starts.',
  '4. Pack stall structure and larger loose pieces.',
  '5. Load into fixed truck positions and secure for departure.',
];

const TEAM_SEQUENCE_SUGGESTIONS: Record<ChecklistTeamKey, string[]> = {
  all: SEQUENCE_LABELS,
  shared: [
    'Call the pack-down start so every team stops improvising.',
    'Count loose shared items like signage, cable channels and decoration boxes early.',
    'Do the final cross-team check before the truck doors close.',
  ],
  front: [
    'Start with condiments, basil, labels and service consumables so the counter clears fast.',
    'Pack counter tools, drinks stock and front-of-house equipment next.',
    'Leave furniture, sign removal and final counter move until the lane is clear.',
  ],
  kitchen: [
    'Return food to storage first, then clear loose peels, boards and utensils.',
    'Shut the oven down and pack chimney and fire kit before moving heavy kitchen gear.',
    'Group containers, mixer and rolling machine together before load-in.',
  ],
  cleaning: [
    'Clear rubbish and dirty consumables before the last people leave the work area.',
    'Pack chemicals, soaps, disinfectant and spare garbage bags into one cleaning kit.',
    'Load the Dirty Linen & Washing Box last so it comes out first at home.',
  ],
  tools: [
    'Collect hand tools as soon as setup hardware starts coming down.',
    'Check clamps, ratchet set, rope and toolboxes as one bundle.',
    'Do one last sweep under counters and around the oven before closing the tool count.',
  ],
  driver: [
    'Drain and roll utilities before loading fixed truck positions.',
    'Load chimney bin, countertops, drawers and sign bars into their known transport spots.',
    'Finish with flap, windows, hatches and roof securing in one deliberate pass.',
  ],
};

const buildDefaultItem = (
  id: string,
  text: string,
  team: ChecklistItemTeam,
  sequence: number
): ChecklistItem => ({ id, text, done: false, team, sequence });

const DEFAULT_ITEMS: ChecklistItem[] = [
  buildDefaultItem('shared-signage', 'Signage packed', 'shared', 1),
  buildDefaultItem('shared-setup-equipment', 'Setup equipment packed', 'shared', 1),
  buildDefaultItem('shared-decoration-boxes', 'Decoration boxes packed for transport', 'shared', 4),
  buildDefaultItem('front-plates', 'Plates packed', 'front', 1),
  buildDefaultItem('front-serviettes', 'Customer serviettes packed', 'front', 1),
  buildDefaultItem('front-napkin-holder', 'Napkin holder packed', 'front', 1),
  buildDefaultItem('front-pizza-boxes', 'Pizza boxes packed', 'front', 1),
  buildDefaultItem('front-cutting-board', 'Pizza cutting board packed', 'front', 2),
  buildDefaultItem('front-pizza-cutters', 'Pizza cutters packed', 'front', 2),
  buildDefaultItem('front-slice-server', 'Slice server packed', 'front', 2),
  buildDefaultItem('front-serving-board', 'Serving board packed', 'front', 2),
  buildDefaultItem('front-salt', 'Salt packed', 'front', 1),
  buildDefaultItem('front-pepper', 'Pepper packed', 'front', 1),
  buildDefaultItem('front-oregano', 'Oregano packed', 'front', 1),
  buildDefaultItem('front-chilli-oil', 'Chilli oil packed', 'front', 1),
  buildDefaultItem('front-tabasco', 'Tabasco packed', 'front', 1),
  buildDefaultItem('front-basil-plants', 'Basil plants packed', 'front', 1),
  buildDefaultItem('front-label-stands', 'Pizza label stands packed', 'front', 1),
  buildDefaultItem('front-label-cards', 'Pizza label cards packed', 'front', 1),
  buildDefaultItem('front-cash-system', 'Cash system packed', 'front', 2),
  buildDefaultItem('front-cash-float', 'Cash float or change packed', 'front', 2),
  buildDefaultItem('front-card-reader', 'Card reader packed', 'front', 2),
  buildDefaultItem('front-drinks-fridge', 'Drinks fridge packed', 'front', 3),
  buildDefaultItem('front-drink-crates', 'Drink crates packed', 'front', 3),
  buildDefaultItem('front-counter', 'Counter packed', 'front', 4),
  buildDefaultItem('front-stairs', 'Stairs packed', 'front', 4),
  buildDefaultItem('front-floor-panels', 'Floor panels packed if used', 'front', 4),
  buildDefaultItem('front-sign', 'Main sign packed', 'front', 4),
  buildDefaultItem('front-roof-sign', 'Roof sign packed', 'front', 4),
  buildDefaultItem('front-decorations', 'Decorations packed', 'front', 4),
  buildDefaultItem('front-lighting', 'Decorative lighting packed', 'front', 4),
  buildDefaultItem('front-tables', 'Tables packed', 'front', 4),
  buildDefaultItem('front-chairs', 'Chairs packed', 'front', 4),
  buildDefaultItem('kitchen-chimney', 'Chimney packed', 'kitchen', 2),
  buildDefaultItem('kitchen-firewood', 'Firewood and fire-lighting supplies packed', 'kitchen', 2),
  buildDefaultItem('kitchen-stainless-containers', 'Stainless steel ingredient containers packed', 'kitchen', 1),
  buildDefaultItem('kitchen-container-lids', 'Container lids packed', 'kitchen', 1),
  buildDefaultItem('kitchen-rolling-machine', 'Rolling machine packed', 'kitchen', 2),
  buildDefaultItem('kitchen-mixer', 'Dough mixer packed', 'kitchen', 2),
  buildDefaultItem('kitchen-wooden-peels', 'Wooden pizza peels packed', 'kitchen', 2),
  buildDefaultItem('kitchen-metal-peel', 'Metal turning peel packed', 'kitchen', 2),
  buildDefaultItem('kitchen-cutting-boards', 'Kitchen cutting boards packed', 'kitchen', 2),
  buildDefaultItem('kitchen-knives', 'Knives packed', 'kitchen', 2),
  buildDefaultItem('kitchen-spoons', 'Spoons packed', 'kitchen', 2),
  buildDefaultItem('kitchen-sauce-ladle', 'Sauce ladle packed', 'kitchen', 2),
  buildDefaultItem('kitchen-blender', 'Blender packed', 'kitchen', 2),
  buildDefaultItem('kitchen-containers-buckets', 'Containers and buckets packed', 'kitchen', 2),
  buildDefaultItem('cleaning-supplies', 'Cleaning supplies packed', 'cleaning', 3),
  buildDefaultItem('cleaning-cleaner', 'Cleaner packed', 'cleaning', 3),
  buildDefaultItem('cleaning-soaps', 'Soaps packed', 'cleaning', 3),
  buildDefaultItem('cleaning-disinfectant', 'Disinfectant packed', 'cleaning', 3),
  buildDefaultItem('cleaning-buckets', 'Buckets packed', 'cleaning', 3),
  buildDefaultItem('cleaning-garbage-cans', 'Garbage cans packed', 'cleaning', 3),
  buildDefaultItem('cleaning-garbage-bags', 'Garbage bags packed', 'cleaning', 3),
  buildDefaultItem('cleaning-dirty-linen-box', 'Dirty Linen & Washing Box packed', 'cleaning', 5),
  buildDefaultItem('tools-drill', 'Drill packed', 'tools', 3),
  buildDefaultItem('tools-ratchet-set', 'Ratchet set packed', 'tools', 3),
  buildDefaultItem('tools-clamps', 'Clamps packed', 'tools', 3),
  buildDefaultItem('tools-rope', 'Rope packed', 'tools', 3),
  buildDefaultItem('tools-toolboxes', 'Toolboxes packed', 'tools', 3),
  buildDefaultItem('driver-water-pipes', 'Water pipes rolled and packed', 'driver', 3),
  buildDefaultItem('driver-cable-channels', 'All 4 PW cable channels packed', 'driver', 3),
  buildDefaultItem('driver-extension-cables', 'Extension cables packed', 'driver', 3),
  buildDefaultItem('driver-main-power-cable', 'Main power cable packed', 'driver', 3),
  buildDefaultItem('driver-multiplugs', 'Multi-plugs packed', 'driver', 3),
  buildDefaultItem('driver-sign-bars', 'Sign reinforcement bars stored under dough-tray drawers', 'driver', 5),
  buildDefaultItem('driver-chimney-bin', 'Square plastic garbage bin for chimney packed', 'driver', 5),
  buildDefaultItem('driver-countertops', 'Countertops loaded flat against fridge doors', 'driver', 5),
  buildDefaultItem('driver-drawers-secured', 'Drawers closed and secured', 'driver', 5),
  buildDefaultItem('driver-gas-shock-protectors', 'Gas-shock safety protectors stored', 'driver', 5),
];

function normalizeTeam(raw: unknown): ChecklistItemTeam {
  if (raw === 'front' || raw === 'kitchen' || raw === 'cleaning' || raw === 'tools' || raw === 'driver') {
    return raw;
  }
  return 'shared';
}

function normalizeSequence(raw: unknown, fallback = 5) {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 && raw <= 5 ? raw : fallback;
}

function normalizeItem(raw: any): ChecklistItem {
  return {
    id: String(raw?.id || makeItemId()),
    text: String(raw?.text || '').trim(),
    done: !!raw?.done,
    team: normalizeTeam(raw?.team),
    sequence: normalizeSequence(raw?.sequence),
  };
}

function sortChecklistItems(items: ChecklistItem[]) {
  return [...items].sort((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    return a.text.localeCompare(b.text);
  });
}

function migrateChecklistItems(existingItems: ChecklistItem[], schemaVersion?: number | null) {
  const customItems = existingItems
    .filter(item => item.id.startsWith('item-'))
    .map(item => ({
      ...item,
      team: normalizeTeam(item.team),
      sequence: normalizeSequence(item.sequence),
    }));

  if ((schemaVersion || 0) < CHECKLIST_SCHEMA_VERSION) {
    return sortChecklistItems([...DEFAULT_ITEMS, ...customItems]);
  }

  const defaultById = new Map(DEFAULT_ITEMS.map(item => [item.id, item]));
  const cleanedItems = existingItems
    .map(item => ({
      ...item,
      team: normalizeTeam(item.team),
      sequence: normalizeSequence(item.sequence),
    }))
    .filter(item => item.id.startsWith('item-') || defaultById.has(item.id));

  const merged = cleanedItems.map(item => {
    const defaultItem = defaultById.get(item.id);
    if (!defaultItem) return item;
    return { ...defaultItem, done: item.done };
  });

  const existingIds = new Set(merged.map(item => item.id));
  const missingDefaults = DEFAULT_ITEMS.filter(item => !existingIds.has(item.id));
  return sortChecklistItems([...merged, ...missingDefaults]);
}

function makeItemId() {
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getVisibleItems(items: ChecklistItem[], team: ChecklistTeamKey) {
  if (team === 'all') return items;
  if (team === 'shared') return items.filter(item => item.team === 'shared');
  return items.filter(item => item.team === 'shared' || item.team === team);
}

function getSequenceLabel(sequence: number) {
  return SEQUENCE_LABELS[sequence - 1] || 'Suggested packing step';
}

export default function DepartureChecklistScreen({ navigation }: Props) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<ChecklistTeamKey>('all');
  const [newItemText, setNewItemText] = useState('');
  const [newItemTeam, setNewItemTeam] = useState<ChecklistItemTeam>('shared');
  const [saving, setSaving] = useState(false);
  const [lastUpdatedBy, setLastUpdatedBy] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');

  useEffect(() => {
    if (team !== 'all' && team !== 'shared') {
      setNewItemTeam(team);
    }
  }, [team]);

  useEffect(() => {
    const fs = getFirestore();
    const checklistRef = doc(fs, 'departureChecklist', CHECKLIST_DOC_ID);

    const unsubscribe = onSnapshot(
      checklistRef,
      async snap => {
        if (!snap.exists()) {
          await setDoc(
            checklistRef,
            {
              items: DEFAULT_ITEMS,
              teamId: CHECKLIST_DOC_ID,
              schemaVersion: CHECKLIST_SCHEMA_VERSION,
              updatedAt: serverTimestamp(),
              updatedByUid: auth.currentUser?.uid || '',
              updatedByEmail: auth.currentUser?.email || '',
            },
            { merge: true }
          );
          return;
        }

        const data = snap.data();
        const incomingItems = Array.isArray(data?.items)
          ? data.items.map(normalizeItem).filter((item: ChecklistItem) => item.text)
          : [];
        const nextItems = migrateChecklistItems(
          incomingItems,
          typeof data?.schemaVersion === 'number' ? data.schemaVersion : null
        );

        setItems(nextItems);
        setLastUpdatedBy(String(data?.updatedByEmail || ''));
        setLastUpdatedAt(
          data?.updatedAt && typeof data.updatedAt.toDate === 'function'
            ? data.updatedAt.toDate().toLocaleString()
            : ''
        );

        if (
          nextItems.length !== incomingItems.length ||
          (typeof data?.schemaVersion !== 'number' || data.schemaVersion < CHECKLIST_SCHEMA_VERSION)
        ) {
          void setDoc(
            checklistRef,
            {
              items: nextItems,
              schemaVersion: CHECKLIST_SCHEMA_VERSION,
              updatedAt: serverTimestamp(),
              updatedByUid: auth.currentUser?.uid || '',
              updatedByEmail: auth.currentUser?.email || '',
            },
            { merge: true }
          );
        }
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  const visibleItems = useMemo(() => getVisibleItems(items, team), [items, team]);
  const completeCount = useMemo(() => visibleItems.filter(item => item.done).length, [visibleItems]);
  const progress = visibleItems.length ? completeCount / visibleItems.length : 0;
  const visibleSequenceCounts = useMemo(() => {
    const counts = new Map<number, number>();
    visibleItems.forEach(item => {
      counts.set(item.sequence, (counts.get(item.sequence) || 0) + 1);
    });
    return counts;
  }, [visibleItems]);

  const persistItems = async (nextItems: ChecklistItem[]) => {
    const fs = getFirestore();
    const checklistRef = doc(fs, 'departureChecklist', CHECKLIST_DOC_ID);
    await setDoc(
      checklistRef,
      {
        items: nextItems,
        teamId: CHECKLIST_DOC_ID,
        schemaVersion: CHECKLIST_SCHEMA_VERSION,
        updatedAt: serverTimestamp(),
        updatedByUid: auth.currentUser?.uid || '',
        updatedByEmail: auth.currentUser?.email || '',
      },
      { merge: true }
    );
  };

  const toggleItem = async (itemId: string) => {
    const nextItems = items.map(item =>
      item.id === itemId ? { ...item, done: !item.done } : item
    );
    setItems(nextItems);
    try {
      await persistItems(nextItems);
    } catch (error: any) {
      Alert.alert('Could not update', error?.message || 'Checklist update failed.');
    }
  };

  const handleAddItem = async () => {
    const text = newItemText.trim();
    if (!text || saving) return;

    const nextItems = sortChecklistItems([
      ...items,
      {
        id: makeItemId(),
        text,
        done: false,
        team: newItemTeam,
        sequence: newItemTeam === 'driver' ? 5 : newItemTeam === 'cleaning' || newItemTeam === 'tools' ? 3 : 2,
      },
    ]);
    setSaving(true);
    setItems(nextItems);
    setNewItemText('');
    try {
      await persistItems(nextItems);
    } catch (error: any) {
      Alert.alert('Could not add item', error?.message || 'Checklist update failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Admin</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Departure Checklist</Text>
        <View style={{ width: 56 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.teamRow}>
          {(Object.keys(TEAM_META) as ChecklistTeamKey[]).map(teamKey => {
            const selected = team === teamKey;
            return (
              <TouchableOpacity
                key={teamKey}
                style={[styles.teamChip, selected && styles.teamChipActive]}
                onPress={() => setTeam(teamKey)}
              >
                <Text style={[styles.teamChipBadge, selected && styles.teamChipBadgeActive]}>
                  {TEAM_META[teamKey].badge}
                </Text>
                <Text style={[styles.teamChipTitle, selected && styles.teamChipTitleActive]}>
                  {TEAM_META[teamKey].label}
                </Text>
                <Text style={[styles.teamChipText, selected && styles.teamChipTextActive]}>
                  {TEAM_META[teamKey].description}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>PACKED INTO THE TRUCK BEFORE LEAVING</Text>
          <Text style={styles.heroTitle}>Equipment checklist, split by team</Text>
          <Text style={styles.heroText}>
            This screen is now only for physical equipment and pack-out items. Use team filters so each crew checks its own gear, then do a final all-team sweep.
          </Text>
        </View>

        <View style={styles.progressCard}>
          <View style={styles.progressTopRow}>
            <View>
              <Text style={styles.progressLabel}>Progress</Text>
              <Text style={styles.progressValue}>
                {completeCount}/{visibleItems.length} packed
              </Text>
            </View>
            <View style={styles.progressPill}>
              <Text style={styles.progressPillText}>
                {TEAM_META[team].label} view
              </Text>
            </View>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(progress * 100, 4)}%` }]} />
          </View>
          {lastUpdatedBy || lastUpdatedAt ? (
            <Text style={styles.updatedText}>
              Last updated by {lastUpdatedBy || 'unknown user'}
              {lastUpdatedAt ? ` at ${lastUpdatedAt}` : ''}
            </Text>
          ) : null}
        </View>

        <View style={styles.sequenceCard}>
          <Text style={styles.sectionTitle}>Suggested sequence</Text>
          <Text style={styles.sequenceIntro}>
            Pack in a consistent order so loose equipment gets smaller before the heavy load positions are locked in.
          </Text>
          {TEAM_SEQUENCE_SUGGESTIONS[team].map((suggestion, index) => (
            <View key={`${team}-${index}`} style={styles.sequenceRow}>
              <View style={styles.sequenceDot} />
              <Text style={styles.sequenceText}>{suggestion}</Text>
            </View>
          ))}
        </View>

        <View style={styles.addCard}>
          <Text style={styles.sectionTitle}>Add checklist item</Text>
          <TextInput
            value={newItemText}
            onChangeText={setNewItemText}
            placeholder="e.g. Spare canopy weights packed"
            placeholderTextColor="#8F7E6D"
            style={styles.input}
          />
          <Text style={styles.assignLabel}>Assign to team</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.assignRow}>
            {(['shared', 'front', 'kitchen', 'cleaning', 'tools', 'driver'] as ChecklistItemTeam[]).map(teamKey => {
              const selected = newItemTeam === teamKey;
              return (
                <TouchableOpacity
                  key={teamKey}
                  style={[styles.assignChip, selected && styles.assignChipActive]}
                  onPress={() => setNewItemTeam(teamKey)}
                >
                  <Text style={[styles.assignChipText, selected && styles.assignChipTextActive]}>
                    {TEAM_META[teamKey].label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity
            style={[styles.addButton, (!newItemText.trim() || saving) && styles.addButtonDisabled]}
            onPress={() => void handleAddItem()}
            disabled={!newItemText.trim() || saving}
          >
            {saving ? <ActivityIndicator color="#F8F1E8" /> : <Text style={styles.addButtonText}>Add Item</Text>}
          </TouchableOpacity>
        </View>

        <View style={styles.listCard}>
          <Text style={styles.sectionTitle}>Checklist</Text>
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#E2A14A" />
              <Text style={styles.loadingText}>Loading checklist…</Text>
            </View>
          ) : visibleItems.length === 0 ? (
            <Text style={styles.emptyText}>No checklist items for this team filter yet.</Text>
          ) : (
            visibleItems.map((item, index) => (
              <TouchableOpacity
                key={item.id}
                style={[styles.itemRow, item.done && styles.itemRowDone]}
                onPress={() => void toggleItem(item.id)}
              >
                <View style={[styles.checkbox, item.done && styles.checkboxDone]}>
                  <Text style={styles.checkboxText}>{item.done ? '✓' : ''}</Text>
                </View>
                <View style={styles.itemBody}>
                  <View style={styles.itemTopRow}>
                    <Text style={[styles.itemIndex, item.done && styles.itemIndexDone]}>
                      {String(index + 1).padStart(2, '0')}
                    </Text>
                    <Text style={styles.itemTeamTag}>{TEAM_META[item.team].badge}</Text>
                    <Text style={styles.itemSequenceTag}>Step {item.sequence}</Text>
                  </View>
                  <Text style={[styles.itemText, item.done && styles.itemTextDone]}>{item.text}</Text>
                  <Text style={styles.itemHint}>
                    {getSequenceLabel(item.sequence)}
                    {visibleSequenceCounts.get(item.sequence) ? ` ${visibleSequenceCounts.get(item.sequence)} item${visibleSequenceCounts.get(item.sequence) === 1 ? '' : 's'} in this step.` : ''}
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#16110E' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#332720',
    backgroundColor: '#1D1612',
  },
  back: { color: '#E2A14A', fontSize: 16, fontWeight: '700' },
  title: { color: '#F8F1E8', fontSize: 24, fontWeight: '800' },
  content: { padding: 18, paddingBottom: 40, gap: 16 },
  teamRow: { gap: 12, paddingRight: 12 },
  teamChip: {
    width: 210,
    backgroundColor: '#201813',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#3B2C22',
  },
  teamChipActive: {
    backgroundColor: '#3A2619',
    borderColor: '#E2A14A',
  },
  teamChipBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#32261F',
    color: '#C9AA82',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 10,
  },
  teamChipBadgeActive: {
    backgroundColor: '#E2A14A',
    color: '#2A170E',
  },
  teamChipTitle: {
    color: '#F8F1E8',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  teamChipTitleActive: { color: '#FFF8EF' },
  teamChipText: {
    color: '#BFA690',
    fontSize: 12,
    lineHeight: 17,
  },
  teamChipTextActive: { color: '#E9D7C7' },
  heroCard: {
    backgroundColor: '#2B2019',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#4B382B',
  },
  heroEyebrow: {
    color: '#D8B07A',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
  },
  heroTitle: { color: '#FFF6EC', fontSize: 28, fontWeight: '900', lineHeight: 32, marginBottom: 8 },
  heroText: { color: '#D6C0AC', fontSize: 14, lineHeight: 20 },
  progressCard: {
    backgroundColor: '#221A15',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#3C2E25',
  },
  progressTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  progressLabel: {
    color: '#C7AA86',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  progressValue: { color: '#FFF7ED', fontSize: 24, fontWeight: '900', marginTop: 4 },
  progressPill: {
    backgroundColor: '#16110E',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#433228',
    maxWidth: '100%',
  },
  progressPillText: { color: '#D9C4AE', fontSize: 12, fontWeight: '700' },
  progressTrack: {
    height: 12,
    backgroundColor: '#120E0C',
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#3C2D24',
  },
  progressFill: { height: '100%', backgroundColor: '#E2A14A', borderRadius: 999 },
  updatedText: { color: '#BFA690', fontSize: 12, marginTop: 10, lineHeight: 18 },
  sequenceCard: {
    backgroundColor: '#211915',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#3C2E25',
  },
  sectionTitle: { color: '#F8F1E8', fontSize: 18, fontWeight: '800', marginBottom: 10 },
  sequenceIntro: { color: '#CBB39C', fontSize: 13, lineHeight: 19, marginBottom: 10 },
  sequenceRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  sequenceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    backgroundColor: '#E2A14A',
  },
  sequenceText: { color: '#F3E6D8', fontSize: 14, lineHeight: 20, flex: 1 },
  addCard: {
    backgroundColor: '#211915',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#3C2E25',
  },
  input: {
    backgroundColor: '#17120F',
    borderWidth: 1,
    borderColor: '#3B2D24',
    borderRadius: 12,
    color: '#F8F1E8',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 12,
  },
  assignLabel: {
    color: '#C7AA86',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  assignRow: { gap: 8, paddingRight: 12, marginBottom: 12 },
  assignChip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#17120F',
    borderWidth: 1,
    borderColor: '#3B2D24',
  },
  assignChipActive: {
    backgroundColor: '#E2A14A',
    borderColor: '#E2A14A',
  },
  assignChipText: { color: '#E6D4C3', fontSize: 12, fontWeight: '700' },
  assignChipTextActive: { color: '#281A10' },
  addButton: {
    backgroundColor: '#E2A14A',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  addButtonDisabled: { opacity: 0.5 },
  addButtonText: { color: '#24160D', fontSize: 14, fontWeight: '900' },
  listCard: {
    backgroundColor: '#211915',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#3C2E25',
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  loadingText: { color: '#D8C4B2', fontSize: 13, fontWeight: '700' },
  emptyText: { color: '#BFA690', fontSize: 14 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#17120F',
    borderWidth: 1,
    borderColor: '#332720',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  itemRowDone: {
    borderColor: '#486448',
    backgroundColor: '#182017',
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#6B573E',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    backgroundColor: '#241B16',
    marginTop: 4,
  },
  checkboxDone: {
    backgroundColor: '#2E674A',
    borderColor: '#3E8A63',
  },
  checkboxText: { color: '#FFF8F0', fontWeight: '900', fontSize: 14 },
  itemBody: { flex: 1 },
  itemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  itemIndex: { color: '#C7AA86', fontSize: 12, fontWeight: '900' },
  itemIndexDone: { color: '#A9D5B3' },
  itemTeamTag: {
    color: '#E2A14A',
    fontSize: 11,
    fontWeight: '800',
    backgroundColor: '#241A14',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  itemSequenceTag: {
    color: '#CDB090',
    fontSize: 11,
    fontWeight: '800',
  },
  itemText: { color: '#F7EFE5', fontSize: 15, fontWeight: '700', lineHeight: 20 },
  itemTextDone: { color: '#B6D7BE', textDecorationLine: 'line-through' },
  itemHint: { color: '#A9927D', fontSize: 12, lineHeight: 18, marginTop: 6 },
});
