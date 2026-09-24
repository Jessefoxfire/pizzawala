import { sortEventsByDays, type EventLike } from './eventDays';

export const DEFAULT_SEASON_NAME = 'Season';
export const EVENT_SEASONS_CONFIG_ID = 'eventSeasons';
export const IMPLICIT_SEASON_ID = '__implicit__';

export type EventSeason = {
  id: string;
  name: string;
  createdAt?: unknown;
};

export type SeasonAware = {
  seasonId?: string | null;
};

export type SeasonGroup<T> = {
  season: EventSeason;
  isCurrent: boolean;
  items: T[];
};

export type LiveArchiveSplit<T> = {
  live: T[];
  archives: Array<{ season: EventSeason; items: T[] }>;
};

export function parseSeasonDoc(id: string, data: Record<string, unknown> | undefined): EventSeason {
  const name = typeof data?.name === 'string' ? data.name.trim() : '';
  return {
    id,
    name: name || DEFAULT_SEASON_NAME,
    createdAt: data?.createdAt ?? null,
  };
}

export function seasonCreatedMs(season: Pick<EventSeason, 'createdAt'>): number {
  const raw = season.createdAt as { toMillis?: () => number; toDate?: () => Date } | number | string | null | undefined;
  if (raw && typeof raw === 'object') {
    if (typeof raw.toMillis === 'function') {
      const ms = raw.toMillis();
      return Number.isFinite(ms) ? ms : 0;
    }
    if (typeof raw.toDate === 'function') {
      const ms = raw.toDate().getTime();
      return Number.isFinite(ms) ? ms : 0;
    }
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

export function sortSeasonsNewestFirst(seasons: EventSeason[]) {
  return [...seasons].sort((a, b) => {
    const byTime = seasonCreatedMs(b) - seasonCreatedMs(a);
    if (byTime !== 0) return byTime;
    return b.id.localeCompare(a.id);
  });
}

export function sortSeasonsOldestFirst(seasons: EventSeason[]) {
  return sortSeasonsNewestFirst(seasons).reverse();
}

export function trimmedSeasonId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Live events: untagged, or still tagged as the old "current" season until they are archived. */
export function isLiveSeasonItem(item: SeasonAware, currentSeasonId: string | null | undefined) {
  const sid = trimmedSeasonId(item.seasonId);
  if (!sid) return true;
  const current = trimmedSeasonId(currentSeasonId);
  return Boolean(current && sid === current);
}

export function splitLiveAndArchived<T extends SeasonAware>(
  items: T[],
  seasons: EventSeason[],
  currentSeasonId: string | null | undefined
): LiveArchiveSplit<T> {
  const knownIds = new Set(seasons.map(season => season.id));
  const currentId = trimmedSeasonId(currentSeasonId);
  const live: T[] = [];
  const buckets = new Map<string, T[]>();

  items.forEach(item => {
    if (isLiveSeasonItem(item, currentId)) {
      live.push(item);
      return;
    }
    const sid = trimmedSeasonId(item.seasonId);
    if (!sid || !knownIds.has(sid)) {
      live.push(item);
      return;
    }
    const list = buckets.get(sid) ?? [];
    list.push(item);
    buckets.set(sid, list);
  });

  const archives = sortSeasonsOldestFirst(seasons.filter(season => season.id !== currentId)).filter(
    season => (buckets.get(season.id) || []).length > 0
  );
  const archived = archives.map(season => ({
    season,
    items: buckets.get(season.id) || [],
  }));

  if (live.length === 0 && archived.length > 0) {
    const current = archived[archived.length - 1];
    return {
      live: current.items,
      archives: archived.slice(0, -1),
    };
  }

  return {
    live,
    archives: archived,
  };
}

export function eventsToArchiveForNewSeason<T extends { id: string } & SeasonAware>(
  events: T[],
  seasons: EventSeason[],
  currentSeasonId: string | null | undefined,
  keepEventId?: string | null
) {
  const keepId = typeof keepEventId === 'string' && keepEventId.trim() ? keepEventId.trim() : null;
  const { live } = splitLiveAndArchived(events, seasons, currentSeasonId);
  return live.filter(event => event.id !== keepId);
}

export function splitSortedEventsLiveAndArchived<T extends SeasonAware & EventLike>(
  events: T[],
  seasons: EventSeason[],
  currentSeasonId: string | null | undefined
) {
  const split = splitLiveAndArchived(events, seasons, currentSeasonId);
  return {
    live: sortEventsByDays(split.live),
    archives: split.archives.map(archive => ({
      ...archive,
      items: sortEventsByDays(archive.items),
    })),
  };
}

/** @deprecated Named seasons are archive files; new events stay live (no seasonId). */
export function seasonIdForNewEvent(_currentSeasonId?: string | null) {
  return null;
}

export function groupByEventSeason<T extends SeasonAware>(
  items: T[],
  seasons: EventSeason[],
  currentSeasonId: string | null | undefined
): SeasonGroup<T>[] {
  const { live, archives } = splitLiveAndArchived(items, seasons, currentSeasonId);
  return [
    {
      season: { id: IMPLICIT_SEASON_ID, name: 'Current' },
      isCurrent: true,
      items: live,
    },
    ...archives.map(archive => ({
      season: archive.season,
      isCurrent: false,
      items: archive.items,
    })),
  ];
}

export function groupSortedEventsBySeason<T extends SeasonAware & EventLike>(
  events: T[],
  seasons: EventSeason[],
  currentSeasonId: string | null | undefined
) {
  const { live, archives } = splitSortedEventsLiveAndArchived(events, seasons, currentSeasonId);
  return [
    {
      season: { id: IMPLICIT_SEASON_ID, name: 'Current' },
      isCurrent: true,
      items: live,
    },
    ...archives.map(archive => ({
      season: archive.season,
      isCurrent: false,
      items: archive.items,
    })),
  ];
}
