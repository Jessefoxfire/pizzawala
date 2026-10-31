import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { collection, getFirestore, onSnapshot, query, where } from '@react-native-firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import PizzaFireScreen from '../components/PizzaFireScreen';
import ReceiptDocumentPreview from '../components/ReceiptDocumentPreview';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useAuth } from '../auth/useAuth';
import { formatAmountInput, formatReceiptAmount, parseMoneyToCents } from '../domain/receipts/money';
import { formatReceiptDate, parseReceiptDate } from '../domain/receipts/dates';
import {
  applyRecognitionSuggestion,
  readReceipt,
  resolveEventName,
  validateMemberReceipt,
  type ReviewTouch,
} from '../domain/receipts/receiptRecord';
import { emptyCandidate, receiptTypeLabel, type ReceiptType, type RecognitionSnapshot, type VatComponent } from '../domain/receipts/types';
import { auth } from '../services/firebase';
import {
  adjustReceiptCrop,
  captureReceiptDocument,
  captureReceiptPhoto,
  captureScannedReceipt,
  isImagePage,
  isPdfPage,
  type LocalReceiptPage,
} from '../services/receiptCapture';
import { recognizeReceiptImages } from '../services/receiptRecognition';
import { submitReceipt } from '../services/receipts';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import { formColumnFrame, useAppLayout } from '../theme/responsiveLayout';

type Props = NativeStackScreenProps<RootStackParamList, 'ReceiptsExpenses'>;

const EMPTY_TOUCH: ReviewTouch = { merchant: false, date: false, amount: false, invoice: false, vat: false };

