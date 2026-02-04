import BackgroundGeolocation from "react-native-background-geolocation";

export function initLocation() {
  BackgroundGeolocation.onGeofence(event => {
    console.log("GEOFENCE", event.identifier, event.action);
  });

  BackgroundGeolocation.ready({
    desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
    distanceFilter: 10,
    stopOnTerminate: false,
    startOnBoot: true,
    foregroundService: true,
    notification: {
      title: "PizzaWala",
      text: "Location tracking active",
    },
    logLevel: BackgroundGeolocation.LOG_LEVEL_VERBOSE,
  }).then(() => {
    BackgroundGeolocation.start();
  });
}
