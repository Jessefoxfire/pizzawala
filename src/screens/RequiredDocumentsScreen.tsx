import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  query,
  where,
} from '@react-native-firebase/firestore';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { auth } from '../services/firebase';
import { formatDateTime } from '../services/hygiene';
import { useHygieneCredentialUpload } from '../hooks/useHygieneCredentialUpload';
import {
  CHECKLIST_HELP,
  GERMAN_COMPLIANCE_INTRO,
  getMissingRequiredDocuments,
  getRequiredDocumentTypesForUser,
} from '../constants/germanEmployeeCompliance';

type Props = NativeStackScreenProps<RootStackParamList, 'RequiredDocuments'>;

type UserProfile = {
  name?: string;
  email?: string;
  requiredDocuments?: string[];
};

export default function RequiredDocumentsScreen({ navigation }: Props) {
  const { pickAndUpload, nameConfirmModal } = useHygieneCredentialUpload();
  const userId = auth.currentUser?.uid || null;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [credentials, setCredentials] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setCredentials([]);
      setLoading(false);
      return;
    }

    const fs = getFirestore();
    const unsubProfile = onSnapshot(doc(fs, 'users', userId), snap => {
      setProfile(snap.exists() ? (snap.data() as UserProfile) : null);
      setLoading(false);
    });

    const credentialQuery = query(
      collection(fs, 'hygieneCredentials'),
      where('employeeUid', '==', userId)
    );
    const unsubCredentials = onSnapshot(credentialQuery, snap => {
      const items = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
      items.sort((a: any, b: any) => {
        const aMs = new Date(a.uploadedAtIso || 0).getTime();
        const bMs = new Date(b.uploadedAtIso || 0).getTime();
        return bMs - aMs;
      });
      setCredentials(items);
    });

    return () => {
      unsubProfile();
      unsubCredentials();
    };
  }, [userId]);

  const requiredDocuments = useMemo(
    () => getRequiredDocumentTypesForUser(profile?.requiredDocuments),
    [profile?.requiredDocuments]
  );

  const docsWithUploads = useMemo(
    () =>
      requiredDocuments.map(docType => ({
        docType,
        uploads: credentials.filter(item => String(item.requiredDocumentType || '').trim() === docType),
      })),
    [credentials, requiredDocuments]
  );

  const missingDocuments = useMemo(
    () => getMissingRequiredDocuments(requiredDocuments, credentials),
    [requiredDocuments, credentials]
  );

  const missingCount = missingDocuments.length;

  const handleUploadRequiredDoc = async (docType: string) => {
    if (!userId || uploadingDocType) return;
    setUploadingDocType(docType);
    try {
      const uploaded = await pickAndUpload(undefined, {
        requiredDocumentType: docType,
        documentCategory: 'required_user_document',
      });
      if (!uploaded) return;
      Alert.alert('Uploaded', `${docType} uploaded successfully.`);
    } catch (error: any) {
      Alert.alert('Upload failed', error?.message || 'Could not upload document.');
    } finally {
      setUploadingDocType(null);
    }
  };

  return (
    <>
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Home</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Required Documents</Text>
        <View style={{ width: 56 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>DOCUMENT UPLOADS</Text>
          <Text style={styles.heroTitle}>
            {missingCount > 0
              ? `You still need to upload ${missingCount} document${missingCount === 1 ? '' : 's'}`
              : 'All required documents are on file'}
          </Text>
          <Text style={styles.heroText}>{GERMAN_COMPLIANCE_INTRO}</Text>
          <Text style={styles.heroText}>
            Use clear lighting, place the document on a flat surface, avoid shadows, and make sure every corner is visible before taking the photo.
          </Text>
        </View>

        <View style={styles.tipCard}>
          <Text style={styles.tipTitle}>How to capture documents well</Text>
          <Text style={styles.tipText}>1. Use bright, even lighting.</Text>
          <Text style={styles.tipText}>2. Keep the full document inside the frame.</Text>
          <Text style={styles.tipText}>3. Avoid glare, blur, and folded corners.</Text>
          <Text style={styles.tipText}>4. If the text is small, move closer before uploading.</Text>
        </View>

        <View style={styles.progressCard}>
          <Text style={styles.progressLabel}>Status</Text>
          <Text style={styles.progressValue}>
            {requiredDocuments.length - missingCount}/{requiredDocuments.length} required documents uploaded
          </Text>
        </View>

        {loading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color="#E2A14A" />
            <Text style={styles.loadingText}>Loading your document requirements…</Text>
          </View>
        ) : docsWithUploads.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No required documents have been assigned to you yet.</Text>
          </View>
        ) : (
          docsWithUploads.map(item => {
            const complete = item.uploads.length > 0;
            const latestUpload = item.uploads[0];
            const busy = uploadingDocType === item.docType;
            const isChecklist = item.docType === 'Signed checklist';
            return (
              <View key={item.docType} style={[styles.docCard, complete && styles.docCardComplete]}>
                <View style={styles.docHeader}>
                  <View style={styles.docHeaderText}>
                    <View style={styles.docTitleRow}>
                      <Text style={styles.docTitle}>{item.docType}</Text>
                      {isChecklist ? (
                        <TouchableOpacity
                          style={styles.helpButton}
                          onPress={() => Alert.alert('Signed checklist', CHECKLIST_HELP)}
                        >
                          <Text style={styles.helpButtonText}>?</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <Text style={[styles.docStatus, complete ? styles.docStatusComplete : styles.docStatusMissing]}>
                      {complete ? 'On file' : 'Missing'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.uploadButton, busy && styles.uploadButtonDisabled]}
                    onPress={() => void handleUploadRequiredDoc(item.docType)}
                    disabled={busy}
                  >
                    {busy ? (
                      <ActivityIndicator color="#F8F1E8" />
                    ) : (
                      <Text style={styles.uploadButtonText}>Upload / Photograph</Text>
                    )}
                  </TouchableOpacity>
                </View>

                {latestUpload ? (
                  <View style={styles.uploadMetaCard}>
                    <Text style={styles.uploadMetaText}>Latest file: {latestUpload.fileName || 'Document'}</Text>
                    <Text style={styles.uploadMetaText}>
                      Uploaded: {formatDateTime(latestUpload.uploadedAt, latestUpload.uploadedAtIso)}
                    </Text>
                    {latestUpload.downloadUrl ? (
                      <TouchableOpacity onPress={() => void Linking.openURL(String(latestUpload.downloadUrl))}>
                        <Text style={styles.linkText}>Open uploaded file</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : (
                  <Text style={styles.missingHelp}>
                    This document is required. Tap the button above to choose a file from your device or take a photo now.
                  </Text>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
    {nameConfirmModal}
    </>
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
  heroCard: {
    backgroundColor: '#2B2019',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#4B382B',
  },
  heroEyebrow: { color: '#D8B07A', fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  heroTitle: { color: '#FFF6EC', fontSize: 28, fontWeight: '900', lineHeight: 32, marginBottom: 8 },
  heroText: { color: '#D6C0AC', fontSize: 14, lineHeight: 20 },
  tipCard: {
    backgroundColor: '#211915',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#3C2E25',
  },
  tipTitle: { color: '#F8F1E8', fontSize: 18, fontWeight: '800', marginBottom: 8 },
  tipText: { color: '#CBB8A7', fontSize: 13, lineHeight: 19, marginBottom: 4 },
  progressCard: {
    backgroundColor: '#221A15',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#3C2E25',
  },
  progressLabel: {
    color: '#C7AA86',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  progressValue: { color: '#FFF7ED', fontSize: 22, fontWeight: '900' },
  loadingCard: {
    backgroundColor: '#221A15',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#3C2E25',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: { color: '#D8C4B2', fontSize: 13, fontWeight: '700' },
  emptyCard: {
    backgroundColor: '#211915',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#3C2E25',
  },
  emptyText: { color: '#BFA690', fontSize: 14 },
  docCard: {
    backgroundColor: '#211915',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#5A4030',
  },
  docCardComplete: {
    borderColor: '#45664A',
  },
  docHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  docHeaderText: { flex: 1 },
  docTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  docTitle: { color: '#F8F1E8', fontSize: 18, fontWeight: '800', flex: 1 },
  helpButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2A14A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpButtonText: { color: '#E2A14A', fontWeight: '900', fontSize: 12 },
  docStatus: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7 },
  docStatusComplete: { color: '#9BD1A5' },
  docStatusMissing: { color: '#E2A14A' },
  uploadButton: {
    backgroundColor: '#E2A14A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadButtonDisabled: { opacity: 0.5 },
  uploadButtonText: { color: '#24160D', fontSize: 13, fontWeight: '900' },
  uploadMetaCard: {
    marginTop: 12,
    backgroundColor: '#17120F',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#3B2D24',
  },
  uploadMetaText: { color: '#E6D6C8', fontSize: 13, lineHeight: 18, marginBottom: 4 },
  linkText: { color: '#E2A14A', fontSize: 13, fontWeight: '800', marginTop: 4 },
  missingHelp: { color: '#CBB8A7', fontSize: 13, lineHeight: 19, marginTop: 12 },
});