export default function ReceiptsExpensesScreen({ navigation }: Props) {
  const layout = useAppLayout();
  const userId = auth.currentUser?.uid || null;
  const authState = useAuth();
  const isAdmin = authState.status === 'admin';
  const [receipts, setReceipts] = useState<ReturnType<typeof readReceipt>[]>([]);
  const [events, setEvents] = useState<{ id: string; title: string }[]>([]);
  const [chooser, setChooser] = useState(false);
  const [pages, setPages] = useState<LocalReceiptPage[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [type, setType] = useState<ReceiptType | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [merchant, setMerchant] = useState('');
  const [dateText, setDateText] = useState('');
  const [amountText, setAmountText] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [note, setNote] = useState('');
  const [vat, setVat] = useState<{ ratePercent: number; taxText: string }[]>([]);
  const [recognition, setRecognition] = useState<RecognitionSnapshot | null>(null);
  const [eventPicker, setEventPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const touched = useRef<ReviewTouch>({ ...EMPTY_TOUCH });
  const draftRef = useRef({ merchant: '', dateText: '', amountText: '', invoiceNumber: '', vat: [] as VatComponent[] });

  useEffect(() => {
    draftRef.current = {
      merchant,
      dateText,
      amountText,
      invoiceNumber,
      vat: vat.map(item => ({ ratePercent: item.ratePercent, taxCents: item.taxText.trim() ? parseMoneyToCents(item.taxText) : null })),
    };
  }, [merchant, dateText, amountText, invoiceNumber, vat]);

  useEffect(() => {
    if (!userId) return undefined;
    const fs = getFirestore();
    const unsubReceipts = onSnapshot(
      query(collection(fs, 'receipts'), where('userId', '==', userId)),
      snap => {
        const next = snap.docs
          .map(item => readReceipt(item.id, item.data() as Record<string, unknown>))
          .sort((a, b) => String(b.submittedAtIso || '').localeCompare(String(a.submittedAtIso || '')));
        setReceipts(next);
      },
      () => setReceipts([])
    );
    const eventsQuery = isAdmin
      ? collection(fs, 'events')
      : query(collection(fs, 'events'), where('staffIds', 'array-contains', userId));
    const unsubEvents = onSnapshot(
      eventsQuery,
      snap => {
        setEvents(snap.docs.map(item => {
          const data = item.data() as { title?: string; locationName?: string };
          return { id: item.id, title: data.title || data.locationName || 'Event' };
        }));
      },
      () => setEvents([])
    );
    return () => {
      unsubReceipts();
      unsubEvents();
    };
  }, [userId, isAdmin]);

  const eventMap = useMemo(() => new Map(events.map(event => [event.id, event])), [events]);

  const resetReview = () => {
    setPages([]);
    setReviewing(false);
    setRecognizing(false);
    setBanner(null);
    setType(null);
    setEventId(null);
    setMerchant('');
    setDateText('');
    setAmountText('');
    setInvoiceNumber('');
    setNote('');
    setVat([]);
    setRecognition(null);
    setPreviewIndex(0);
    touched.current = { ...EMPTY_TOUCH };
  };

  const recognizePages = async (nextPages: LocalReceiptPage[]) => {
    const images = nextPages.filter(page => isImagePage(page) && !isPdfPage(page));
    if (!images.length) {
      const failed = { ...emptyCandidate('failed'), provider: 'none' };
      setRecognition(failed);
      setBanner('This document was not read automatically. Enter the details below.');
      return;
    }
    setRecognizing(true);
    setBanner('Reading receipt…');
    const result = await recognizeReceiptImages(images.map(page => page.localUri));
    const next = applyRecognitionSuggestion(draftRef.current, touched.current, result, formatReceiptDate, formatAmountInput);
    setMerchant(next.merchant);
    setDateText(next.dateText);
    setAmountText(next.amountText);
    setInvoiceNumber(next.invoiceNumber);
    setVat(next.vat.map(item => ({ ratePercent: item.ratePercent, taxText: item.taxCents == null ? '' : formatAmountInput(item.taxCents) })));
    setRecognition(result);
    setBanner(
      result.status === 'failed'
        ? 'Recognition failed. Enter the details and save the receipt.'
        : result.status === 'needs_review' || result.totalCents == null
          ? 'Check the amount before saving. Nothing was filled in where it was unclear.'
          : 'Check the recognized details, then choose Versorgung or Firma.'
    );
    setRecognizing(false);
  };

  const openReview = async (nextPages: LocalReceiptPage[], mode: 'replace' | 'append') => {
    const combined = mode === 'append' ? [...pages, ...nextPages] : nextPages;
    if (mode === 'replace') {
      touched.current = { ...EMPTY_TOUCH };
      setMerchant('');
      setDateText('');
      setAmountText('');
      setInvoiceNumber('');
      setVat([]);
      setNote('');
      setType(null);
      setEventId(null);
      draftRef.current = { merchant: '', dateText: '', amountText: '', invoiceNumber: '', vat: [] };
    }
    setPages(combined);
    setChooser(false);
    setReviewing(true);
    await recognizePages(combined);
  };

  const runCapture = async (action: 'scan' | 'photo' | 'document' | 'add' | 'retake') => {
    try {
      if (action === 'scan' || action === 'retake' || action === 'add') {
        const scanned = await captureScannedReceipt();
        if (!scanned) return;
        await openReview(scanned, action === 'add' ? 'append' : 'replace');
        return;
      }
      const page = action === 'photo' ? await captureReceiptPhoto() : await captureReceiptDocument();
      if (!page) return;
      await openReview([page], 'replace');
    } catch (error: any) {
      Alert.alert('Could not add receipt', error?.message || 'Please try again.');
    }
  };

  const adjustPage = async (index: number) => {
    const page = pages[index];
    if (!page || !isImagePage(page)) return;
    try {
      const cropped = await adjustReceiptCrop(page);
      if (!cropped) return;
      const next = pages.map((item, itemIndex) => (itemIndex === index ? cropped : item));
      setPages(next);
      await recognizePages(next);
    } catch (error: any) {
      Alert.alert('Could not adjust crop', error?.message || 'Please try again.');
    }
  };

  const save = async () => {
    const receiptDate = parseReceiptDate(dateText);
    const amountCents = amountText.trim() ? parseMoneyToCents(amountText) : null;
    if (vat.some(item => item.taxText.trim() && parseMoneyToCents(item.taxText) == null)) {
      Alert.alert('Check the receipt', 'Enter a valid VAT amount or leave it blank.');
      return;
    }
    const message = validateMemberReceipt({ type, eventId, receiptDate, amountCents });
    if (message) {
      Alert.alert('Check the receipt', amountText.trim() && amountCents == null ? 'Enter a valid amount.' : message);
      return;
    }
    if (!type || amountCents == null || !receiptDate) return;
    setSaving(true);
    try {
      await submitReceipt({
        pages,
        type,
        eventId,
        merchant,
        receiptDate,
        amountCents,
        invoiceNumber,
        note,
        vatBreakdown: vat.flatMap(item => {
          const taxCents = item.taxText.trim() ? parseMoneyToCents(item.taxText) : null;
          if (item.taxText.trim() && taxCents == null) return [];
          return [{ ratePercent: item.ratePercent, taxCents }];
        }),
        recognition,
      });
      Alert.alert('Receipt saved', 'The receipt and the details you confirmed have been saved.');
      resetReview();
    } catch (error: any) {
      Alert.alert('Could not save receipt', error?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const amountLabel = parseMoneyToCents(amountText);

  return (
    <PizzaFireScreen>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>‹ Documents</Text></TouchableOpacity>
        <Text style={styles.title}>Receipts</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, formColumnFrame(layout)]}>
        <Text style={styles.subtitle}>Scan a Versorgung or Firma receipt, check the amount, then save.</Text>
        <TouchableOpacity style={styles.scanButton} onPress={() => setChooser(true)}>
          <Text style={styles.scanText}>+ Receipt</Text>
        </TouchableOpacity>
        <Text style={styles.section}>MY RECEIPTS</Text>
        {receipts.length === 0 ? (
          <View style={styles.card}><Text style={styles.muted}>No receipts submitted yet.</Text></View>
        ) : receipts.map(item => (
          <View key={item.id} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.cardTitle}>{item.merchant || item.category || 'Receipt'}</Text>
              <Text style={styles.amount}>{formatReceiptAmount(item.amountCents)}</Text>
            </View>
            <Text style={styles.muted}>
              {item.receiptDate ? formatReceiptDate(item.receiptDate) : 'Date not set'} · {item.type ? receiptTypeLabel(item.type) : item.category || 'No type'}
            </Text>
            {item.eventId ? <Text style={styles.association}>{resolveEventName(item.eventId, eventMap)}</Text> : item.legacyAssociationLabel ? <Text style={styles.association}>{item.legacyAssociationLabel}</Text> : null}
          </View>
        ))}
      </ScrollView>

      <Modal visible={chooser} transparent animationType="fade" onRequestClose={() => setChooser(false)}>
        <View style={styles.selectorBack}>
          <View style={styles.selectorCard}>
            <Text style={styles.modalTitle}>Add receipt</Text>
            <TouchableOpacity style={styles.primary} onPress={() => void runCapture('scan')}><Text style={styles.primaryText}>Scan receipt</Text></TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => void runCapture('photo')}><Text style={styles.secondaryText}>Choose photo</Text></TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => void runCapture('document')}><Text style={styles.secondaryText}>Choose document/PDF</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setChooser(false)}><Text style={styles.cancel}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={reviewing} transparent animationType="slide" onRequestClose={resetReview}>
        <KeyboardAvoidingView style={styles.modalBack} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.modal}>
              <Text style={styles.modalTitle}>Review receipt</Text>
              {banner ? <Text style={styles.banner}>{recognizing ? 'Reading receipt…' : banner}</Text> : null}
              <ReceiptDocumentPreview pages={pages.map(page => ({ uri: page.localUri, mimeType: page.mimeType, fileName: page.fileName }))} onPageChange={setPreviewIndex} />
              <View style={styles.actions}>
                <TouchableOpacity style={styles.secondary} onPress={() => void runCapture('retake')}><Text style={styles.secondaryText}>Retake</Text></TouchableOpacity>
                {pages[previewIndex] && isImagePage(pages[previewIndex]) ? <TouchableOpacity style={styles.secondary} onPress={() => void adjustPage(previewIndex)}><Text style={styles.secondaryText}>Adjust crop</Text></TouchableOpacity> : null}
              </View>
              {!pages.some(isPdfPage) ? (
                <TouchableOpacity style={styles.secondary} onPress={() => void runCapture('add')}><Text style={styles.secondaryText}>+ Add page</Text></TouchableOpacity>
              ) : null}

              <Text style={styles.label}>Type</Text>
              <View style={styles.typeRow}>
                {(['versorgung', 'firma'] as ReceiptType[]).map(option => (
                  <TouchableOpacity key={option} style={[styles.typeButton, type === option && styles.typeButtonOn]} onPress={() => setType(option)}>
                    <Text style={[styles.typeText, type === option && styles.typeTextOn]}>{receiptTypeLabel(option)}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Event</Text>
              <TouchableOpacity style={styles.dropdown} onPress={() => setEventPicker(true)}>
                <Text style={styles.dropdownText}>{resolveEventName(eventId, eventMap)}</Text>
                <Text style={styles.dropdownArrow}>⌄</Text>
              </TouchableOpacity>

              <Text style={styles.label}>Merchant</Text>
              <TextInput style={styles.input} value={merchant} onChangeText={value => { touched.current.merchant = true; setMerchant(value); }} placeholder="Merchant" placeholderTextColor="#9E8875" />
              <Text style={styles.label}>Date</Text>
              <TextInput style={styles.input} value={dateText} onChangeText={value => { touched.current.date = true; setDateText(value); }} placeholder="DD.MM.YYYY" placeholderTextColor="#9E8875" />
              <Text style={styles.label}>Amount</Text>
              <TextInput style={styles.input} value={amountText} onChangeText={value => { touched.current.amount = true; setAmountText(value); }} placeholder="0,00" keyboardType="decimal-pad" placeholderTextColor="#9E8875" />
              {vat.length ? (
                <>
                  <Text style={styles.label}>VAT</Text>
                  {vat.map((item, index) => (
                    <View key={`${item.ratePercent}-${index}`} style={styles.vatRow}>
                      <Text style={styles.vatRate}>{item.ratePercent}%</Text>
                      <TextInput
                        style={[styles.input, styles.vatInput]}
                        value={item.taxText}
                        onChangeText={value => {
                          touched.current.vat = true;
                          setVat(current => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, taxText: value } : entry));
                        }}
                        placeholder="Tax"
                        keyboardType="decimal-pad"
                        placeholderTextColor="#9E8875"
                      />
                      <TouchableOpacity onPress={() => { touched.current.vat = true; setVat(current => current.filter((_, entryIndex) => entryIndex !== index)); }}>
                        <Text style={styles.remove}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </>
              ) : null}
              <Text style={styles.label}>Receipt / invoice number</Text>
              <TextInput style={styles.input} value={invoiceNumber} onChangeText={value => { touched.current.invoice = true; setInvoiceNumber(value); }} placeholder="Optional" placeholderTextColor="#9E8875" />
              <Text style={styles.label}>Note</Text>
              <TextInput style={[styles.input, styles.note]} value={note} onChangeText={setNote} placeholder="Optional" multiline placeholderTextColor="#9E8875" />
              <TouchableOpacity style={[styles.primary, saving && styles.disabled]} onPress={() => void save()} disabled={saving}>
                {saving ? <ActivityIndicator color={PIZZA_FIRE.charcoal} /> : <Text style={styles.primaryText}>Save receipt{amountLabel != null ? ` · ${formatReceiptAmount(amountLabel)}` : ''}</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={resetReview}><Text style={styles.cancel}>Cancel</Text></TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={eventPicker} transparent animationType="fade" onRequestClose={() => setEventPicker(false)}>
        <View style={styles.selectorBack}>
          <View style={styles.selectorCard}>
            <Text style={styles.modalTitle}>Event</Text>
            <ScrollView>
              <TouchableOpacity style={styles.option} onPress={() => { setEventId(null); setEventPicker(false); }}>
                <Text style={styles.optionText}>General / No event</Text>
                {!eventId ? <Text style={styles.check}>✓</Text> : null}
              </TouchableOpacity>
              {events.map(event => (
                <TouchableOpacity key={event.id} style={styles.option} onPress={() => { setEventId(event.id); setEventPicker(false); }}>
                  <Text style={styles.optionText}>{event.title}</Text>
                  {eventId === event.id ? <Text style={styles.check}>✓</Text> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setEventPicker(false)}><Text style={styles.cancel}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </PizzaFireScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18, borderBottomWidth: 1, borderBottomColor: PIZZA_FIRE.divider },
  back: { color: PIZZA_FIRE.gold, fontWeight: '800' },
  title: { color: PIZZA_FIRE.textPrimary, fontWeight: '900', fontSize: 20 },
  headerSpacer: { width: 76 },
  content: { padding: 18, gap: 14, paddingBottom: 44 },
  subtitle: { color: PIZZA_FIRE.textSecondary, fontSize: 14 },
  scanButton: { backgroundColor: PIZZA_FIRE.accent, borderRadius: 14, padding: 17, alignItems: 'center' },
  scanText: { color: PIZZA_FIRE.charcoal, fontSize: 17, fontWeight: '900' },
  section: { color: '#D8B07A', fontSize: 12, fontWeight: '900', letterSpacing: 1, marginTop: 8 },
  card: { backgroundColor: PIZZA_FIRE.surface, borderColor: PIZZA_FIRE.qlBorder, borderWidth: 1, borderRadius: 16, padding: 15, gap: 5 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  cardTitle: { flex: 1, color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '800' },
  amount: { color: PIZZA_FIRE.gold, fontSize: 16, fontWeight: '900' },
  muted: { color: PIZZA_FIRE.textSecondary, fontSize: 13 },
  association: { color: '#9BD1A5', fontSize: 13, fontWeight: '700' },
  modalBack: { flex: 1, backgroundColor: 'rgba(0,0,0,.78)' },
  modalScroll: { flexGrow: 1, justifyContent: 'flex-end' },
  modal: { backgroundColor: '#211915', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12, borderWidth: 1, borderColor: '#5A4030' },
  modalTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 23, fontWeight: '900' },
  banner: { color: PIZZA_FIRE.gold, fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10 },
  primary: { backgroundColor: PIZZA_FIRE.accent, borderRadius: 12, padding: 15, alignItems: 'center' },
  primaryText: { color: PIZZA_FIRE.charcoal, fontWeight: '900' },
  secondary: { borderColor: PIZZA_FIRE.gold, borderWidth: 1, borderRadius: 12, padding: 15, alignItems: 'center', flex: 1 },
  secondaryText: { color: PIZZA_FIRE.gold, fontWeight: '900' },
  cancel: { color: PIZZA_FIRE.textSecondary, textAlign: 'center', fontWeight: '800', padding: 8 },
  input: { backgroundColor: '#17120F', borderWidth: 1, borderColor: PIZZA_FIRE.qlBorder, borderRadius: 10, color: PIZZA_FIRE.textPrimary, padding: 12 },
  note: { minHeight: 70, textAlignVertical: 'top' },
  label: { color: PIZZA_FIRE.textSecondary, fontWeight: '800', fontSize: 13 },
  dropdown: { backgroundColor: '#17120F', borderWidth: 1, borderColor: PIZZA_FIRE.qlBorder, borderRadius: 10, padding: 12, flexDirection: 'row', justifyContent: 'space-between' },
  dropdownText: { color: PIZZA_FIRE.textPrimary, fontWeight: '700', flex: 1 },
  dropdownArrow: { color: PIZZA_FIRE.gold, fontSize: 18, fontWeight: '900' },
  typeRow: { flexDirection: 'row', gap: 10 },
  typeButton: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: PIZZA_FIRE.qlBorder, padding: 14, alignItems: 'center' },
  typeButtonOn: { backgroundColor: PIZZA_FIRE.accent, borderColor: PIZZA_FIRE.accent },
  typeText: { color: PIZZA_FIRE.textPrimary, fontWeight: '900' },
  typeTextOn: { color: PIZZA_FIRE.charcoal },
  vatRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vatRate: { color: PIZZA_FIRE.textPrimary, fontWeight: '800', width: 48 },
  vatInput: { flex: 1 },
  remove: { color: PIZZA_FIRE.gold, fontWeight: '800' },
  selectorBack: { flex: 1, backgroundColor: 'rgba(0,0,0,.72)', justifyContent: 'center', padding: 24 },
  selectorCard: { backgroundColor: '#211915', borderRadius: 18, padding: 18, maxHeight: '75%', gap: 12, borderWidth: 1, borderColor: '#5A4030' },
  option: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: PIZZA_FIRE.qlBorder, flexDirection: 'row', justifyContent: 'space-between' },
  optionText: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '700', flex: 1 },
  check: { color: PIZZA_FIRE.accent, fontSize: 18, fontWeight: '900' },
  disabled: { opacity: 0.55 },
});
