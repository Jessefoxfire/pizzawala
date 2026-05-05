/**
 * OS geofences use a minimum radius (Android GeofenceRegistrar, iOS GeofenceModule).
 * UI and JS proximity checks must use the same value or users see "entered" notifications
 * while the app still shows "Outside".
 */
export const NATIVE_GEOFENCE_MIN_RADIUS_METERS = 200;

export function effectiveGeofenceRadiusMeters(radiusMeters?: number | null): number {
  const r =
    typeof radiusMeters === 'number' && !Number.isNaN(radiusMeters) && radiusMeters > 0
      ? radiusMeters
      : 150;
  return Math.max(NATIVE_GEOFENCE_MIN_RADIUS_METERS, r);
}
