# Pizza Wala Team App — Architecture Audit

Inspection only. No production code, Firebase rules, dependencies, or native projects were changed.

Audit date: 5 October 2026.

## Scope (read this first)

Two different trees both claim to be the app. They diverged at `5720a34`.

| Tree | Commit | What it is |
|---|---|---|
| **Checked-out working tree** | `main` @ `88fad03` | What is on disk and what a build from this checkout would compile. About 90 files under `src/`. |
| **Fuller product line** | `feature/ios-release-refresh` @ `80fd3d1` | 11 commits not in `main`. About +14,300 / −4,800 lines under `src`, `functions`, and `storage.rules`. Not checked out. |

`main` then has two commits the feature branch does not: `cb569a4` (consolidate authoritative app source) and `88fad03` (ignore local artifacts).

The feature branch adds receipts, driving time, day summary, monthly timesheet PDF, birthdays, hygiene folders, event seasons, the live shift notification, and richer offline clock-out. It removes `AwardMedalScreen` and `HallOfFameScreen`.

This report describes **`main` as the code that is actually checked out**, and calls out feature-branch behaviour wherever the product the team has been shipping (receipts, driving, Stundenzettel, iOS 2.6) lives only on that branch. A clean Team App cannot be extracted until one tree is chosen as authoritative.

The editor search index also surfaces feature-branch files (`src/services/receipts.ts`, `src/utils/daySummary.ts`, and others) even though `Test-Path` shows they are **not on disk** and **not in `main`**. Those paths below are marked **[feature branch]**.

---

## 1. Executive Summary

The Team App is a single-tenant React Native application (React Native 0.83, React 19) bound to one Firebase project, `pizza-wala-team`, and one hardcoded team id, `team-1`.

The reusable parts are real: email/password accounts, roles, live shifts with breaks, geofenced worksites, events, chat, hygiene logs and credentials, schedules, offline outbox, and push notifications. They are not packaged as a framework. Company name, logo, colours, truck runbooks, document lists, export titles, notification copy, Firebase project, and `team-1` are compiled into screens, services, Cloud Functions, and native projects.

Security does not support a second company. Firestore’s catch-all rule gives every signed-in user read and write on almost every document, including other people’s profiles, locations, shifts, and ID uploads. Admin is a field on the user document, which that same rule lets any user edit. Storage lets any signed-in user read and write any employee’s hygiene files.

Working hours on `main` have one duration function (`calcWorkedMs` in `src/services/shifts.ts`) and a separate day-clipping helper (`src/utils/workingHours.ts`). The admin open-shift timer and manual entry do not use it. Driving time, day-summary confirmation, and monthly timesheet PDF exist only on the feature branch, and those exports do not use the same day-clipping rules as the Working Hours screen.

The highest-risk fact for the extraction is the branch split. Building the clean app from `main` drops receipts, driving, timesheets, and birthdays. Building it from the feature branch drops awards and a different schedule-PDF and shift implementation. Those trees must be reconciled before any move toward `teams/{teamId}`.

---

## 2. Architecture Map

### Entry

| Path | Role |
|---|---|
| `index.js` | Registers the app. Installs Firebase Messaging and Notifee background handlers. Registers headless tasks `GeofenceEvent`, `SignificantLocationChange`, `GeofenceBoot`. |
| `App.tsx` | `SafeAreaProvider` → `OfflineProvider` → `AppNavigator`. Calls `initFirestoreOffline()`. |
| `app.json` | Component name `PizzaWala`. |
| `src/navigation/AppNavigator.tsx` | Auth-gated native stack. Mounts geofence, presence, and location monitors. Owns push registration and notification routing. |
| `src/navigation/navigationRef.ts` | Imperative navigation. |

Boot: `index.js` → `App.tsx` → signed-out stack (`Login`, `CreateAccount`) or the authenticated stack.

### Navigation and screens (`src/screens/`)

Authenticated shell always mounts `GeofenceMonitor`, `PresenceMonitor`, `LocationMonitor`, and `OfflineBanner`.

| Route | File | Role |
|---|---|---|
| Login | `LoginScreen.tsx` | Email/password sign-in. Branded welcome. |
| CreateAccount | `CreateAccountScreen.tsx` | Account creation and avatar. |
| Home | `HomeScreen.tsx` | Hub, shift status, menu. |
| Permissions | `PermissionsScreen.tsx` | Location, activity, notification prompts. |
| Geofences | `GeofencesScreen.tsx` | Admin worksite CRUD. |
| ManageUsers | `ManageUsersScreen.tsx` | Employees, roles, required documents. |
| EditProfile | `EditProfileScreen.tsx` | Profile and German employment fields. |
| WorksiteFinder | `WorksiteFinderScreen.tsx` | Navigate to a worksite. |
| AwardMedal | `AwardMedalScreen.tsx` | Give an award. Removed on the feature branch. |
| HallOfFame | `HallOfFameScreen.tsx` | Award board. Removed on the feature branch. |
| MySchedule | `MyScheduleScreen.tsx` | Personal rota and live shift controls. |
| ShiftSetup | `ShiftSetupScreen.tsx` | Timer, auto-shift, worksite alerts. |
| GeofenceDebug | `GeofenceDebugScreen.tsx` | Diagnostics. Linked from Admin Options. |
| AdminOptions | `AdminOptionsScreen.tsx` | Admin tile hub. |
| WorksiteOverview | `WorksiteOverviewScreen.tsx` | Admin hours overview. |
| AdminSchedule | `AdminScheduleScreen.tsx` | Rota and schedule PDF. |
| AdminCalendar | `AdminCalendarScreen.tsx` | Scheduled shifts calendar. |
| TeamMap | `TeamMapScreen.tsx` | Live locations of all users. |
| Chat | `ChatScreen.tsx` | Team chat, DMs, event threads. |
| MapPicker | `MapPickerScreen.tsx` | Pick a geofence centre. |
| Events | `EventsScreen.tsx` | Event CRUD and CSV import. |
| AdminAvailability | `AdminAvailabilityScreen.tsx` | Who can work an event. |
| AssignShifts | `AssignShiftsScreen.tsx` | Bulk scheduled shifts. |
| ManualShiftEntry | `ManualShiftEntryScreen.tsx` | Closed shift written by hand. Registered, no in-app navigation caller found. |
| Hygiene | `HygieneScreen.tsx` | Temperature logs, credentials, monthly CSV. |
| AdminHygiene | `AdminHygieneScreen.tsx` | All hygiene data. |
| TruckManagement | `TruckManagementScreen.tsx` | Festival truck runbook. |
| DepartureChecklist | `DepartureChecklistScreen.tsx` | Shared pack-out checklist. |
| RequiredDocuments | `RequiredDocumentsScreen.tsx` | Employment document uploads. |
| WorkingHours | `WorkingHoursScreen.tsx` | Last 7 local days of work and breaks. |

On disk but not registered: `DriverLogin.tsx` (placeholder).

**[feature branch]** also registers `ReceiptsExpenses` and `AdminReceipts`, and passes `employeeUserId` into Working Hours so an admin can open someone else’s month.

### Components (`src/components/`)

