import React, { useState } from 'react';
import { Image, Linking, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';

export type ReceiptPreviewPage = {
  uri: string;
  mimeType: string;
  fileName?: string;
};

function isPdf(page: ReceiptPreviewPage) {
  return page.mimeType === 'application/pdf' || /\.pdf$/i.test(page.fileName || '');
}

export default function ReceiptDocumentPreview({
  pages,
  onPageChange,
}: {
  pages: ReceiptPreviewPage[];
  onPageChange?: (index: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const [full, setFull] = useState(false);
  const page = pages[Math.min(index, Math.max(pages.length - 1, 0))];
  if (!page) return null;
  const pdf = isPdf(page);

  return (
    <View style={styles.wrap}>
      <TouchableOpacity onPress={() => (pdf ? void Linking.openURL(page.uri) : setFull(true))} activeOpacity={0.85}>
        {pdf ? (
          <View style={styles.pdf}>
            <Text style={styles.pdfTitle}>PDF receipt</Text>
            <Text style={styles.pdfSub}>Tap to open the original document</Text>
          </View>
        ) : (
          <Image source={{ uri: page.uri }} style={styles.preview} resizeMode="contain" />
        )}
      </TouchableOpacity>
      {pages.length > 1 ? (
        <View style={styles.pager}>
          <TouchableOpacity disabled={index === 0} onPress={() => { const next = Math.max(0, index - 1); setIndex(next); onPageChange?.(next); }}>
            <Text style={[styles.pagerText, index === 0 && styles.disabled]}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.pageLabel}>Page {index + 1} of {pages.length}</Text>
          <TouchableOpacity disabled={index >= pages.length - 1} onPress={() => { const next = Math.min(pages.length - 1, index + 1); setIndex(next); onPageChange?.(next); }}>
            <Text style={[styles.pagerText, index >= pages.length - 1 && styles.disabled]}>›</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <Modal visible={full} transparent animationType="fade" onRequestClose={() => setFull(false)}>
        <View style={styles.fullBack}>
          <ScrollView maximumZoomScale={4} minimumZoomScale={1} contentContainerStyle={styles.fullScroll}>
            <Image source={{ uri: page.uri }} style={styles.fullImage} resizeMode="contain" />
          </ScrollView>
          <TouchableOpacity style={styles.close} onPress={() => setFull(false)}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  preview: { height: 220, width: '100%', backgroundColor: '#17120F', borderRadius: 12 },
  pdf: { height: 120, borderRadius: 12, backgroundColor: '#17120F', alignItems: 'center', justifyContent: 'center', gap: 4 },
  pdfTitle: { color: PIZZA_FIRE.textPrimary, fontWeight: '900', fontSize: 16 },
  pdfSub: { color: PIZZA_FIRE.textSecondary, fontSize: 13 },
  pager: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pagerText: { color: PIZZA_FIRE.gold, fontSize: 28, fontWeight: '900', paddingHorizontal: 12 },
  pageLabel: { color: PIZZA_FIRE.textSecondary, fontWeight: '700' },
  disabled: { opacity: 0.3 },
  fullBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' },
  fullScroll: { flexGrow: 1, justifyContent: 'center' },
  fullImage: { width: '100%', height: 640 },
  close: { position: 'absolute', top: 48, right: 18, backgroundColor: PIZZA_FIRE.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  closeText: { color: PIZZA_FIRE.charcoal, fontWeight: '900' },
});
