import { Platform, PermissionsAndroid } from 'react-native';

/**
 * Android: `launchImageLibrary` uses the system Photo Picker (PickVisualMedia), which does not
 * require READ_MEDIA_IMAGES / READ_EXTERNAL_STORAGE. Pre-requesting those (and especially CAMERA)
 * caused gallery-only flows to fail when the user denied camera.
 *
 * iOS: Photo/camera access is gated by Info.plist usage strings at the system prompt.
 */
export async function ensureImagePickerPermission(
  source: 'camera' | 'library'
): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  if (source === 'library') {
    return true;
  }
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}