`GeofenceMonitor.tsx` (foreground geofence bridge), `LocationMonitor.tsx` (writes `lastLocation` while on shift), `PresenceMonitor.tsx` (`lastSeenAt` / `online`), `OfflineBanner.tsx`, `CircularShiftTimer.tsx`, `HomeBottomNav.tsx`, `EventDayTimeModal.tsx`, `TimePickerModal.tsx`, `DocumentNameConfirmModal.tsx`, `PizzaFireBackground.tsx`, `Avatar.tsx`, `Icons.tsx`.

**[feature branch]** also has `DaySummaryModal.tsx`, `ShiftOngoingSync.tsx`, `ShiftEndReminderSync.tsx`, `BirthdayGreeting.tsx`, `ReceiptDocumentPreview.tsx`, `ShiftPlanGrid.tsx`, `HygieneFolderPickerModal.tsx`, `HygieneUploadSourceModal.tsx`, `PizzaFireButton.tsx`, `PizzaFireCalendar.tsx`, `PizzaFireScreen.tsx`, `HoursChangeBadge.tsx`, `EventOpeningHoursModal.tsx`.

### Hooks, context, auth

| Path | Role |
|---|---|
| `src/auth/useAuth.ts` | Native Auth listener. Loads `users/{uid}` through the **web** Firestore SDK. Bootstrap admin emails. Signs out `disabled` users. |
| `src/hooks/useHygieneCredentialUpload.tsx` | Pick → confirm name → optional AI enhance → upload. |
| `src/context/OfflineContext.tsx` | Online flag, outbox count, flush on reconnect. |

There is no company/team context. `teamId` is read ad hoc from the user document and defaults to `'team-1'`.

### Services (`src/services/`)

| File | Role |
|---|---|
| `firebase.ts` | Web `initializeApp` plus React Native Auth, Firestore, and Storage. Login, create account, sign-out, password reset. Hardcoded `team-1` chat collection. |
| `shifts.ts` | Live shift start / pause / resume / end, period math, offline queue. |
| `hygiene.ts` | Temperature logs, credential upload/delete, monthly CSV. |
| `schedulePdf.ts` | jsPDF rota, WhatsApp share, Cloud Function upload. |
| `pushRegistration.ts` | FCM token onto `users/{uid}.fcmToken`. |
| `geofenceService.ts.rtf` | Leftover RTF. Not imported. |

**[feature branch]** also has `receipts.ts`, `receiptCapture.ts`, `receiptRecognition.ts`, `receiptScanner.ts`, `monthlyTimesheetPdf.ts`, `eventSeasons.ts`, `hygieneUnits.ts`, `hygieneDocumentFolders.ts`.

### Offline (`src/offline/`)

`initFirestore.ts` (unlimited native Firestore cache), `connectivity.ts`, `outbox.ts` (AsyncStorage queue and open-shift mirror), `sync.ts`, `preload.ts`, `types.ts`, `events.ts`.

Outbox types on `main`: `shift_start`, `pause`, `resume`, `end`, `temperature_log`.

**[feature branch]** outbox also carries `workCategory: 'driving' | null` and a last-open-shift id.

### Geofencing

JavaScript: `src/geofencing/` — `native.ts`, `processor.ts`, `headless.ts`, `storage.ts`, `notificationPolicy.ts`, `effectiveRadius.ts` (minimum 200 m), `transition.ts`, `types.ts`.

Android: `android/app/src/main/java/com/djtranscendence/pizzawala/geofence/` — Play Services geofences, foreground location service, boot receiver, watchdog, activity-recognition transitions, exit worker. **[feature branch]** adds `ShiftOngoingService.kt`, `ShiftOngoingStore.kt`, `ShiftOngoingRefreshReceiver.kt`.

iOS: `ios/PizzaWala/GeofenceModule.swift` (+ `.m`). `CLLocationManager` regions, significant-location changes, local notifications. Notes in `notes.md` record a 20-region iOS cap.

### Notifications

`src/notifications/geofenceNotifications.ts`, `notificationRouting.ts`, `displayForegroundRemoteMessage.ts`, `pendingNotificationOpen.ts`.

Channels used from JS and Cloud Functions: `chat_messages`, `awards`, `personal_alerts`, `geofence-updates`. Android native also uses `pizzawala-location-monitor` and, on the feature branch, `pizzawala-shift-ongoing`.

### Working time, exports, documents

See sections 7 and 13. On `main`:

- Hours math: `src/services/shifts.ts`, `src/utils/workingHours.ts`.
- Schedule PDF: `src/services/schedulePdf.ts`.
- Hygiene CSV: `src/services/hygiene.ts`.
- Events CSV import: `src/utils/parseEventsCsv.ts`.
- No monthly timesheet. No receipts.

### Cloud Functions (`functions/index.js`, region `us-central1`)

| Export | Trigger | Behaviour |
|---|---|---|
| `notifyUserInbox` | create `users/{userId}/notifications/{id}` | FCM, default title `PizzaWala`. |
| `notifyTeamChatMessage` | create `chats/team-1/messages/{id}` | Loads **every** user, skips anyone whose `teamId` is not `team-1`. |
| `notifyAwardRecipient` | create `awards/{id}` | FCM to the recipient. |
| `hygieneEducationReminderSweep` | daily 09:00 UTC | All active hygiene credentials. Not filtered by team. |
| `uploadScheduleExport` | HTTPS | Admin check, PDF bytes to `schedules/exports/`. |
| `enhanceDocumentImage` | callable | Sharp normalize/sharpen. Any signed-in user. |

**[feature branch]** adds `birthdayNotificationSweep` (`functions/birthday.js`), still defaulting team id to `team-1`.

### Constants, theme, assets

- `src/constants/germanEmployeeCompliance.ts` — German employment fields and required document types.
- `src/theme/pizzaFireTheme.ts` — `PIZZA_FIRE` palette.
- `src/types.ts` — `Geofence`.
- Assets: `assets/Pizza Wala Logo.png`, `assets/Flames background.png`, `assets/Chat background.png`, `assets/Icons/`, `assets/avatars/` (16 PNGs).

### Native identity

| | Android | iOS |
|---|---|---|
| Id | `com.djtranscendence.pizzawala` (debug suffix `.debug`) | `com.pizzawala.app` |
| Display name | PizzaWala | PizzaWala |
| Firebase file | `android/app/google-services.json` | `GoogleService-Info.plist` is gitignored |

Android permissions include fine/background location, activity recognition, boot completed, foreground service (location), notifications, camera, and legacy external storage. iOS background modes: location, fetch, remote-notification.

### Dependencies (`package.json`)

React Native 0.83.1, React 19.2.0. Navigation 7. Firebase JS SDK `firebase` **and** `@react-native-firebase/*` (app, auth, firestore, messaging, storage). Notifee, AsyncStorage, NetInfo, maps, two geolocation packages, image picker and crop picker, document picker, document scanner, `jspdf`, calendars, share, fs, permissions, svg, compass heading. One patch: `patches/@react-native+gradle-plugin+0.83.1.patch`.

Functions: `firebase-admin`, `firebase-functions`, `sharp`. Node 20.

### Large screens (approximate, `main`)

`HygieneScreen.tsx` ~1410, `TruckManagementScreen.tsx` ~1400, `ManageUsersScreen.tsx` ~1260, `ChatScreen.tsx` ~1170, `GeofencesScreen.tsx` ~1130, `EventsScreen.tsx` ~1090, `WorksiteFinderScreen.tsx` ~1050, `EditProfileScreen.tsx` ~1010. These screens talk to Firestore directly.

