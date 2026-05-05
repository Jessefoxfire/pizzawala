# Geofence notifications - handoff notes (2026-04-08)

## Current flow (as implemented)
- Geofence monitoring entry point: GeofenceMonitor component.
- Permissions:
  - iOS: request "always" location; notifee permission requested (iOS + Android 13+).
  - Android: fine location requested; background location required for API 29+ (checks/alert in utils/geo).
- Native vs JS fallback:
  - Uses native module when Play Services is available, including on Google Play emulator images.
  - JS fallback is only for explicit `globalThis.USE_JS_GEOFENCE`, missing native support, or missing Play Services.
  - The foreground JS watcher is still started as a safety net even when native geofencing is available; native remains responsible for background/closed-app delivery.
  - JS fallback uses Geolocation.watchPosition and manual radius checks.
- Event processing:
  - processGeofenceEvent writes a geofenceEvents doc and stores last event in AsyncStorage.
  - notifyGeofenceTransition triggers notifee notification + vibration + toast/alert.
- Notifications:
  - Notifee channel: "geofence-updates" (HIGH importance), smallIcon ic_launcher.
  - showGeofenceNotification is called from notifyGeofenceTransition and headless handler.
- Headless handling:
  - handleGeofenceEventHeadless (background) processes event, shows notification, stores pending prompt.
  - handleGeofenceBootHeadless re-registers cached geofences.

## Key files
- src/components/GeofenceMonitor.tsx
- src/geofencing/processor.ts
- src/geofencing/headless.ts
- src/notifications/geofenceNotifications.ts
- src/geofencing/native.ts
- src/geofencing/storage.ts
- src/utils/geo.ts

## Known behaviors and constraints
- iOS is capped to 20 active geofences; nearest 20 are registered.
- JS fallback checks every 2-5 seconds with a 5m distance filter.
- Notifications are gated to avoid duplicate prompts via AsyncStorage event IDs.

## Open checks (not yet verified)
- AndroidManifest entries for geofence receiver, headless task, and required permissions (including POST_NOTIFICATIONS, ACCESS_BACKGROUND_LOCATION).
- iOS capabilities for background location and notification permissions.
- Native GeofenceModule implementation and event emission wiring.

## Next steps to resume
- Verify whether geofence events are firing (native or JS fallback).
- Confirm notification permissions and channel behavior on device.
- If events fire but notifications do not, trace notifyGeofenceTransition and notifee display errors.
