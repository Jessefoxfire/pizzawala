import { credentialsInFolder, inferHygieneDocumentFolder } from '../src/utils/hygieneDocumentFolders';
import { isSharedTeamHygieneDocument } from '../src/utils/personnelDocuments';
import {
  filterTemperatureLogsForMonth,
  groupTemperatureLogMonths,
  groupTemperatureLogYears,
  groupTemperatureLogsByMonth,
} from '../src/utils/hygieneTemperatureLogs';

describe('hygiene document folders', () => {
  it('uses a persisted folder when present', () => {
    expect(inferHygieneDocumentFolder({ folder: 'other', documentCategory: 'hygiene_card' })).toBe(
      'other'
    );
  });

  it('maps hygiene card types and default hygiene uploads to Employee Hygiene Cards', () => {
    expect(inferHygieneDocumentFolder({ documentCategory: 'hygiene_card' })).toBe('hygiene_cards');
    expect(inferHygieneDocumentFolder({ requiredDocumentType: 'Employee hygiene card' })).toBe(
      'hygiene_cards'
    );
    expect(inferHygieneDocumentFolder({})).toBe('hygiene_cards');
  });

  it('maps Belehrung and instruction types to Belehrung', () => {
    expect(inferHygieneDocumentFolder({ requiredDocumentType: 'Belehrung' })).toBe('belehrung');
    expect(
      inferHygieneDocumentFolder({
        documentCategory: 'required_user_document',
        requiredDocumentType: 'instruction-nachweis',
      })
    ).toBe('belehrung');
    expect(inferHygieneDocumentFolder({ fileName: 'Belehrung.pdf' })).toBe('belehrung');
  });

  it('shows a custom folder file under Other when that folder is not on screen', () => {
    const files = [{ id: '1', folder: 'custom_archive', documentCategory: 'hygiene_card' }];
    expect(credentialsInFolder(files, 'other', ['hygiene_cards', 'belehrung', 'other']).map(item => item.id)).toEqual(['1']);
    expect(credentialsInFolder(files, 'hygiene_cards', ['hygiene_cards', 'belehrung', 'other'])).toEqual([]);
  });

  it('keeps team hygiene uploads and leaves identity documents off the shared list', () => {
    expect(isSharedTeamHygieneDocument({ teamId: 'team-1', documentCategory: 'hygiene_card' }, 'team-1')).toBe(true);
    expect(isSharedTeamHygieneDocument({ documentCategory: 'hygiene_card' }, 'team-1')).toBe(true);
    expect(
      isSharedTeamHygieneDocument(
        { teamId: 'team-1', documentCategory: 'required_user_document', requiredDocumentType: 'Health insurance proof' },
        'team-1'
      )
    ).toBe(false);
    expect(isSharedTeamHygieneDocument({ teamId: 'team-2', documentCategory: 'hygiene_card' }, 'team-1')).toBe(false);
  });

  it('maps german compliance and extra documents to Other', () => {
    expect(
      inferHygieneDocumentFolder({
        documentCategory: 'required_user_document',
        requiredDocumentType: 'Health insurance proof',
      })
    ).toBe('other');
    expect(
      inferHygieneDocumentFolder({
        documentCategory: 'required_user_document',
        requiredDocumentType: 'Signed contract',
      })
    ).toBe('other');
  });
});

describe('hygiene temperature log grouping', () => {
  const logs = [
    { id: 'a', monthKey: '2026-01', loggedAtIso: '2026-01-04T10:00:00.000Z' },
    { id: 'b', monthKey: '2026-01', loggedAtIso: '2026-01-12T10:00:00.000Z' },
    { id: 'c', monthKey: '2025-12', loggedAtIso: '2025-12-02T10:00:00.000Z' },
  ];

  it('lists only years that have entries', () => {
    expect(groupTemperatureLogYears(logs).map(item => item.year)).toEqual(['2026', '2025']);
  });

  it('lists only months that have entries for a year', () => {
    expect(groupTemperatureLogMonths(logs, '2026').map(item => item.monthKey)).toEqual(['2026-01']);
    expect(groupTemperatureLogMonths(logs, '2024')).toEqual([]);
  });

  it('groups logs by month newest first', () => {
    expect(groupTemperatureLogsByMonth(logs).map(item => item.monthKey)).toEqual(['2026-01', '2025-12']);
    expect(groupTemperatureLogsByMonth(logs)[0].items.map(item => item.id)).toEqual(['a', 'b']);
  });
});