---

## 3. Generic Team Framework

These features are generic even though Pizza Wala is the only tenant. They should survive extraction with paths and copy made configurable.

- Email/password authentication, password reset, disabled-user sign-out (`src/auth/useAuth.ts`, `src/services/firebase.ts`).
- User profiles, avatars, presence, push tokens.
- Role flag `roles: ['admin' | 'member']` as a concept. The current enforcement is not safe; the concept is generic.
- Live shifts: clock in, pause, resume, clock out, lock after end, manual edits with original values (`src/services/shifts.ts`).
- Breaks as first-class periods.
- Worksite selection and geofences (centre, radius, active flag).
- Background geofencing, auto-shift, worksite alerts, offline shift queue.
- Scheduled shifts versus worked shifts.
- Events, staff assignment, availability, event chat.
- Team chat and direct messages.
- Documents attached to a person, with an employer-defined required list.
- Hygiene temperature logs and credential files, including a reminder date. The truck equipment list is not generic; the log mechanism is.
- Receipts and expense totals **[feature branch]** — generic expense capture. The two German buckets are configuration.
- Driving as a work category **[feature branch]** — generic.
- Daily confirmation and monthly timesheet **[feature branch]** — generic. The PDF header is not.
- Notifications, in-app inbox, FCM.
- CSV/PDF export and share.
- Offline outbox and Firestore disk cache.
- Awards **[main only]** — generic recognition, currently unused by the feature branch.
- Audit-ish fields already stored on shifts: `manuallyEdited`, `originalStartIso`, `startedBy`, `endedBy`, `locked`.

---

## 4. Company Configuration

These should stay supported and come from team configuration, not source code.

| Item | Where it is hardcoded today |
|---|---|
| Company name and short name | `app.json`, login title, PDF/CSV filenames, notification fallback title |
| Logo and flame background | `assets/Pizza Wala Logo.png`, `assets/Flames background.png`, iOS `PizzaWalaLogo` |
| Colours | `src/theme/pizzaFireTheme.ts` (`PIZZA_FIRE`) |
| Email placeholders | `tony@pizzawala.com`, `email@pizzawala.com` |
| Required employment documents | `GERMAN_COMPLIANCE_DOCUMENTS` in `src/constants/germanEmployeeCompliance.ts` |
| Extra required-doc options | Firestore `appConfig/userRequiredDocuments` (already a document, still global) |
| Temperature targets | `TEMPERATURE_TARGETS` in `src/services/hygiene.ts` |
| Hygiene folder labels | **[feature branch]** `src/utils/hygieneDocumentFolders.ts` (`hygiene_cards`, `belehrung`, `other`) |
| Receipt categories | **[feature branch]** `versorgung` / `firma` in `src/domain/receipts/types.ts` |
| Currency and locale | EUR, German date style on the timesheet, English UI everywhere else |
| Departure checklist seed | `DEFAULT_ITEMS` in `DepartureChecklistScreen.tsx` |
| Truck runbook steps | `TRUCK_STEPS` in `TruckManagementScreen.tsx` |
| Schedule PDF title, footer, public URL | `src/services/schedulePdf.ts` |
| Timesheet legal header | **[feature branch]** “Stundenzettel” / “Pizza Wala Berlin” |
| Birthday greeting | **[feature branch]** `src/utils/birthday.ts` |
| Default map centre | `MapPickerScreen.tsx` uses the React Native Maps sample point (Los Angeles), not a company site |
| Campsite pin | Firestore `appConfig/campsite` |
| Event seasons | **[feature branch]** `appConfig/eventSeasons` and `seasons` |
| Admin bootstrap identities | email allowlist in `useAuth.ts` and `functions/index.js` |
| WhatsApp numbers for schedule share | AsyncStorage `scheduleExportWhatsAppPhones` |

German employment fields (address, birth date, social security number, Steuer-ID) are a compliance pack for German employers, not a Pizza Wala rule. A non-German company should be able to turn that pack off.

---

## 5. Pizza Wala-Specific Code

### Identity and project

- App name `PizzaWala` in `app.json`, `package.json`, `android/.../strings.xml`, `ios/PizzaWala/Info.plist`, `MainActivity.kt`, `AppDelegate.swift`, `index.js`.
- Android application id `com.djtranscendence.pizzawala`. iOS bundle id `com.pizzawala.app`. They do not match.
- Firebase project `pizza-wala-team` in `src/services/firebase.ts`, `.firebaserc`, `android/app/google-services.json`.
- Buckets `gs://pizza-wala-team.firebasestorage.app` and legacy `gs://pizza-wala-team.appspot.com`.
- Cloud Function URL in `schedulePdf.ts`: `https://us-central1-pizza-wala-team.cloudfunctions.net/uploadScheduleExport`.
- Public schedule link: `https://pizzawala-admin.vercel.app/app/schedule`.
- Native preference and channel ids: `pizzawala_geofences`, `pizzawala-location-monitor`, **[feature branch]** `pizzawala_shift_ongoing`, `pizzawala-shift-ongoing`, AsyncStorage key `pizzawala.documentsIntroSeen.{userId}`.

### Brand copy and assets

- `assets/Pizza Wala Logo.png`, flame and chat backgrounds, iOS launch image `PizzaWalaLogo`.
- Login: “Welcome to The Pizza Wala Team!”
- Permission and settings strings that say “PizzaWala” in `PermissionsScreen.tsx`, `geo.ts`, `GeofencesScreen.tsx`, `GeofenceDebugScreen.tsx`, Android `GeofenceMonitorService.kt`, iOS `Info.plist`.
- Schedule PDF title “PizzaWala Schedule”, footer “PizzaWala Team • pizzawala-admin.vercel.app”, WhatsApp text with a pizza emoji.
- Hygiene CSV filename `PizzaWala-hygiene-{month}.csv`.
- **[feature branch]** timesheet “Pizza Wala Berlin”, file `PizzaWala-Stundenzettel-…`, greeting “Happy Birthday from team Pizza Wala”.
- Assign-shift notification: “New Shifts Assigned! 🍕”.
- Truck hero: “PIZZAWALA FESTIVAL TRUCK OPERATIONS”.
- Checklist line: “All 4 PW cable channels” in both `TruckManagementScreen.tsx` and `DepartureChecklistScreen.tsx`.

### People and team id

Bootstrap admins, client and Cloud Functions:

- `indispirit@gmail.com`
- `goddessjyotis@gmail.com`
- `maromabeauty@gmail.com`

`scratch/promote_admin.js` (gitignored local script, not on the shipping tree) promotes `dylanmarkusimhoff@gmail.com` and sets `team-1`. Do not treat that script as product code, but it shows the same single-team admin habit.

`'team-1'` is the default in `firebase.ts` (account creation and `teamChatMessages()`), `useAuth.ts`, `shifts.ts` `getTeamId`, `ChatScreen.tsx`, `hygiene.ts`, `GeofencesScreen.tsx`, `ManageUsersScreen.tsx`, `AdminOptionsScreen.tsx`, `AdminHygieneScreen.tsx`, `AwardMedalScreen.tsx`, `DepartureChecklistScreen.tsx` (`CHECKLIST_DOC_ID`), `TruckManagementScreen.tsx` (`TRUCK_MANAGEMENT_DOC_ID`), and `functions/index.js` (trigger path `chats/team-1/messages` and the filter `teamId !== 'team-1'`).

