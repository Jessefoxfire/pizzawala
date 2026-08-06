import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOffline } from '../context/OfflineContext';

export default function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const { isOnline, pendingCount, syncing, syncBannerVisible } = useOffline();

  const message = useMemo(() => {
    if (!isOnline) {
      return pendingCount > 0 ? `Offline · ${pendingCount} saved` : 'Offline';
    }
    if (syncing) return 'Syncing…';
    return '';
  }, [isOnline, syncing, pendingCount]);

  return (
    <View style={[styles.chrome, { paddingTop: insets.top + 6 }]}>
      {syncBannerVisible ? (
        <View style={[styles.row, !isOnline && styles.rowOffline]}>
          {syncing ? (
            <ActivityIndicator size="small" color="rgba(255, 248, 238, 0.8)" style={styles.spinner} />
          ) : null}
          <Text style={[styles.text, !isOnline && styles.textOffline]}>{message}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chrome: {
    width: '100%',
    alignItems: 'flex-end',
    paddingHorizontal: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(30, 14, 10, 0.76)',
    borderWidth: 1,
    borderColor: 'rgba(255, 209, 102, 0.18)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 4,
    maxWidth: '72%',
  },
  rowOffline: {
    backgroundColor: 'rgba(60, 34, 10, 0.9)',
    borderColor: 'rgba(255, 209, 102, 0.3)',
  },
  spinner: {
    transform: [{ scale: 0.85 }],
  },
  text: {
    color: 'rgba(255, 248, 238, 0.78)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  textOffline: {
    color: 'rgba(255, 209, 102, 0.92)',
  },
});
