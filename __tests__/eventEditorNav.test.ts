import { canMutateEvents, resolveEventsBackLayer } from '../src/utils/eventEditorNav';

const idle = {
  pickingTime: false,
  calendarVisible: false,
  menuEditorOpen: false,
  seasonModalVisible: false,
  availModalVisible: false,
  eventFormVisible: false,
  openedSeasonId: null as string | null,
};

describe('event editor back navigation', () => {
  it('closes the nearest overlay before popping the screen', () => {
    expect(resolveEventsBackLayer({ ...idle, pickingTime: true, eventFormVisible: true })).toBe('closeTimePick');
    expect(resolveEventsBackLayer({ ...idle, calendarVisible: true, eventFormVisible: true })).toBe('closeCalendar');
    expect(resolveEventsBackLayer({ ...idle, menuEditorOpen: true, eventFormVisible: true })).toBe('closeMenuEditor');
    expect(resolveEventsBackLayer({ ...idle, seasonModalVisible: true })).toBe('closeSeasonModal');
    expect(resolveEventsBackLayer({ ...idle, availModalVisible: true })).toBe('closeAvailModal');
    expect(resolveEventsBackLayer({ ...idle, eventFormVisible: true, openedSeasonId: 's1' })).toBe('closeEventForm');
    expect(resolveEventsBackLayer({ ...idle, openedSeasonId: 's1' })).toBe('closeSeasonArchive');
    expect(resolveEventsBackLayer(idle)).toBe('popScreen');
  });
});

describe('event mutation roles', () => {
  it('allows only admins to mutate events', () => {
    expect(canMutateEvents(true)).toBe(true);
    expect(canMutateEvents(false)).toBe(false);
  });
});