No hardcoded employee display names in product UI. Placeholder name: “Tony Pepperoni”. No hardcoded worksite coordinates. Worksites live in Firestore `geofences`.

### Ops content that is this truck, not a generic checklist

`DepartureChecklistScreen.tsx` seeds dozens of pizza-service items (pizza boxes, peels, dough mixer, chimney, basil, label cards, cash float). `TruckManagementScreen.tsx` is a festival-truck runbook (diesel, water, oven, dough drawers). The feature is “shared checklist”; the content is Pizza Wala’s truck.

---

## 6. Mixed Concerns

| Area | What is generic | What is Pizza Wala or single-tenant |
|---|---|---|
| `firebase.ts` | Auth helpers, storage upload refs | Project config, `team-1`, web SDK `db` export |
| `useAuth.ts` | Session and disabled-user handling | Bootstrap emails, forced `teamId: 'team-1'`, web Firestore |
| `shifts.ts` | Period model | `getTeamId()` fallback `'team-1'` |
| `ChatScreen.tsx` | DM and event-thread pattern | Team room path frozen at `chats/team-1/messages` |
| `schedulePdf.ts` | PDF table and share | Title, footer, Vercel URL, Cloud Function host, filename |
| `hygiene.ts` | Logs, files, CSV columns | Truck cooler names, `PizzaWala-hygiene` filename, `team-1` fallback |
| `germanEmployeeCompliance.ts` | “required documents” mechanism | German legal field set baked into every profile |
| Truck and departure screens | Shared checklist documents | Pizza truck copy and doc id `team-1` |
| Theme | Token-based styling | Palette and component names (`PizzaFire*`) used by almost every screen |
| Cloud Functions | Inbox fan-out | Chat trigger path, birthday copy, bucket name, admin emails |
| Native geofence | Region monitoring | Package `com.djtranscendence.pizzawala`, channel ids, notification wording |
| Home / Working Hours | Shift UI | **[feature branch]** driving category added inside the same screens and the same shift document, not as a plugin |

There is no `src/config/` on `main`. **[feature branch]** `src/config/buildFeatures.ts` is a build flag file, not a company profile.

---

## 7. Firebase Data Model

Project: `pizza-wala-team`. No `collectionGroup` queries. No `firestore.indexes.json` in the repo.

Rules today (`firestore.rules`):

- `chats/{roomId}/messages/{id}` — signed-in admin, or `user.teamId == roomId`, or a DM id that contains the uid.
- `chats/events/threads/{eventId}/messages/{id}` — admin, or uid is in `events/{eventId}.staffIds`.
- `/{document=**}` — **any signed-in user, full read and write.**

That catch-all is the effective rule for every collection below. Chat rules do not protect anything else.

Auth: email/password only. No anonymous auth. No custom claims. Admin means `users.roles` contains `'admin'`, or the email is on the bootstrap list. Both checks are client-side, plus `assertAdmin` in Cloud Functions, which reads the same client-writable `roles` array.

### Firestore

Scope: **G** global, **U** per user path, **T** has a `teamId` field that queries usually ignore.

| Path | Stores | Writers | Readers | Scope | `teamId`? | Safe for a second company? |
|---|---|---|---|---|---|---|
| `users/{uid}` | Profile, email, roles, `teamId`, `disabled`, `germanCompliance` (address, birth, tax id, social security), `fcmToken`, `lastLocation`, `lastSeenAt`, `online`, avatars, `requiredDocuments` | `firebase.ts`, `useAuth.ts`, profile, manage users, presence, location, push | Home, team map, chat, events, every admin screen | U/T | yes, default `team-1` | No. Any user can `onSnapshot` the whole collection. |
| `users/{uid}/notifications/{id}` | `{ title, body, nav }` | `AssignShiftsScreen`, Cloud Functions | Function trigger, client | U | no | No. Catch-all allows cross-user reads and writes. |
| `users/{uid}/chatReads/{eventId}` | Last-read marker | Chat, Events | same | U | no | No. |
| `chats/team-1/messages/{id}` | Team chat, optional photo | `ChatScreen`, `teamChatMessages()` | same; function `notifyTeamChatMessage` | T | path is the team | No. Path and function are frozen. A second team gets no push, and the catch-all is not what gates this collection — the chat rule does — but the room id is not dynamic. |
| `chats/{uidA_uidB}/messages/{id}` | DMs | `ChatScreen` | participants (and admins) via rules | U | no | DM rule is the one careful rule. Still global, not under a team. |
| `chats/events/threads/{eventId}/messages/{id}` | Event chat | `ChatScreen`, `EventsScreen` | staff or admin | event | no | Events themselves are global, so staff checks do not isolate companies. |
| `events/{id}` | title, days, location, `staffIds`, notes, season | `EventsScreen` | Events, chat, availability, **[feature]** receipts | G | no on `main` | No. |
| `events/{id}/availability/{uid}` | available flag, notes | Events, Admin Availability | same | U under event | no | No. |
| `shifts/{id}` | Live: `userId`, `teamId`, geofence, status, periods, pause, lock. Scheduled: `userId`, `worksiteName`, `date`, times, `isScheduled` — **no `teamId`**. Manual: closed `startAt`/`endAt`, `manual: true` — **no periods, no `teamId`**. | `shifts.ts`, Assign Shifts, Manual Entry, offline sync | Home, My Schedule, Working Hours, admin overview, geofence processor | mixed | only live shifts | No. List queries are unfiltered. |
| `geofences/{id}` | name, centre, radius, active, `teamId`, `createdBy` | `GeofencesScreen` | Home, Shift Setup, monitors, assign, debug | T | yes | No. Queries are `collection('geofences')`. |
| `geofenceEvents/{id}` | transition telemetry | `geofencing/processor.ts` | debug | T | yes | No. |
| `hygieneCredentials/{id}` | file metadata, `employeeUid`, education due date, `teamId` | `hygiene.ts`; reminder function updates fields | Hygiene, Admin Hygiene, Manage Users, Home, Required Documents, preload | T | yes | No. |
| `hygieneTemperatureLogs/{id}` | temperature, target, actor, `monthKey`, `teamId` | `hygiene.ts`, `offline/sync.ts` | Hygiene screens, preload (`limit` without team) | T | yes | No. |
| `hygieneExports/{id}` | monthly CSV metadata | `hygiene.ts` | Hygiene screen | G | no | No. |
| `awards/{id}` | from, to, reason, `teamId` | `AwardMedalScreen` | Hall of Fame; function notify | T | yes | No. Absent as a screen on the feature branch; data and function remain. |
| `appConfig/userRequiredDocuments` | `{ options: string[] }` | Manage Users | preload, Manage Users | G | doc id | One global list. |
| `appConfig/campsite` | name and centre | Geofences | Geofences | G | doc id | One global pin. |
| `departureChecklist/team-1` | shared checklist | Departure screen | same | doc id is the team | path | Second team needs a new id and code change. |
| `truckManagement/team-1` | shared answers | Truck screen | same | doc id is the team | path | Same. |
| `scheduleExports/{id}` | PDF metadata | `schedulePdf.ts` | schedule UI | G | no | No. |

