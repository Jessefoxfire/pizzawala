export type EventsBackLayer =
  | 'closeTimePick'
  | 'closeCalendar'
  | 'closeMenuEditor'
  | 'closeSeasonModal'
  | 'closeAvailModal'
  | 'closeEventForm'
  | 'closeSeasonArchive'
  | 'popScreen';

export type EventsBackState = {
  pickingTime: boolean;
  calendarVisible: boolean;
  menuEditorOpen: boolean;
  seasonModalVisible: boolean;
  availModalVisible: boolean;
  eventFormVisible: boolean;
  openedSeasonId: string | null;
};

/** Closest overlay first, then season archive, then one real navigation pop. */
export function resolveEventsBackLayer(state: EventsBackState): EventsBackLayer {
  if (state.pickingTime) return 'closeTimePick';
  if (state.calendarVisible) return 'closeCalendar';
  if (state.menuEditorOpen) return 'closeMenuEditor';
  if (state.seasonModalVisible) return 'closeSeasonModal';
  if (state.availModalVisible) return 'closeAvailModal';
  if (state.eventFormVisible) return 'closeEventForm';
  if (state.openedSeasonId) return 'closeSeasonArchive';
  return 'popScreen';
}

export function canMutateEvents(isAdmin: boolean): boolean {
  return isAdmin === true;
}
