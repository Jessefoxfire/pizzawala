import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { collection, getFirestore, onSnapshot, query, where } from '@react-native-firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import PizzaFireScreen from '../components/PizzaFireScreen';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { auth } from '../services/firebase';
import { RECEIPT_CATEGORIES, submitReceipt, type ReceiptCategory } from '../services/receipts';
import { ensureImagePickerPermission } from '../utils/imagePickerPermissions';
import { pickPreparedHygienePhoto, type PreparedUploadImage } from '../utils/prepareUploadImage';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';

type Props = NativeStackScreenProps<RootStackParamList, 'ReceiptsExpenses'>;
type Association = { id: string; label: string; kind: 'worksite' | 'event' };

export default function ReceiptsExpensesScreen({ navigation }: Props) {
  const userId = auth.currentUser?.uid || null;
  const [receipts, setReceipts] = useState<any[]>([]);
  const [events, setEvents] = useState<Association[]>([]);
  const [worksites, setWorksites] = useState<Association[]>([]);
  const [photo, setPhoto] = useState<PreparedUploadImage | null>(null);
  const [stage, setStage] = useState<'none' | 'preview' | 'form'>('none');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ReceiptCategory>('Other');
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [association, setAssociation] = useState<Association | null>(null);
  const [selector, setSelector] = useState<'category' | 'association' | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return undefined;
    const fs = getFirestore();
    const unsubReceipts = onSnapshot(query(collection(fs, 'receipts'), where('userId', '==', userId)), snap => {
      setReceipts(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => String(b.submittedAtIso || '').localeCompare(String(a.submittedAtIso || ''))));
    });
    const unsubEvents = onSnapshot(collection(fs, 'events'), snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as any)).map(event => ({ id: event.id, label: event.title || event.locationName || 'Event', kind: 'event' as const }));
      setEvents(items);
    });
    const unsubWorksites = onSnapshot(collection(fs, 'geofences'), snap => {
      setWorksites(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })).filter(item => item.active !== false).map(item => ({ id: item.id, label: item.name || item.title || 'Worksite', kind: 'worksite' as const })));
    });
    return () => { unsubReceipts(); unsubEvents(); unsubWorksites(); };
  }, [userId]);

  const associations = useMemo(() => [...worksites, ...events], [worksites, events]);

  const takePhoto = async () => {
    try {
      if (!(await ensureImagePickerPermission('camera'))) throw new Error('Camera permission is required to scan a receipt.');
      const next = await pickPreparedHygienePhoto('camera');
      if (next) { setPhoto(next); setStage('preview'); }
    } catch (error: any) { Alert.alert('Could not open camera', error?.message || 'Please try again.'); }
  };
  const reset = () => { setPhoto(null); setStage('none'); setAmount(''); setMerchant(''); setNote(''); setAssociation(null); setDate(new Date().toISOString().slice(0, 10)); setCategory('Other'); };
  const save = async () => {
    if (!photo) return;
    setSaving(true);
    try { await submitReceipt({ localUri: photo.localUri, fileName: photo.originalFileName, mimeType: photo.mimeType, receiptDate: date, amount, category, merchant, note, association }); Alert.alert('Receipt submitted', 'Your receipt has been saved.'); reset(); }
    catch (error: any) { Alert.alert('Could not submit receipt', error?.message || 'Please try again.'); }
    finally { setSaving(false); }
  };
  const amountLabel = useMemo(() => amount ? `€${Number(amount.replace(',', '.')).toFixed(2)}` : '', [amount]);

  return <PizzaFireScreen><View style={styles.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>‹ Documents</Text></TouchableOpacity><Text style={styles.title}>Receipts & Expenses</Text><View style={{ width: 76 }} /></View>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.subtitle}>Submit business expenses from travel and work.</Text>
      <TouchableOpacity style={styles.scanButton} onPress={() => void takePhoto()}><Text style={styles.scanText}>+ Scan receipt</Text></TouchableOpacity>
      <Text style={styles.section}>MY SUBMITTED RECEIPTS</Text>
      {receipts.length === 0 ? <View style={styles.card}><Text style={styles.muted}>No receipts submitted yet.</Text></View> : receipts.map(item => <View key={item.id} style={styles.card}><View style={styles.row}><Text style={styles.cardTitle}>{item.merchant || item.category || 'Receipt'}</Text><Text style={styles.amount}>€{Number(item.amount || 0).toFixed(2)}</Text></View><Text style={styles.muted}>{item.receiptDate || 'Date not set'} · {item.category || 'Other'}</Text>{item.associationLabel ? <Text style={styles.association}>{item.associationLabel}</Text> : null}</View>)}
    </ScrollView>
    <Modal visible={stage !== 'none'} transparent animationType="slide" onRequestClose={reset}><KeyboardAvoidingView style={styles.modalBack} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled"><View style={styles.modal}>
      {stage === 'preview' ? <><Text style={styles.modalTitle}>Receipt preview</Text>{photo ? <Image source={{ uri: photo.localUri }} style={styles.preview} resizeMode="contain" /> : null}<View style={styles.actions}><TouchableOpacity style={styles.secondary} onPress={() => void takePhoto()}><Text style={styles.secondaryText}>Retake</Text></TouchableOpacity><TouchableOpacity style={styles.primary} onPress={() => setStage('form')}><Text style={styles.primaryText}>Use receipt</Text></TouchableOpacity></View><TouchableOpacity onPress={reset}><Text style={styles.cancel}>Cancel</Text></TouchableOpacity></> : <><Text style={styles.modalTitle}>Receipt details</Text>{photo ? <Image source={{ uri: photo.localUri }} style={styles.formPreview} /> : null}<TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="Receipt date (YYYY-MM-DD)" placeholderTextColor="#9E8875"/><TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder="Amount (€)" keyboardType="decimal-pad" placeholderTextColor="#9E8875"/><TextInput style={styles.input} value={merchant} onChangeText={setMerchant} placeholder="Merchant / description" placeholderTextColor="#9E8875"/>
      <Text style={styles.label}>Category</Text><TouchableOpacity style={styles.dropdown} onPress={() => setSelector('category')}><Text style={styles.dropdownText}>{category}</Text><Text style={styles.dropdownArrow}>⌄</Text></TouchableOpacity>
      <Text style={styles.label}>Worksite / event (optional)</Text><TouchableOpacity style={styles.dropdown} onPress={() => setSelector('association')}><Text style={styles.dropdownText}>{association?.label || 'None'}</Text><Text style={styles.dropdownArrow}>⌄</Text></TouchableOpacity><TextInput style={[styles.input, styles.note]} value={note} onChangeText={setNote} placeholder="Optional note" multiline placeholderTextColor="#9E8875"/>
      <TouchableOpacity style={[styles.primary, saving && styles.disabled]} onPress={() => void save()} disabled={saving}>{saving ? <ActivityIndicator color={PIZZA_FIRE.charcoal} /> : <Text style={styles.primaryText}>Save receipt{amountLabel ? ` · ${amountLabel}` : ''}</Text>}</TouchableOpacity><TouchableOpacity onPress={reset}><Text style={styles.cancel}>Cancel</Text></TouchableOpacity></>}
    </View></ScrollView></KeyboardAvoidingView></Modal>
    <Modal visible={!!selector} transparent animationType="fade" onRequestClose={() => setSelector(null)}><View style={styles.selectorBack}><View style={styles.selectorCard}><Text style={styles.modalTitle}>{selector === 'category' ? 'Category' : 'Worksite / event'}</Text><ScrollView>{selector === 'category' ? RECEIPT_CATEGORIES.map(item => <TouchableOpacity key={item} style={styles.option} onPress={() => { setCategory(item); setSelector(null); }}><Text style={styles.optionText}>{item}</Text>{category === item ? <Text style={styles.check}>✓</Text> : null}</TouchableOpacity>) : <><TouchableOpacity style={styles.option} onPress={() => { setAssociation(null); setSelector(null); }}><Text style={styles.optionText}>None</Text>{!association ? <Text style={styles.check}>✓</Text> : null}</TouchableOpacity>{associations.map(item => <TouchableOpacity key={`${item.kind}-${item.id}`} style={styles.option} onPress={() => { setAssociation(item); setSelector(null); }}><Text style={styles.optionText}>{item.label}</Text>{association?.id === item.id && association.kind === item.kind ? <Text style={styles.check}>✓</Text> : null}</TouchableOpacity>)}</>}</ScrollView><TouchableOpacity onPress={() => setSelector(null)}><Text style={styles.cancel}>Cancel</Text></TouchableOpacity></View></View></Modal>
  </PizzaFireScreen>;
}

