import {
  activeWorksites,
  formatDistanceFromWorksite,
  isActiveWorksite,
  isSelectableWorksite,
  pickDefaultWorksiteId,
  shouldPromptLocationForWorksiteActivate,
  shouldShowOutsideSiteStartPrompt,
  worksiteGoogleMapsUrl,
} from '../src/utils/locationPrompt';

describe('shouldPromptLocationForWorksiteActivate', () => {
  it('does not prompt when permission is granted and location services are on', () => {
    expect(shouldPromptLocationForWorksiteActivate(true, true)).toBe(false);
  });

  it('prompts when permission is missing', () => {
    expect(shouldPromptLocationForWorksiteActivate(false, true)).toBe(true);
  });

  it('prompts when location services are off', () => {
    expect(shouldPromptLocationForWorksiteActivate(true, false)).toBe(true);
  });
});

describe('pickDefaultWorksiteId', () => {
  const ranked = [
    { id: 'closest', isInside: false },
    { id: 'lager', isInside: true },
    { id: 'far', isInside: false },
  ];

  it('prefers the site the user is in when location is usable', () => {
    expect(
      pickDefaultWorksiteId(ranked, { locationUsable: true, lastWorksiteId: 'far' })
    ).toBe('lager');
  });

  it('falls back to closest when location is usable but user is outside every site', () => {
    expect(
      pickDefaultWorksiteId(
        [
          { id: 'closest', isInside: false },
          { id: 'far', isInside: false },
        ],
        { locationUsable: true, lastWorksiteId: 'far' }
      )
    ).toBe('closest');
  });

  it('uses last selected when location is not usable', () => {
    expect(
      pickDefaultWorksiteId(ranked, { locationUsable: false, lastWorksiteId: 'far' })
    ).toBe('far');
  });

  it('returns null when location is off and there is no last site', () => {
    expect(
      pickDefaultWorksiteId(ranked, { locationUsable: false, lastWorksiteId: null })
    ).toBeNull();
  });

  it('ignores a last selected site that is no longer in the active list', () => {
    expect(
      pickDefaultWorksiteId(ranked, { locationUsable: false, lastWorksiteId: 'inactive' })
    ).toBeNull();
  });
});

describe('isActiveWorksite / activeWorksites', () => {
  it('treats missing or true active as on, and false as off', () => {
    expect(isActiveWorksite({})).toBe(true);
    expect(isActiveWorksite({ active: true })).toBe(true);
    expect(isActiveWorksite({ active: false })).toBe(false);
    expect(isSelectableWorksite({ active: false })).toBe(false);
  });

  it('drops inactive sites from live consideration lists', () => {
    const list = [
      { id: 'on', active: true },
      { id: 'off', active: false },
      { id: 'legacy' },
    ];
    expect(activeWorksites(list).map(site => site.id)).toEqual(['on', 'legacy']);
  });
});

describe('shouldShowOutsideSiteStartPrompt', () => {
  it('shows only when a site is selected, alerts are on, and the user is outside', () => {
    expect(
      shouldShowOutsideSiteStartPrompt({
        worksiteSelected: true,
        worksiteAlertsEnabled: true,
        isInsideSelectedSite: false,
      })
    ).toBe(true);
  });

  it('does not show when alerts are opted out', () => {
    expect(
      shouldShowOutsideSiteStartPrompt({
        worksiteSelected: true,
        worksiteAlertsEnabled: false,
        isInsideSelectedSite: false,
      })
    ).toBe(false);
  });

  it('shows when Worksite Location is on even if alerts are off', () => {
    expect(
      shouldShowOutsideSiteStartPrompt({
        worksiteSelected: true,
        worksiteAlertsEnabled: false,
        worksiteLocationEnabled: true,
        isInsideSelectedSite: false,
      })
    ).toBe(true);
  });

  it('does not show when no worksite is selected', () => {
    expect(
      shouldShowOutsideSiteStartPrompt({
        worksiteSelected: false,
        worksiteAlertsEnabled: true,
        isInsideSelectedSite: false,
      })
    ).toBe(false);
  });

  it('does not show when the user is inside the selected site', () => {
    expect(
      shouldShowOutsideSiteStartPrompt({
        worksiteSelected: true,
        worksiteAlertsEnabled: true,
        isInsideSelectedSite: true,
      })
    ).toBe(false);
  });

  it('does not show when the selected worksite is inactive', () => {
    expect(
      shouldShowOutsideSiteStartPrompt({
        worksiteSelected: true,
        worksiteAlertsEnabled: true,
        isInsideSelectedSite: false,
        worksiteActive: false,
      })
    ).toBe(false);
  });
});

describe('formatDistanceFromWorksite', () => {
  it('formats kilometers to one decimal', () => {
    expect(formatDistanceFromWorksite(1800)).toBe('1.8 km');
  });
});

describe('worksiteGoogleMapsUrl', () => {
  it('builds a Google Maps query URL', () => {
    expect(worksiteGoogleMapsUrl(52.5, 13.4)).toBe('https://maps.google.com/?q=52.5,13.4');
  });
});