**[feature branch] additional paths**

| Path | Stores | Notes |
|---|---|---|
| `receipts/{id}` | user, `teamId`, type `versorgung` or `firma`, amounts, merchant, pages, recognition | Global collection. Queries by `userId` on the member screen; admin screen listens to the entire collection. |
| `hygieneSettings/{teamId}` | cooling unit config | Doc id is the team. Still world-readable under the catch-all. |
| `hygieneDocumentFolders/{userId}` | custom folder labels | Per user, not per team. |
| `appConfig/eventSeasons` | current season id | Global. |
| `seasons/{id}` | season name | Global. Events gain `seasonId`. |

### Storage

| Path | Rule on `main` | Who should own it |
|---|---|---|
| `hygiene/{userId}/credentials/{file}` | any signed-in user, read and write | That user, plus admins of **their** team |
| `hygiene/exports/{month}/{file}` | read: any signed-in; write: admin | Team admins |
| `schedules/exports/{file}` | read: any signed-in; write: admin | Team admins |
| `chatImages/{userId}/{file}` | read: any signed-in; write: owner | Team members |
| `users/{userId}/photos/{file}` | read: any signed-in; write: owner | Owner; team may need to see avatars |
| `receipts/{teamId}/{userId}/{file}` | **no rule on `main`** (upload denied by default) | **[feature branch]** owner or `isAdmin()`, and `isAdmin()` trusts `users.roles` |

Download URLs are long-lived tokens. A URL copied out of a document is not team-scoped.

### Could Company A read Company B?

Yes, with the current rules and paths, as soon as a second company’s users exist in the same project:

1. The catch-all lets any account read and write `users`, `shifts`, `events`, `geofences`, hygiene, receipts, and locations.
2. Almost every list query omits `where('teamId' == …)`.
3. Scheduled and manual shifts do not store `teamId` at all.
4. Team chat, truck, departure, and the chat Cloud Function are pinned to `team-1`.
5. Hygiene files for every employee are readable by every account.
6. Admin is a self-writable field, so “admin-only” storage rules do not create a trust boundary.

---

## 8. Multi-Tenant Risks

Target shape later: `teams/{teamId}/...` plus membership, not a `teamId` field on global collections. Nothing here implements that.

### Firestore and Storage

Every path in section 7 is global. Adding a company by writing `teamId: 'company-b'` on new users does not hide company A’s shifts, events, documents, or files.

Chat is the partial exception and is also the trap: the function only listens to `chats/team-1/messages`. A second room would store messages and never notify.

### Auth and roles

One Firebase Auth project. A person who works for two companies cannot have two memberships. `users/{uid}` is the membership. Bootstrap emails become admin of the whole project, which would mean admin of every company.

There is no server-side membership check on client reads.

### Background work

- Geofence cache (`geofence_cache`) stores whatever worksites were last loaded, with no team key.
- Headless geofence processing uses the last cached user id (`geofence_last_user_id`) and can start or end a shift after the UI is gone.
- `hygieneEducationReminderSweep` scans all credentials and notifies all admins.
- **[feature branch]** birthday sweep groups by `teamId` but falls back to `team-1`, and still reads all users.
- `notifyTeamChatMessage` reads the entire `users` collection on every team message.

### Local data that must not survive a team switch

None of these keys include a team id:

| Key | Contents |
|---|---|
| `offline_outbox_v1` | Queued shift and temperature writes. Payloads may contain a `teamId`, but the queue is device-global. |
| `offline_open_shift_v1` | The open shift mirror. |
| `geofence_cache` and `geofence_state_{id}` | Worksites and enter/exit memory. |
| `geofence_pending_prompt`, notification history, mute-until | Prompts for the last team’s sites. |
| `geofence_last_user_id`, `geofence_last_user_name` | Last signed-in person. |
| `truck_management_progress_v1` | Local step index. Cloud doc is still `team-1`. |
| `scheduleExportWhatsAppPhones` | Phone numbers. |
| **[feature branch]** `pizzawala.documentsIntroSeen.{userId}` | Intro flag, brand-prefixed, not team-prefixed. |
| **[feature branch]** shift-end reminder keys | Per shift id, not per team. |

Also: native Firestore persistence is `CACHE_SIZE_UNLIMITED` (`src/offline/initFirestore.ts`). Android `GeofencePrefs` (`pizzawala_geofences`) keeps region specs outside AsyncStorage. Signing out does not, from this inspection, wipe those stores. A second login on the same phone can show or sync the previous team’s cached shifts, worksites, and outbox.

### UI

Admin screens assume one workforce. Team map plots every user. Manage Users lists every user. There is no team switcher and no membership collection.

---

## 9. Redundant / Duplicate Code

Do not consolidate during this audit.

### Two Firebase clients

| Location | SDK | Active? | Notes |
|---|---|---|---|
| `src/services/firebase.ts` `initializeApp` + exported `db` | Web Firestore | Yes | Comment in the same file: web `db` is not signed in with native Auth. |
| `src/services/firebase.ts` `getRNFirestore`, `nativeAuth` | React Native Firebase | Yes | This is the session that can satisfy `request.auth`. |
| `index.js` | `@react-native-firebase/app` | Yes | Native bootstrap. |
| `functions/index.js` | Admin SDK | Server | Separate process. Fine. |

Web `db` is imported by:

- `src/auth/useAuth.ts` — the profile listener that decides admin vs user
- `src/screens/AdminCalendarScreen.tsx`
- `src/screens/AdminOptionsScreen.tsx`
- `src/screens/ManualShiftEntryScreen.tsx`
- `src/screens/WorksiteFinderScreen.tsx`

Account creation was already moved to native Firestore because the web client could not write a visible user document. The profile listener was not moved with it. That is the worse of the two clients for anything that depends on security rules.

### Auth listeners

Each calls `onAuthStateChanged` for its own side effect: `useAuth.ts`, `OfflineContext.tsx`, `GeofenceMonitor.tsx`, `LocationMonitor.tsx`, `PresenceMonitor.tsx`, `HomeScreen.tsx`. Home also re-derives admin from the profile. They unsubscribe in cleanup. The duplication is extra reads and a second definition of “admin”, not a leaked subscription in the code paths reviewed.

### Admin checks

`useAuth.ts` (bootstrap emails or `roles`), `HomeScreen.tsx` (auth status or a second profile flag), `EventsScreen.tsx` (auth status), `GeofencesScreen.tsx` (own snapshot of `roles`), `ChatScreen.tsx` (local flag), `hygiene.ts` (roles array). Rules do not enforce these except inside the chat helpers, which the catch-all bypasses for non-chat data.

### Duration math

| Implementation | File | Behaviour |
|---|---|---|
| `calcWorkedMs` / `calcBreakMs` / `calcWorkedMsInRange` | `src/services/shifts.ts` | Canonical. Work periods, or span minus breaks for legacy docs. |
| Day clip | `src/utils/workingHours.ts` | Clips periods to local midnight + 24h. Used by Working Hours. |
| `formatElapsed` | `WorksiteOverviewScreen.tsx` | Wall clock from `startAt`. Includes breaks. |
| `calculateHours` | `ManualShiftEntryScreen.tsx` | `(end-start)/3600000`. No breaks, no periods. |
| `localDateKey` copies | `workingHours.ts`, `hygiene.ts`, `MyScheduleScreen.tsx`, `EditProfileScreen.tsx`, and **[feature branch]** `daySummary.ts` | Same calendar-day idea, separate functions. |
| **[feature branch]** `dailyShiftBreakdown` | `src/utils/daySummary.ts` | Sums full work periods for shifts whose **start** date matches. Does not clip to the day. |
| **[feature branch]** `buildMonthlyTimesheetRows` | `src/services/monthlyTimesheetPdf.ts` | Groups by start date + category. Sums `calcWorkedMs`. Start/End columns are the envelope of every period that day. |

