import {
  collection,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  writeBatch,
} from '@react-native-firebase/firestore';
import {
  EVENT_SEASONS_CONFIG_ID,
  eventsToArchiveForNewSeason,
  trimmedSeasonId,
  type EventSeason,
  type SeasonAware,
} from '../utils/eventSeasons';

type Firestore = ReturnType<typeof getFirestore>;

const BATCH_LIMIT = 400;

export async function readCurrentSeasonId(fs: Firestore): Promise<string | null> {
  try {
    const snap = await getDoc(doc(fs, 'appConfig', EVENT_SEASONS_CONFIG_ID));
    const raw = snap.exists() ? (snap.data() as { currentSeasonId?: unknown })?.currentSeasonId : null;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

/** Files current live events (except the new season's first event) into a named season. */
export async function startNewNamedSeason(
  fs: Firestore,
  name: string,
  events: Array<{ id: string } & SeasonAware>,
  seasons: EventSeason[],
  keepEventId?: string | null
) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Season name is required.');
  }

  const configRef = doc(fs, 'appConfig', EVENT_SEASONS_CONFIG_ID);
  const configSnap = await getDoc(configRef);
  const rawCurrent = configSnap.exists() ? (configSnap.data() as { currentSeasonId?: unknown })?.currentSeasonId : null;
  const previousCurrentId = typeof rawCurrent === 'string' && rawCurrent.trim() ? rawCurrent.trim() : null;

  const liveEvents = eventsToArchiveForNewSeason(events, seasons, previousCurrentId, keepEventId);
  if (!liveEvents.length) {
    return null;
  }

  const sharedSeasonId = liveEvents
    .map(event => trimmedSeasonId(event.seasonId))
    .reduce<string | null | undefined>((shared, sid) => {
      if (shared === undefined) return sid;
      return shared && sid === shared ? shared : null;
    }, undefined);
  const canRenameExisting =
    typeof sharedSeasonId === 'string' && liveEvents.every(event => trimmedSeasonId(event.seasonId) === sharedSeasonId);

  const archiveRef = canRenameExisting
    ? doc(fs, 'seasons', sharedSeasonId)
    : doc(collection(fs, 'seasons'));

  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  ops.push(batch =>
    batch.set(
      archiveRef,
      canRenameExisting
        ? { name: trimmed, updatedAt: serverTimestamp() }
        : { name: trimmed, createdAt: serverTimestamp() },
      { merge: true }
    )
  );
  if (!canRenameExisting) {
    liveEvents.forEach(event => {
      ops.push(batch => batch.update(doc(fs, 'events', event.id), { seasonId: archiveRef.id }));
    });
  }
  ops.push(batch =>
    batch.set(
      configRef,
      {
        currentSeasonId: null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    )
  );

  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = writeBatch(fs);
    ops.slice(i, i + BATCH_LIMIT).forEach(apply => apply(batch));
    await batch.commit();
  }

  return archiveRef.id;
}
