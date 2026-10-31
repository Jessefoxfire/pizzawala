import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { collection, getFirestore, onSnapshot } from '@react-native-firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import PizzaFireScreen from '../components/PizzaFireScreen';
import ReceiptDocumentPreview from '../components/ReceiptDocumentPreview';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { formatAmountInput, formatEuro, formatReceiptAmount, parseMoneyToCents } from '../domain/receipts/money';
import { formatReceiptDate, monthTitle, parseReceiptDate, shiftMonth } from '../domain/receipts/dates';
import { readReceipt, resolveEventName, type NormalizedReceipt } from '../domain/receipts/receiptRecord';
import { filterReceipts, summarizeReceipts } from '../domain/receipts/totals';
import { receiptTypeLabel, type ReceiptType } from '../domain/receipts/types';
import { updateReceiptDetails } from '../services/receipts';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import { formColumnFrame, useAppLayout } from '../theme/responsiveLayout';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminReceipts'>;

export default function AdminReceiptsScreen({ navigation }: Props) {
  const layout = useAppLayout();
  const [receipts, setReceipts] = useState<NormalizedReceipt[]>([]);
  const [events, setEvents] = useState<{ id: string; title: string }[]>([]);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [memberId, setMemberId] = useState<string | null>(null);
  const [type, setType] = useState<'all' | ReceiptType>('all');
  const [eventFilter, setEventFilter] = useState<'all' | 'none' | string>('all');
  const [picker, setPicker] = useState<'member' | 'event' | null>(null);
  const [editing, setEditing] = useState<NormalizedReceipt | null>(null);
  const [saving, setSaving] = useState(false);
  const [editType, setEditType] = useState<ReceiptType | null>(null);
  const [editEventId, setEditEventId] = useState<string | null>(null);
  const [editMerchant, setEditMerchant] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editInvoice, setEditInvoice] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editVat, setEditVat] = useState<{ ratePercent: number; taxText: string }[]>([]);

  useEffect(() => {
    const fs = getFirestore();
    const unsubReceipts = onSnapshot(collection(fs, 'receipts'), snap => {
      setReceipts(snap.docs.map(item => readReceipt(item.id, item.data() as Record<string, unknown>)));
    }, () => setReceipts([]));
    const unsubEvents = onSnapshot(collection(fs, 'events'), snap => {
      setEvents(snap.docs.map(item => {
        const data = item.data() as { title?: string; locationName?: string };
        return { id: item.id, title: data.title || data.locationName || 'Event' };
      }));
    }, () => setEvents([]));
    return () => {
      unsubReceipts();
      unsubEvents();
    };
  }, []);

  const eventMap = useMemo(() => new Map(events.map(event => [event.id, event])), [events]);
  const members = useMemo(() => {
    const map = new Map<string, string>();
    receipts.forEach(receipt => {
      if (receipt.userId) map.set(receipt.userId, receipt.userName);
    });
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [receipts]);

  const visible = useMemo(
    () => filterReceipts(receipts, { month, userId: memberId, type, event: eventFilter })
      .sort((a, b) => String(b.receiptDate || b.submittedAtIso || '').localeCompare(String(a.receiptDate || a.submittedAtIso || ''))),
    [receipts, month, memberId, type, eventFilter]
  );
  const totals = useMemo(() => summarizeReceipts(visible), [visible]);
  const memberLabel = members.find(member => member.id === memberId)?.name || 'All members';
  const eventLabel = eventFilter === 'all'
    ? 'All events'
    : eventFilter === 'none'
      ? 'General / No event'
      : resolveEventName(eventFilter, eventMap);

  const openEditor = (receipt: NormalizedReceipt) => {
    setEditing(receipt);
    setEditType(receipt.type);
    setEditEventId(receipt.eventId);
    setEditMerchant(receipt.merchant || '');
    setEditDate(receipt.receiptDate ? formatReceiptDate(receipt.receiptDate) : '');
    setEditAmount(receipt.amountCents == null ? '' : formatAmountInput(receipt.amountCents));
    setEditInvoice(receipt.invoiceNumber || '');
    setEditNote(receipt.note || '');
    setEditVat(receipt.vatBreakdown.map(item => ({
      ratePercent: item.ratePercent,
      taxText: item.taxCents == null ? '' : formatAmountInput(item.taxCents),
    })));
  };

  const saveEdit = async () => {
    if (!editing) return;
    const receiptDate = editDate.trim() ? parseReceiptDate(editDate) : null;
    if (editDate.trim() && !receiptDate) {
      Alert.alert('Check the receipt', 'Use the date format DD.MM.YYYY.');
      return;
    }
    const amountCents = editAmount.trim() ? parseMoneyToCents(editAmount) : null;
    if (editAmount.trim() && amountCents == null) {
      Alert.alert('Check the receipt', 'Enter a valid amount.');
      return;
    }
    if (editVat.some(item => item.taxText.trim() && parseMoneyToCents(item.taxText) == null)) {
      Alert.alert('Check the receipt', 'Enter a valid VAT amount or leave it blank.');
      return;
    }
    setSaving(true);
    try {
      await updateReceiptDetails(editing.id, {
        type: editType,
        eventId: editEventId,
        merchant: editMerchant,
        receiptDate,
        amountCents,
        invoiceNumber: editInvoice.trim() || null,
        note: editNote,
        vatBreakdown: editVat.map(item => ({
          ratePercent: item.ratePercent,
          taxCents: item.taxText.trim() ? parseMoneyToCents(item.taxText) : null,
        })),
        clearLegacyEventAssociation: editing.legacyAssociationKind === 'event' && !editEventId,
      });
      setEditing(null);
    } catch (error: any) {
      Alert.alert('Could not update receipt', error?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PizzaFireScreen>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>‹ Admin</Text></TouchableOpacity>
        <Text style={styles.title}>Receipts</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, formColumnFrame(layout)]}>
        <View style={styles.monthRow}>
          <TouchableOpacity onPress={() => setMonth(current => shiftMonth(current, -1))}><Text style={styles.monthArrow}>‹</Text></TouchableOpacity>
          <Text style={styles.monthTitle}>RECEIPTS · {monthTitle(month).toUpperCase()}</Text>
          <TouchableOpacity onPress={() => setMonth(current => shiftMonth(current, 1))}><Text style={styles.monthArrow}>›</Text></TouchableOpacity>
        </View>
        <View style={styles.summary}>
          <SummaryLine label="Versorgung" cents={totals.versorgungCents} />
          <SummaryLine label="Firma" cents={totals.firmaCents} />
          {totals.otherCents ? <SummaryLine label="Earlier receipts" cents={totals.otherCents} /> : null}
          <SummaryLine label="Total" cents={totals.totalCents} strong />
        </View>
        <View style={styles.filters}>
          <FilterChip label={memberLabel} onPress={() => setPicker('member')} />
          <FilterChip label={type === 'all' ? 'All types' : receiptTypeLabel(type)} onPress={() => setType(current => current === 'all' ? 'versorgung' : current === 'versorgung' ? 'firma' : 'all')} />
          <FilterChip label={eventLabel} onPress={() => setPicker('event')} />
        </View>
        {visible.length === 0 ? <View style={styles.card}><Text style={styles.muted}>No receipts for this filter.</Text></View> : visible.map(item => (
          <TouchableOpacity key={item.id} style={styles.card} onPress={() => openEditor(item)}>
            <View style={styles.row}>
              <Text style={styles.cardTitle}>{item.merchant || item.category || 'Receipt'}</Text>
              <Text style={styles.amount}>{formatReceiptAmount(item.amountCents)}</Text>
            </View>
            <Text style={styles.muted}>{item.userName} · {item.receiptDate ? formatReceiptDate(item.receiptDate) : 'Date not set'}</Text>
            <Text style={styles.muted}>
              {item.type ? receiptTypeLabel(item.type) : item.category || 'No type'}
              {item.eventId ? ` · ${resolveEventName(item.eventId, eventMap)}` : item.legacyAssociationLabel ? ` · ${item.legacyAssociationLabel}` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal visible={!!picker} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
        <View style={styles.selectorBack}>
          <View style={styles.selectorCard}>
            <Text style={styles.modalTitle}>{picker === 'member' ? 'Member' : 'Event'}</Text>
            <ScrollView>
              {picker === 'member' ? (
                <>
                  <Option label="All members" selected={!memberId} onPress={() => { setMemberId(null); setPicker(null); }} />
                  {members.map(member => <Option key={member.id} label={member.name} selected={memberId === member.id} onPress={() => { setMemberId(member.id); setPicker(null); }} />)}
                </>
              ) : (
                <>
                  <Option label="All events" selected={eventFilter === 'all'} onPress={() => { setEventFilter('all'); setPicker(null); }} />
                  <Option label="General / No event" selected={eventFilter === 'none'} onPress={() => { setEventFilter('none'); setPicker(null); }} />
                  {events.map(event => <Option key={event.id} label={event.title} selected={eventFilter === event.id} onPress={() => { setEventFilter(event.id); setPicker(null); }} />)}
                </>
              )}
            </ScrollView>
            <TouchableOpacity onPress={() => setPicker(null)}><Text style={styles.cancel}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView style={styles.modalBack} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.modal}>
              <Text style={styles.modalTitle}>{editing?.userName || 'Receipt'}</Text>
              {editing?.submittedAtIso ? <Text style={styles.muted}>Uploaded {editing.submittedAtIso.slice(0, 10)}</Text> : null}
              <ReceiptDocumentPreview pages={(editing?.pages || []).map(page => ({ uri: page.url, mimeType: page.mimeType, fileName: page.fileName }))} />
              <Text style={styles.label}>Type</Text>
              <View style={styles.typeRow}>
                {(['versorgung', 'firma'] as ReceiptType[]).map(option => (
                  <TouchableOpacity key={option} style={[styles.typeButton, editType === option && styles.typeButtonOn]} onPress={() => setEditType(option)}>
                    <Text style={[styles.typeText, editType === option && styles.typeTextOn]}>{receiptTypeLabel(option)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>Event</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.eventChoices}>
                <TouchableOpacity style={[styles.choice, !editEventId && styles.choiceOn]} onPress={() => setEditEventId(null)}>
                  <Text style={styles.choiceText}>General / No event</Text>
                </TouchableOpacity>
                {events.map(event => (
                  <TouchableOpacity key={event.id} style={[styles.choice, editEventId === event.id && styles.choiceOn]} onPress={() => setEditEventId(event.id)}>
                    <Text style={styles.choiceText}>{event.title}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {editing && !editing.eventId && editing.legacyAssociationKind === 'worksite' && editing.legacyAssociationLabel ? (
                <Text style={styles.muted}>Earlier worksite link: {editing.legacyAssociationLabel}</Text>
              ) : null}
              <Text style={styles.label}>Merchant</Text>
              <TextInput style={styles.input} value={editMerchant} onChangeText={setEditMerchant} placeholder="Merchant" placeholderTextColor="#9E8875" />
              <Text style={styles.label}>Receipt date</Text>
              <TextInput style={styles.input} value={editDate} onChangeText={setEditDate} placeholder="DD.MM.YYYY" placeholderTextColor="#9E8875" />
              <Text style={styles.label}>Amount</Text>
              <TextInput style={styles.input} value={editAmount} onChangeText={setEditAmount} placeholder="0,00" keyboardType="decimal-pad" placeholderTextColor="#9E8875" />
              {editVat.length ? (
                <>
                  <Text style={styles.label}>VAT</Text>
                  {editVat.map((item, index) => (
                    <View key={`${item.ratePercent}-${index}`} style={styles.vatRow}>
                      <Text style={styles.vatRate}>{item.ratePercent}%</Text>
                      <TextInput style={[styles.input, styles.vatInput]} value={item.taxText} onChangeText={value => setEditVat(current => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, taxText: value } : entry))} placeholder="Tax" keyboardType="decimal-pad" placeholderTextColor="#9E8875" />
                    </View>
                  ))}
                </>
              ) : null}
              <Text style={styles.label}>Receipt / invoice number</Text>
              <TextInput style={styles.input} value={editInvoice} onChangeText={setEditInvoice} placeholder="Optional" placeholderTextColor="#9E8875" />
              <Text style={styles.label}>Note</Text>
              <TextInput style={[styles.input, styles.note]} value={editNote} onChangeText={setEditNote} placeholder="Optional" multiline placeholderTextColor="#9E8875" />
              <TouchableOpacity style={[styles.primary, saving && styles.disabled]} disabled={saving} onPress={() => void saveEdit()}>
                {saving ? <ActivityIndicator color={PIZZA_FIRE.charcoal} /> : <Text style={styles.primaryText}>Save changes</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setEditing(null)}><Text style={styles.cancel}>Close</Text></TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </PizzaFireScreen>
  );
}

function SummaryLine({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <View style={styles.summaryLine}>
      <Text style={[styles.summaryLabel, strong && styles.summaryStrong]}>{label}</Text>
      <Text style={[styles.summaryValue, strong && styles.summaryStrong]}>{formatEuro(cents)}</Text>
    </View>
  );
}

function FilterChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.chip} onPress={onPress}>
      <Text style={styles.chipText} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

function Option({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.option} onPress={onPress}>
      <Text style={styles.optionText}>{label}</Text>
      {selected ? <Text style={styles.check}>✓</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18, borderBottomWidth: 1, borderBottomColor: PIZZA_FIRE.divider },
  back: { color: PIZZA_FIRE.gold, fontWeight: '800' },
  title: { color: PIZZA_FIRE.textPrimary, fontWeight: '900', fontSize: 20 },
  headerSpacer: { width: 76 },
  content: { padding: 18, gap: 14, paddingBottom: 44 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthArrow: { color: PIZZA_FIRE.gold, fontSize: 28, fontWeight: '900', paddingHorizontal: 8 },
  monthTitle: { color: '#D8B07A', fontSize: 13, fontWeight: '900', letterSpacing: 0.6, textAlign: 'center', flex: 1 },
  summary: { backgroundColor: PIZZA_FIRE.surface, borderColor: PIZZA_FIRE.qlBorder, borderWidth: 1, borderRadius: 16, padding: 15, gap: 8 },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  summaryLabel: { color: PIZZA_FIRE.textSecondary, fontWeight: '700' },
  summaryValue: { color: PIZZA_FIRE.textPrimary, fontWeight: '800' },
  summaryStrong: { color: PIZZA_FIRE.gold, fontWeight: '900' },
  filters: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, backgroundColor: '#17120F', borderRadius: 10, borderWidth: 1, borderColor: PIZZA_FIRE.qlBorder, paddingVertical: 10, paddingHorizontal: 8 },
  chipText: { color: PIZZA_FIRE.textPrimary, fontWeight: '800', fontSize: 12, textAlign: 'center' },
  card: { backgroundColor: PIZZA_FIRE.surface, borderColor: PIZZA_FIRE.qlBorder, borderWidth: 1, borderRadius: 16, padding: 15, gap: 5 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  cardTitle: { flex: 1, color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '800' },
  amount: { color: PIZZA_FIRE.gold, fontSize: 16, fontWeight: '900' },
  muted: { color: PIZZA_FIRE.textSecondary, fontSize: 13 },
  modalBack: { flex: 1, backgroundColor: 'rgba(0,0,0,.78)' },
  modalScroll: { flexGrow: 1, justifyContent: 'flex-end' },
  modal: { backgroundColor: '#211915', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12, borderWidth: 1, borderColor: '#5A4030' },
  modalTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 23, fontWeight: '900' },
  label: { color: PIZZA_FIRE.textSecondary, fontWeight: '800', fontSize: 13 },
  input: { backgroundColor: '#17120F', borderWidth: 1, borderColor: PIZZA_FIRE.qlBorder, borderRadius: 10, color: PIZZA_FIRE.textPrimary, padding: 12 },
  note: { minHeight: 70, textAlignVertical: 'top' },
  typeRow: { flexDirection: 'row', gap: 10 },
  typeButton: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: PIZZA_FIRE.qlBorder, padding: 14, alignItems: 'center' },
  typeButtonOn: { backgroundColor: PIZZA_FIRE.accent, borderColor: PIZZA_FIRE.accent },
  typeText: { color: PIZZA_FIRE.textPrimary, fontWeight: '900' },
  typeTextOn: { color: PIZZA_FIRE.charcoal },
  eventChoices: { gap: 8 },
  choice: { borderRadius: 10, borderWidth: 1, borderColor: PIZZA_FIRE.qlBorder, paddingHorizontal: 12, paddingVertical: 10 },
  choiceOn: { backgroundColor: PIZZA_FIRE.accentSoftStrong, borderColor: PIZZA_FIRE.accent },
  choiceText: { color: PIZZA_FIRE.textPrimary, fontWeight: '800' },
  vatRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vatRate: { color: PIZZA_FIRE.textPrimary, fontWeight: '800', width: 48 },
  vatInput: { flex: 1 },
  primary: { backgroundColor: PIZZA_FIRE.accent, borderRadius: 12, padding: 15, alignItems: 'center' },
  primaryText: { color: PIZZA_FIRE.charcoal, fontWeight: '900' },
  cancel: { color: PIZZA_FIRE.textSecondary, textAlign: 'center', fontWeight: '800', padding: 8 },
  selectorBack: { flex: 1, backgroundColor: 'rgba(0,0,0,.72)', justifyContent: 'center', padding: 24 },
  selectorCard: { backgroundColor: '#211915', borderRadius: 18, padding: 18, maxHeight: '75%', gap: 12, borderWidth: 1, borderColor: '#5A4030' },
  option: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: PIZZA_FIRE.qlBorder, flexDirection: 'row', justifyContent: 'space-between' },
  optionText: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '700', flex: 1 },
  check: { color: PIZZA_FIRE.accent, fontSize: 18, fontWeight: '900' },
  disabled: { opacity: 0.55 },
});