`formatCompactDuration` and `isLiveShiftRecord` in `shifts.ts` are exported and unused on `main`.

### Distance

`getDistanceMeters` in `src/utils/geo.ts` is the shared haversine. Local copies also exist in `GeofenceMonitor.tsx`, `WorksiteFinderScreen.tsx`, `GeofenceDebugScreen.tsx`, `ShiftSetupScreen.tsx`, and `MyScheduleScreen.tsx`. The formula matches. `effectiveRadius.ts` is the one place that enforces the 200 m floor; the copies do not all go through it.

### Uploads

`src/utils/storageUpload.ts` (`putFileAndGetDownloadUrl`) is the shared helper and is used for hygiene, chat, and profile photos. Bucket fallback (new bucket, then legacy appspot) is intentional.

### Permissions and notifications

Location prompts are centralized in `requestLocationForFeature` (`geo.ts`) and also described again in `PermissionsScreen.tsx`. Notification permission is requested from `AppNavigator`, `pushRegistration.ts`, `PermissionsScreen`, and `GeofenceMonitor`. Routing itself is centralized in `notificationRouting.ts`.

### Geolocation libraries

`react-native-geolocation-service` is what the app imports. `@react-native-community/geolocation` is in `package.json` and `ios/Podfile.lock` and is not imported from `src/`. Both solve device location.

### PDF / CSV

One schedule PDF (`schedulePdf.ts`), one hygiene CSV (`hygiene.ts`), one events CSV **import** (`parseEventsCsv.ts`). **[feature branch]** adds a second PDF generator (`monthlyTimesheetPdf.ts`) that does not share row-building with `workingHours.ts` or `daySummary.ts`.

---

## 10. Legacy / Dead Code Candidates

Nothing here should be deleted as part of this audit.

| Item | Why it looks unused | Risk if removed blindly |
|---|---|---|
| `src/screens/DriverLogin.tsx` | Not registered in the navigator. Renders the text “Driver Login”. | None on `main`, but confirm no deep link. |
| `src/services/geofenceService.ts.rtf` | RTF notes sitting in `services/`. Not imported. | None. |
| `ManualShiftEntry` route | Screen is registered. No `navigate('ManualShiftEntry')` caller was found. Writes a different shift shape through the web SDK. | May still be reachable if something navigates by string from a place this search missed. The data shape is live if anyone opens it. |
| `formatCompactDuration`, `isLiveShiftRecord` | Exported, no callers on `main`. | Low. |
| `notes.md` | Geofence handoff from April 2026. Some bullets are already implemented (manifest permissions exist). | Historical. |
| `scratch/promote_admin.js` | Gitignored. One-off admin promotion. | Do not ship it. |
| Awards screens vs feature branch | Present on `main`, deleted on the feature branch, while `notifyAwardRecipient` still exists in both function files. | Production `awards` data may still exist. |
| `@react-native-community/geolocation` | Dependency without `src` imports. | iOS Podfile still links it. Removal is a native change; out of scope. |
| `@react-native/new-app-screen` | No `src` import found. | Template leftover. |
| Editor-index files that are not on `main` | Receipts, day summary, timesheet, birthday, hygiene folders. | They are the feature branch, not dead code. Do not “clean them up” from `main` by deleting; they are not in this checkout. |
| `functions` award + birthday together | Feature branch has both. `main` has awards only. | Deploying functions from the wrong branch changes production triggers. |

`GeofenceDebugScreen` is debug UI but it is linked from Admin Options, so it is reachable in production builds.

Tests on `main`: only `__tests__/App.test.tsx`. The feature branch carries the unit tests for hours, receipts, day summary, hygiene folders, and birthdays. Those tests are not protecting `main`.

---

## 11. Technical Problem Points

| Severity | Issue | Impact |
|---|---|---|
| Critical | `main` and `feature/ios-release-refresh` are both “the app” and neither contains the other. | Extracting a framework from the checkout drops receipts, driving, timesheets, birthdays, and the iOS 2.6 shift work. Extracting from the feature branch drops awards and diverges from the commit that was labelled the authoritative source. |
| Critical | Firestore catch-all plus client-writable `roles`. | Any employee can read everyone’s data and can set `roles: ['admin']` on their own user document. Cloud Functions will then treat them as admin. |
| High | Web Firestore used for the auth profile while Auth is native. | `useAuth` may fail to read the profile (error callback forces status `'user'`), so a real admin can be treated as a member, or the listener can see an empty cache. Manual shift writes use the same unsigned client. |
| High | `team-1` compiled into chat, functions, truck, checklist, and account creation. | A second team silently gets no chat push and shares or misses the truck document. |
| High | Live, scheduled, and manual shifts are three shapes in one collection. | Totals depend on `normalizeShiftPeriods` inventing a single work period when `workPeriods` is missing. Manual rows have no breaks, no lock, no `teamId`. Scheduled rows are not worked time but live in `shifts`. |
| High | Working Hours history query is `where('userId')` + `limit(50)` with no `orderBy` (`WorkingHoursScreen.tsx`). | A busy month can omit days. Totals on screen are totals of whichever 50 documents came back. |
| High | Unlimited Firestore disk cache and geofence prefs are not cleared on sign-out or team change. | Stale shifts and worksites after switching account. |
| Medium | Day bounds use midnight + 24h ms (`workingHours.ts`). | DST days are 23h or 25h. A period can be clipped short or long. No named timezone; the device zone is the zone. |
| Medium | Offline end stores period times from the device and `endAt: serverTimestamp()` on sync. | Span and period sums can disagree by the time spent offline. |
| Medium | Screens own their Firestore listeners. Several god-screens exceed 1,000 lines. | A path or rules change has to be repeated in every screen. Easy to miss a listener. |
| Medium | iOS bundle id `com.pizzawala.app` vs Android `com.djtranscendence.pizzawala`. | Two Firebase app registrations, two push setups, easy to ship a binary against the wrong plist. |
| Medium | No committed Firestore indexes. | Composite queries can fail in production until an index is created by hand. |
| Low | Map picker defaults to Los Angeles. | New worksites start from the wrong continent if GPS is denied. |
| Low | `notifyTeamChatMessage` reads every user document per message. | Cost and latency. Also a full-directory read on the server. |

Listeners reviewed (`useAuth`, monitors, screen `useEffect` subscriptions) return unsubscribe functions. The problem is how many of them exist and that they subscribe to whole collections (`users`, `shifts`, `geofences`, `hygieneTemperatureLogs`), not that they are obviously leaked.

---

## 12. Security Findings

Client Firebase config (apiKey, project id, app id) is not listed as a secret. It is required in the binary.

### CRITICAL