const styles = StyleSheet.create({ header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',padding:18,borderBottomWidth:1,borderBottomColor:PIZZA_FIRE.divider},back:{color:PIZZA_FIRE.gold,fontWeight:'800'},title:{color:PIZZA_FIRE.textPrimary,fontWeight:'900',fontSize:20},content:{padding:18,gap:14,paddingBottom:44},subtitle:{color:PIZZA_FIRE.textSecondary,fontSize:14},scanButton:{backgroundColor:PIZZA_FIRE.accent,borderRadius:14,padding:17,alignItems:'center'},scanText:{color:PIZZA_FIRE.charcoal,fontSize:17,fontWeight:'900'},section:{color:'#D8B07A',fontSize:12,fontWeight:'900',letterSpacing:1,marginTop:8},card:{backgroundColor:PIZZA_FIRE.surface,borderColor:PIZZA_FIRE.qlBorder,borderWidth:1,borderRadius:16,padding:15,gap:5},row:{flexDirection:'row',justifyContent:'space-between',gap:10},cardTitle:{flex:1,color:PIZZA_FIRE.textPrimary,fontSize:16,fontWeight:'800'},amount:{color:PIZZA_FIRE.gold,fontSize:16,fontWeight:'900'},muted:{color:PIZZA_FIRE.textSecondary,fontSize:13},association:{color:'#9BD1A5',fontSize:13,fontWeight:'700'},modalBack:{flex:1,backgroundColor:'rgba(0,0,0,.78)'},modalScroll:{flexGrow:1,justifyContent:'flex-end'},modal:{backgroundColor:'#211915',borderTopLeftRadius:24,borderTopRightRadius:24,padding:20,gap:12,borderWidth:1,borderColor:'#5A4030'},modalTitle:{color:PIZZA_FIRE.textPrimary,fontSize:23,fontWeight:'900'},preview:{height:330,width:'100%',backgroundColor:'#17120F',borderRadius:12},formPreview:{height:105,width:105,borderRadius:10,alignSelf:'center'},actions:{flexDirection:'row',gap:10},primary:{backgroundColor:PIZZA_FIRE.accent,borderRadius:12,padding:15,alignItems:'center',flex:1},primaryText:{color:PIZZA_FIRE.charcoal,fontWeight:'900'},secondary:{borderColor:PIZZA_FIRE.gold,borderWidth:1,borderRadius:12,padding:15,alignItems:'center',flex:1},secondaryText:{color:PIZZA_FIRE.gold,fontWeight:'900'},cancel:{color:PIZZA_FIRE.textSecondary,textAlign:'center',fontWeight:'800',padding:8},input:{backgroundColor:'#17120F',borderWidth:1,borderColor:PIZZA_FIRE.qlBorder,borderRadius:10,color:PIZZA_FIRE.textPrimary,padding:12},note:{minHeight:70,textAlignVertical:'top'},label:{color:PIZZA_FIRE.textSecondary,fontWeight:'800',fontSize:13},dropdown:{backgroundColor:'#17120F',borderWidth:1,borderColor:PIZZA_FIRE.qlBorder,borderRadius:10,padding:12,flexDirection:'row',justifyContent:'space-between'},dropdownText:{color:PIZZA_FIRE.textPrimary,fontWeight:'700'},dropdownArrow:{color:PIZZA_FIRE.gold,fontSize:18,fontWeight:'900'},selectorBack:{flex:1,backgroundColor:'rgba(0,0,0,.72)',justifyContent:'center',padding:24},selectorCard:{backgroundColor:'#211915',borderRadius:18,padding:18,maxHeight:'75%',borderWidth:1,borderColor:'#5A4030'},option:{paddingVertical:15,borderBottomWidth:1,borderBottomColor:PIZZA_FIRE.qlBorder,flexDirection:'row',justifyContent:'space-between'},optionText:{color:PIZZA_FIRE.textPrimary,fontSize:16,fontWeight:'700'},check:{color:PIZZA_FIRE.accent,fontSize:18,fontWeight:'900'},disabled:{opacity:.55} });
