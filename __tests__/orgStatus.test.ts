import {
  employeeSortName,
  eventAcceptAutoKey,
  eventAssignAutoKey,
  isCurrentOrUpcomingDate,
  isCurrentOrUpcomingEvent,
  isOrgActive,
  orgActivationWrite,
  orgStatusLabel,
  shouldApplyOrgActivation,
  shiftAssignAutoKey,
  sortByOrgActivePreserving,
  sortEmployeesByOrgActive,
} from '../src/utils/orgStatus';

describe('orgStatus', () => {
  it('treats missing orgActive as Active and never uses disabled', () => {
    expect(isOrgActive({})).toBe(true);
    expect(isOrgActive({ orgActive: true })).toBe(true);
    expect(isOrgActive({ orgActive: false })).toBe(false);
    expect(isOrgActive({ orgActive: false, disabled: false } as any)).toBe(false);
    expect(isOrgActive({ disabled: true } as any)).toBe(true);
    expect(orgStatusLabel({ orgActive: false })).toBe('Inactive');
    expect(orgStatusLabel({})).toBeNull();
  });

  it('sorts Active employees first and keeps name order inside each group', () => {
    const list = [
      { id: 'z', name: 'Zoe', orgActive: false },
      { id: 'b', name: 'Ben' },
      { id: 'a', name: 'Amy', orgActive: true },
      { id: 'c', name: 'Cara', orgActive: false },
    ];
    expect(sortEmployeesByOrgActive(list).map(item => item.id)).toEqual(['a', 'b', 'c', 'z']);
  });

  it('preserves an existing sort when only partitioning by org status', () => {
    const hours = [
      { id: 'inactive-high', hours: 40, orgActive: false },
      { id: 'active-low', hours: 4, orgActive: true },
      { id: 'active-high', hours: 30, orgActive: true },
    ];
    const byHours = [...hours].sort((a, b) => b.hours - a.hours);
    expect(sortByOrgActivePreserving(byHours, item => item.orgActive !== false).map(item => item.id)).toEqual([
      'active-high',
      'active-low',
      'inactive-high',
    ]);
  });

  it('uses name / email for the default label sort', () => {
    expect(employeeSortName({ email: 'b@x.com' })).toBe('b@x.com');
    expect(employeeSortName({ name: 'Ada', email: 'z@x.com' })).toBe('ada');
  });

  it('treats today and future dates as current or upcoming', () => {
    expect(isCurrentOrUpcomingDate('2026-10-31', '2026-10-31')).toBe(true);
    expect(isCurrentOrUpcomingDate('2026-11-01', '2026-10-31')).toBe(true);
    expect(isCurrentOrUpcomingDate('2026-10-30', '2026-10-31')).toBe(false);
    expect(isCurrentOrUpcomingDate('not-a-date', '2026-10-31')).toBe(false);
    expect(isCurrentOrUpcomingEvent({ startDate: '2026-10-01', endDate: '2026-10-31' }, '2026-10-31')).toBe(true);
    expect(isCurrentOrUpcomingEvent({ startDate: '2026-09-01', endDate: '2026-09-30' }, '2026-10-31')).toBe(false);
    expect(isCurrentOrUpcomingEvent({ days: [{ date: '2026-11-02', startTime: '09:00', endTime: '17:00' }] }, '2026-10-31')).toBe(true);
  });

  it('does not re-apply the same automatic activation key after a later manual change', () => {
    const key = shiftAssignAutoKey('u1', ['2026-11-01', '2026-10-30'], '2026-10-31');
    expect(key).toBe('shift-assign:u1:2026-11-01');
    expect(shouldApplyOrgActivation({ orgActive: false }, key)).toBe(true);
    expect(shouldApplyOrgActivation({ orgActive: false, orgActiveLastAutoKey: key }, key)).toBe(false);
    expect(shouldApplyOrgActivation({ orgActive: false, orgActiveLastAutoKey: key }, shiftAssignAutoKey('u1', ['2026-11-02'], '2026-10-31'))).toBe(true);
    expect(orgActivationWrite(key)).toEqual({ orgActive: true, orgActiveLastAutoKey: key });
    expect(eventAcceptAutoKey('e1', 'u1')).toBe('event-accept:e1:u1');
    expect(eventAssignAutoKey('e1', 'u1', 'n1')).not.toBe(eventAssignAutoKey('e1', 'u1', 'n2'));
  });
});
