import Foundation
import CoreLocation
import React
import UserNotifications

@objc(GeofenceModule)
class GeofenceModule: RCTEventEmitter, CLLocationManagerDelegate {
  private let locationManager = CLLocationManager()
  private var hasListeners = false
  private var pendingEvents: [[String: Any]] = []
  private let METADATA_KEY = "com.djtranscendence.pizzawala.geofence.metadata"

  override init() {
    super.init()
    locationManager.delegate = self
    locationManager.desiredAccuracy = kCLLocationAccuracyBest
    locationManager.pausesLocationUpdatesAutomatically = false
    locationManager.allowsBackgroundLocationUpdates = true
    
    // Ensure we are authorized for notifications natively
    let center = UNUserNotificationCenter.current()
    center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
        // completion handler
    }
  }

  @objc override static func requiresMainQueueSetup() -> Bool {
    return true
  }

  override func supportedEvents() -> [String]! {
    return ["geofenceEvent", "significantLocationChange"]
  }

  override func startObserving() {
    hasListeners = true
    flushPending()
  }

  override func stopObserving() {
    hasListeners = false
  }

  @objc func getAvailability(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
#if targetEnvironment(simulator)
    let isSimulator = true
#else
    let isSimulator = false
#endif
    resolve(["available": true, "isEmulator": isSimulator])
  }

  @objc func startMonitoring(_ geofences: [[String: Any]], resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    locationManager.requestAlwaysAuthorization()

    // Store metadata for background launches where JS might not be ready
    var metadata: [String: String] = [:]
    
    for region in locationManager.monitoredRegions {
      locationManager.stopMonitoring(for: region)
    }

    locationManager.startMonitoringSignificantLocationChanges()

    let limited = geofences.prefix(20)
    for item in limited {
      guard let id = item["id"] as? String else { continue }
      guard let latitude = item["latitude"] as? Double else { continue }
      guard let longitude = item["longitude"] as? Double else { continue }
      let name = (item["name"] as? String) ?? id
      let radius = max(200.0, (item["radius"] as? Double) ?? 200.0)


      metadata[id] = name

      let center = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
      let region = CLCircularRegion(center: center, radius: radius, identifier: id)
      region.notifyOnEntry = true
      region.notifyOnExit = true
      locationManager.startMonitoring(for: region)
    }
    
    UserDefaults.standard.set(metadata, forKey: METADATA_KEY)
    UserDefaults.standard.synchronize()

    resolve(nil)
  }

  @objc func stopMonitoring(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    for region in locationManager.monitoredRegions {
      locationManager.stopMonitoring(for: region)
    }
    locationManager.stopMonitoringSignificantLocationChanges()
    UserDefaults.standard.removeObject(forKey: METADATA_KEY)
    resolve(nil)
  }

  @objc func getStoredGeofenceSpecs(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    var out: [[String: Any]] = []
    let metadata = UserDefaults.standard.dictionary(forKey: METADATA_KEY) as? [String: String]
    
    for region in locationManager.monitoredRegions {
      guard let circular = region as? CLCircularRegion else { continue }
      out.append([
        "id": circular.identifier,
        "name": metadata?[circular.identifier] ?? circular.identifier,
        "latitude": circular.center.latitude,
        "longitude": circular.center.longitude,
        "radius": circular.radius,
      ])
    }
    resolve(out)
  }

  func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
    sendGeofenceEvent(transition: "enter", region: region)
    // showNativeNotificationIfInBackground(transition: "enter", region: region) // Removed for Precision Hybrid
  }

  func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
    sendGeofenceEvent(transition: "exit", region: region)
    // showNativeNotificationIfInBackground(transition: "exit", region: region) // Removed for Precision Hybrid
  }


  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let latest = locations.last else { return }
    sendOrQueue(
      name: "significantLocationChange",
      body: [
        "latitude": latest.coordinate.latitude,
        "longitude": latest.coordinate.longitude,
        "timestamp": latest.timestamp.timeIntervalSince1970 * 1000.0,
      ]
    )
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    // ignore; geofencing will retry
  }

  private func sendGeofenceEvent(transition: String, region: CLRegion) {
    sendOrQueue(
      name: "geofenceEvent",
      body: [
        "geofenceId": region.identifier,
        "transition": transition,
        "timestamp": Date().timeIntervalSince1970 * 1000.0,
      ]
    )
  }

  private func showNativeNotificationIfInBackground(transition: String, region: CLRegion) {
    // Check if app is in background/inactive, which is when JS might be dead.
    // If foreground, we let Notifee handle it in JS.
    DispatchQueue.main.async {
        let state = UIApplication.shared.applicationState
        if state != .active {
            let metadata = UserDefaults.standard.dictionary(forKey: self.METADATA_KEY) as? [String: String]
            let name = metadata?[region.identifier] ?? "a worksite"
            let action = transition == "enter" ? "entered" : "left"
            
            let content = UNMutableNotificationContent()
            content.title = "Worksite update"
            content.body = "You have \(action) the worksite \(name)."
            content.sound = .default
            
            let request = UNNotificationRequest(
                identifier: "\(region.identifier)-\(transition)",
                content: content,
                trigger: nil // Immediate
            )
            UNUserNotificationCenter.current().add(request)
        }
    }
  }

  private func sendOrQueue(name: String, body: [String: Any]) {
    if hasListeners {
      sendEvent(withName: name, body: body)
    } else {
      pendingEvents.append(["name": name, "body": body])
    }
  }

  private func flushPending() {
    if !hasListeners { return }
    pendingEvents.forEach { event in
      guard let name = event["name"] as? String else { return }
      let body = event["body"] as? [String: Any]
      sendEvent(withName: name, body: body)
    }
    pendingEvents.removeAll()
  }
}

