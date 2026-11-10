/** Prompt only when permission is missing or Location Services are off. */
export function shouldPromptLocationForWorksiteActivate(
  hasPermission: boolean,
  locationServicesOn: boolean
): boolean {
  return !hasPermission || !locationServicesOn;
}

export type RankedWorksite = {
  id: string;
  isInside: boolean;
};

export type WorksiteActiveFlag = { active?: boolean | null };

/** Same flag as Geofences/Events toggles: missing/true is on, explicit false is off. */
export function isActiveWorksite(worksite: WorksiteActiveFlag): boolean {
  return worksite.active !== false;
}

/** Live consideration only — historical shift labels must keep stored names. */
export function activeWorksites<T extends WorksiteActiveFlag>(list: readonly T[]): T[] {
  return list.filter(isActiveWorksite);
}

/** @deprecated Prefer isActiveWorksite */
export const isSelectableWorksite = isActiveWorksite;

/** Location usable → site the user is in, else closest. Otherwise last selected. */
export function pickDefaultWorksiteId(
  rankedByDistance: RankedWorksite[],
  options: { locationUsable: boolean; lastWorksiteId: string | null }
): string | null {
  if (!rankedByDistance.length) return null;
  if (options.locationUsable) {
    return rankedByDistance.find(site => site.isInside)?.id ?? rankedByDistance[0].id;
  }
  if (options.lastWorksiteId && rankedByDistance.some(site => site.id === options.lastWorksiteId)) {
    return options.lastWorksiteId;
  }
  return null;
}

export function shouldShowOutsideSiteStartPrompt(input: {
  worksiteSelected: boolean;
  worksiteAlertsEnabled: boolean;
  worksiteLocationEnabled?: boolean;
  isInsideSelectedSite: boolean;
  worksiteActive?: boolean;
}): boolean {
  if (!isActiveWorksite({ active: input.worksiteActive })) return false;
  const locationAware = input.worksiteAlertsEnabled || !!input.worksiteLocationEnabled;
  return input.worksiteSelected && locationAware && !input.isInsideSelectedSite;
}

export function formatDistanceFromWorksite(meters: number): string {
  const km = Math.round((Math.max(0, meters) / 1000) * 10) / 10;
  return `${km.toFixed(1)} km`;
}

export function worksiteGoogleMapsUrl(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat},${lng}`;
}