1. **Any signed-in user can read and write almost all Firestore data.** `firestore.rules` lines 46–49, `match /{document=**}`. This includes other employees’ tax ids, addresses, birth dates, social security numbers, locations, shifts, events, and hygiene metadata. It includes the ability to edit or delete those documents.

2. **Any signed-in user can grant themselves admin.** `users/{uid}.roles` is covered by the catch-all. `assertAdmin` in `functions/index.js` trusts that array, and also trusts three personal Gmail addresses. There are no custom claims.

3. **Hygiene files are world-readable inside the project.** `storage.rules` allows any signed-in user to read and write `hygiene/{userId}/credentials/*`. Those files are ID scans, health-insurance proof, signed contracts, and hygiene cards.

### HIGH

4. **Team map and `LocationMonitor` publish `lastLocation` on the user document**, which every account can read.

5. **Admin-only Storage writes are not a real boundary** while admin is a client-writable field. Schedule exports and hygiene CSVs are readable by every account even when the write rule is tighter.

6. **Bootstrap emails are global superusers** of this Firebase project. Copied into a multi-company app, those inboxes are admin of every tenant. They also sit in the client bundle, so the allowlist is public.

7. **Receipt objects on the feature branch** are in a global `receipts` collection. The feature-branch storage rule lets the owner or an “admin” through. Combined with finding 2, any user who flips their role can read every company’s receipts. `main` has no receipts rule at all, so those uploads fail closed until someone deploys the feature-branch rules.

8. **Chat images and profile photos are readable by every signed-in user.** Writes are owner-scoped. Reads are not.

### MEDIUM

9. **Event chat rules trust `events.staffIds`**, and any signed-in user can edit any event, including `staffIds`, because of the catch-all. The careful chat rule can be bypassed by editing the event first.

10. **Download URLs** stored on credential, export, and chat documents are bearer tokens. Rules do not revoke a URL that was already issued.

11. **`enhanceDocumentImage` is callable by any signed-in user** and runs Sharp on uploaded bytes. Low direct data exposure; it is an unauthenticated-to-team compute endpoint once any account exists.

12. **German compliance fields** are more sensitive than a normal profile and are stored on the same world-readable user document.

### LOW

13. **Debug screen** can trigger geofence transitions in a production build (Admin Options).

14. **User-Agent `PizzaWala/1.0`** on the map geocoder request. Not a credential.

15. **Legacy storage bucket** is still referenced. Old objects may remain readable under older rules if that bucket is still open.

---

## 13. Working Hours Findings

### Lifecycle on `main`

1. Clock in — `HomeScreen`, `MyScheduleScreen`, `ShiftSetupScreen`, or geofence enter in `geofencing/processor.ts` → `startLiveShift`.
2. Worksite — `geofenceId` / `geofenceName` on the shift. Scheduled shifts use `worksiteName` instead and are a different document shape.
3. Active shift — open `workPeriods`, `status: 'open'`.
4. Breaks — `pauseLiveShift` / `resumeLiveShift` close the open work period and open a break period.
5. Driving — **not on `main`.** **[feature branch]** `workCategory: 'driving'` on the whole shift, chosen from Home and Shift Setup. It is not a separate period type.
6. Clock out — `endLiveShift` / `endLiveShiftForUser`. Sets `locked: true`.
7. Daily view — `WorkingHoursScreen` shows the last 7 local dates via `totalWorkedMsForDay` and `buildDayTimeEntries`.
8. Edits — `updateShiftPeriodTimes` stores originals and `manuallyEdited`. Blocked when locked or when the period is still open.
9. History — same screen, `limit(50)` shifts for that user. My Schedule groups by start date. Worksite Overview has a month window using `calcWorkedMsInRange`.
10. Export — **no hours CSV or PDF on `main`.** Schedule PDF is the rota, not worked time. Hygiene CSV is temperatures.

**[feature branch]** inserts a day-summary confirm (`DaySummaryModal` + `daySummary.ts`) and a monthly PDF (`monthlyTimesheetPdf.ts`) after the daily data exists. Geofence and offline paths also pass `workCategory`.

### One function, several interpretations

`calcWorkedMs` is the shared definition: sum of work periods, or span minus breaks when the document has no `workPeriods`.

The Working Hours screen then **clips** those periods to the local calendar day (`dayBoundsMs` = local midnight plus 24 hours). An overnight shift contributes to both days.

The feature-branch day summary and monthly PDF do **not** clip. `shiftOverlapsDate` keeps a shift only when the start date matches, then adds the **entire** worked duration to that date. Overnight work appears on two days in Working Hours and on the start day only in the PDF.

The monthly PDF then merges every working shift that started that day into one row. The Start and End columns are the earliest start and latest end, so a gap between two shifts looks like one continuous span. The Working time column is the sum of `calcWorkedMs`, so it can be shorter than End minus Start. Breaks are added for “Working” rows and forced to 0 for “Driving” rows.

`dailyShiftBreakdown` drops a shift under 60 seconds (`MIN_ACCOUNTABLE_SHIFT_MS`). Working Hours does not.

`totalActualMs` on the day-summary rows sums confirmed start-to-end ranges. That is wall time of the rows the user confirmed, not `calcWorkedMs`.

### Other discrepancies

| Case | What the code does |
|---|---|
| Admin open timer | `formatElapsed` in `WorksiteOverviewScreen.tsx` counts from `startAt` and includes breaks. Employee timers use `calcWorkedMs`. |
| Multiple shifts per day | Supported by the period model and by Working Hours. The monthly PDF collapses them per category. |
| Manual entry | Forbids end ≤ start on the same calendar date, so it cannot record overnight. Writes no periods. `normalizeShiftPeriods` later invents one work period from `startAt`/`endAt`. Uses web Firestore `db`. |
| Edited shifts | Working Hours uses the edited period. Exports that call `calcWorkedMs` follow the edited periods too, as long as they load the same document. The PDF envelope still uses min/max of period ends, not the edited display rows. |
| Timezone | Local device timezone. ISO strings are UTC. `new Date(\`${dateKey}T${time}\`)` parses as local. Two phones in two zones can split a shift on different dates. |
| DST | Fixed 24h day window. No Europe/Berlin zone is pinned, despite the timesheet saying “Pizza Wala Berlin”. |
| Month boundary | PDF keeps a shift in the month of its start instant only. Hours after midnight on the 1st stay in the previous month. Working Hours would show them on the 1st. |
| Events | Events are not the worksite. A shift stores a geofence name. A scheduled row stores `worksiteName`. Overview and history have to accept both. |
| Driving | Counted as worked milliseconds with a different label. It is excluded from the worksite breakdown and included in the PDF “Working time” column under Activity “Driving”. |

`main` has no export to disagree with the UI. The disagreement appears as soon as the feature branch PDF is treated as the official timesheet.

---

## 14. Dependency / Native Findings

No upgrades were performed.

### Duplicate or likely unused libraries

| Package | Observation |
|---|---|
| `firebase` and `@react-native-firebase/*` | Both are required by current code. The web SDK is the one to retire later, not the native one. |
| `@react-native-community/geolocation` and `react-native-geolocation-service` | App imports only `react-native-geolocation-service`. The community package is still in the iOS Pod lockfile. |
| `@react-native/new-app-screen` | No source import found. Template dependency. |
| `react-native-image-picker` and `react-native-image-crop-picker` | Both are used (picker vs crop/scan prep). Overlapping, not unused. |
| `jspdf` | Used. Heavy for a mobile binary. One of the few pure-JS PDF options that avoids extra native code. |

