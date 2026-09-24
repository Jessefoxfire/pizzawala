import {
  eventsToArchiveForNewSeason,
  groupByEventSeason,
  groupSortedEventsBySeason,
  seasonIdForNewEvent,
  splitLiveAndArchived,
  splitSortedEventsLiveAndArchived,
} from '../src/utils/eventSeasons';

const seasons = [
  { id: 's-2026', name: 'Season 2026', createdAt: 100 },
  { id: 's-2027', name: 'Season 2027', createdAt: 200 },
];

describe('event seasons', () => {
  it('keeps every event live when no named season files exist', () => {
    const split = splitSortedEventsLiveAndArchived(
      [
        { id: 'b', title: 'Later', days: [{ date: '2026-08-01', startTime: '09:00', endTime: '17:00' }] },
        { id: 'a', title: 'Earlier', days: [{ date: '2026-06-01', startTime: '09:00', endTime: '17:00' }] },
      ],
      [],
      null
    );
    expect(split.archives).toHaveLength(0);
    expect(split.live.map(item => item.id)).toEqual(['a', 'b']);
  });

  it('treats leftover currentSeasonId tags as still live until archived', () => {
    const split = splitLiveAndArchived(
      [
        { id: 'e-old', seasonId: 's-2026' },
        { id: 'e-now', seasonId: 's-2027' },
        { id: 'e-loose' },
      ],
      seasons,
      's-2027'
    );
    expect(split.live.map(item => item.id)).toEqual(['e-now', 'e-loose']);
    expect(split.archives.map(archive => archive.season.name)).toEqual(['Season 2026']);
    expect(split.archives[0].items.map(item => item.id)).toEqual(['e-old']);
  });

  it('hides empty named seasons and lists archive files oldest first', () => {
    const split = splitLiveAndArchived(
      [
        { id: 'legacy' },
        { id: 'tagged', seasonId: 's-2026' },
      ],
      seasons,
      null
    );
    expect(split.live.map(item => item.id)).toEqual(['legacy']);
    expect(split.archives.map(archive => archive.season.id)).toEqual(['s-2026']);
  });

  it('does not put new events into a named season', () => {
    expect(seasonIdForNewEvent('s-2027')).toBeNull();
    expect(seasonIdForNewEvent(null)).toBeNull();
  });

  it('archives current live events except the first event of the new season', () => {
    const toFile = eventsToArchiveForNewSeason(
      [
        { id: 'old-live' },
        { id: 'tagged-current', seasonId: 's-2027' },
        { id: 'already-filed', seasonId: 's-2026' },
        { id: 'new-event' },
      ],
      seasons,
      's-2027',
      'new-event'
    );
    expect(toFile.map(item => item.id)).toEqual(['old-live', 'tagged-current']);
  });

  it('files the opening season under the new name when the live list was empty', () => {
    const toFile = eventsToArchiveForNewSeason(
      [
        { id: 'previous', seasonId: 's-2027' },
        { id: 'older', seasonId: 's-2026' },
      ],
      seasons,
      null,
      'new-event'
    );
    expect(toFile.map(item => item.id)).toEqual(['previous']);
  });

  it('lists live events first in group helper, then archive files', () => {
    const groups = groupByEventSeason(
      [
        { id: 'live', seasonId: null },
        { id: 'archived', seasonId: 's-2026' },
      ],
      seasons,
      null
    ).filter(group => group.items.length > 0);
    expect(groups[0].isCurrent).toBe(true);
    expect(groups[0].items.map(item => item.id)).toEqual(['live']);
    expect(groups[1].season.name).toBe('Season 2026');
    expect(groups[1].items.map(item => item.id)).toEqual(['archived']);
  });

  it('sorts live events oldest to newest', () => {
    const groups = groupSortedEventsBySeason(
      [
        { id: 'b', title: 'Later', days: [{ date: '2026-08-01', startTime: '09:00', endTime: '17:00' }] },
        { id: 'a', title: 'Earlier', days: [{ date: '2026-06-01', startTime: '09:00', endTime: '17:00' }] },
      ],
      [],
      null
    );
    expect(groups[0].items.map(item => item.id)).toEqual(['a', 'b']);
  });

  it('opens the newest season file as current when the live list is empty', () => {
    const split = splitLiveAndArchived(
      [
        { id: 'older', seasonId: 's-2026' },
        { id: 'previous', seasonId: 's-2027' },
      ],
      seasons,
      null
    );
    expect(split.live.map(item => item.id)).toEqual(['previous']);
    expect(split.archives.map(archive => archive.season.id)).toEqual(['s-2026']);
  });
});