### Native surface that makes builds fragile

- Custom Kotlin geofence package registered in `MainApplication.kt`, with a foreground service, boot receiver, and WorkManager. **[feature branch]** adds another foreground service for the ongoing shift notification.
- `patches/@react-native+gradle-plugin+0.83.1.patch` via `patch-package`. A clean install without `postinstall` will not match the current Android build.
- Android Maps key is expected from Gradle config (`local.properties` / CI), not committed. That is correct. A machine without it fails the maps build.
- iOS `GoogleService-Info.plist` is gitignored. A clean clone does not contain the iOS Firebase config.
- New Architecture is enabled on iOS (`RCTNewArchEnabled`). Native modules have to match.
- Hermes / RN 0.83 / React 19 is a narrow toolchain. The audit did not try to move it.
- Application ids differ by platform (section 5). Firebase Android clients exist for both `com.djtranscendence.pizzawala` and `.debug`.
- FileProvider path XML: `res/xml/pizzawala_file_paths.xml`.
- Document scanner and image crop picker need their own permissions and, on iOS, photo/camera usage strings that currently say “PizzaWala”.

### Abandoned architecture

The web Firestore client is the leftover of an earlier integration. The RTF file `geofenceService.ts.rtf` is an abandoned notes dump. `DriverLogin.tsx` is an abandoned entry screen. Awards are mid-removal across branches.

---

## 15. Recommended Target Architecture

Do not build this yet. This is the shape to aim at after the branch decision.

```
apps/team/                      React Native shell
  brand/                        name, logo, colours, locale — loaded, not imported as Pizza Wala
  navigation/
  features/                     hours, worksites, events, chat, documents, hygiene, expenses, notifications
  data/                         the only place that calls Firestore or Storage
  auth/
  offline/

packages/domain/                shift math, day clipping, money, CSV/PDF row models
                                no Firebase imports, no company name

teams/{teamId}/                 Firestore and Storage root
  members/{uid}
  settings                      name, logo path, categories, checklist seeds, compliance pack id
  worksites/{id}
  shifts/{id}
  events/{id}
  documents/{id}
  hygieneLogs/{id}
  expenses/{id}
  chat/...
```

Rules: deny by default. Membership is `teams/{teamId}/members/{uid}` written only by trusted server code or a claim. Admin is a membership role, not a field the member can set on themselves. Client queries are always under `teams/{teamId}`.

Auth stays email/password (or the host’s chosen provider) in a project that is allowed to hold more than one team. A user can be a member of more than one team. The active team id is explicit state. Changing it clears Firestore cache, AsyncStorage prefixes, and native geofence prefs before the next listener starts.

Company configuration is a document, including:

- display name, logo, colours
- document categories and which compliance pack is on
- receipt categories
- hygiene targets and folder labels
- checklist templates (the pizza truck list becomes Pizza Wala’s seed data, not source)
- PDF header lines
- notification product name

Pizza Wala becomes the first seed of that document, in the existing project, without renaming the Android package until a store listing actually needs it.

Hours math lives in one module used by the timer, the day screen, the day summary, and the PDF. Driving is a category on a period or on a shift, and every view states whether it is inside or outside “worked”. Overnight policy is one policy: clip to the civil day in a configured timezone (`Europe/Berlin` for Pizza Wala), including DST.

---

## 16. Recommended Migration Order

Conservative on purpose. The live Pizza Wala app keeps working at every step.

1. **Choose the authoritative tree.** Diff `main` and `feature/ios-release-refresh`, decide which behaviours are in the product (receipts, driving, timesheet, birthday, awards), and merge them into one branch. Do not start a framework repo from a tree that is missing half the product.

2. **Freeze a data inventory of production `pizza-wala-team`.** Collection list, document counts, whether `teamId` is missing on shifts. No writes.

3. **Write the target rules in the emulator only.** Prove that a normal member cannot read another team and cannot set their own role. Do not deploy those rules onto the live project yet. The current app would break, because it depends on the catch-all.

4. **Extract pure functions without moving screens.** Shift math, day clipping, CSV row builders, receipt totals. Point the existing screens at those functions. Behaviour stays identical, including the known overnight quirk, until step 8.

5. **Introduce a single data-access module** that still uses today’s collection names. Screens stop calling Firestore directly. This is the seam that later gains a `teamId` prefix.

6. **Add an explicit team context** that reads `users/{uid}.teamId` and still resolves to `team-1`. Replace hardcoded `'team-1'` string literals with that value. Chat path, truck doc id, checklist doc id, and the Cloud Function trigger must change in the same release or chat push breaks.

7. **Namespace local storage** (`team:{teamId}:…`) and clear the previous prefix, the Firestore cache, and geofence prefs on sign-out and on team change. Still one team in production, so this is a no-op for current users except a one-time cache clear that must be tested on a real device.

8. **Unify hours reporting** so Working Hours, day summary, and PDF call one function. Decide overnight and driving rules with the operator before changing numbers employees already saw.

9. **Move company copy into a settings document** (name, categories, checklist seeds, PDF header) while the app is still single-tenant. Pizza Wala’s current lists become the default seed.

10. **Only then** create `teams/{pizzaWalaId}/...` in a copy or a new project, backfill, and switch the data module. Deploy matching rules in the same change. Keep the old collections read-only until a full month of shifts has been compared.

11. **Leave package ids, the Firebase project, and the store listing alone** until a second company is actually ready to install a binary. A white-label build is a later step, not part of making the data model safe.

---

## 17. "DO NOT TOUCH YET" List

| Area | Why it waits |
|---|---|
| `firestore.rules` and `storage.rules` on the live project | Tightening them before the app stops reading global collections will lock out the current team. |
| Firebase project `pizza-wala-team`, bucket names, Android application id, iOS bundle id | Store builds, push, and existing files depend on them. |
| `src/services/shifts.ts` period fields and `src/offline/sync.ts` | Offline phones already have queued writes in today’s shape. |
| Android and iOS geofence modules | Background entry/exit is the fragile part of the product. Rename and package moves belong after the JS contract is stable. |
| `functions/index.js` chat trigger path | Must change together with the client chat path, or messages save and nobody is notified. |
| Bootstrap admin emails | Removing them before a real membership role exists can lock out the current operators. |
| Working Hours day clipping vs feature-branch PDF | Changing either changes pay-related numbers. Needs a written rule first. |
| Truck and departure checklist documents | Live shared state in `team-1`. A bad write clears the crew’s pack-out. |
| Hygiene credential files | ID documents. No bulk move, no rule change, until the new path and rules are proven. |
| Branch cleanup that deletes feature-branch files or award screens | They are alternate product lines, not confirmed dead code. |
| Dependency upgrades, React Native upgrades, New Architecture toggles | Out of scope until the extraction seam exists. The Gradle patch is load-bearing. |

---

## Appendix — What must be true before a clean Team App repo exists

1. One branch is declared the product. The other is merged or explicitly retired.
2. Live security rules are no longer “any signed-in user”.
3. Team isolation is in the path and in the rules, not only in a `teamId` field.
4. Local and native caches are keyed by team and cleared on change.
5. Hours shown on screen and hours in the PDF are the same function.
