jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(),
  addEventListener: jest.fn(() => () => {}),
}));

import NetInfo from '@react-native-community/netinfo';
import {
  deviceLooksOnline,
  getConnectionDegraded,
  isDeviceOnline,
  markConnectionHealthy,
  probeDegradedConnection,
  subscribeConnectionDegraded,
} from '../src/offline/connectivity';

const fetchMock = NetInfo.fetch as jest.Mock;

describe('deviceLooksOnline', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    markConnectionHealthy();
  });

  it('returns false when NetInfo hangs past the timeout', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await expect(deviceLooksOnline(20)).resolves.toBe(false);
  });

  it('returns true when the device is connected', async () => {
    fetchMock.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    await expect(isDeviceOnline()).resolves.toBe(true);
    await expect(deviceLooksOnline(50)).resolves.toBe(true);
  });

  it('returns false when the device is disconnected', async () => {
    fetchMock.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    await expect(deviceLooksOnline(50)).resolves.toBe(false);
  });

  it('notifies listeners when a needed request times out', async () => {
    const seen: boolean[] = [];
    const stop = subscribeConnectionDegraded(value => seen.push(value));
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await deviceLooksOnline(20);
    stop();
    expect(seen).toContain(true);
  });

  it('clears the offline hint after a later successful NetInfo fetch', async () => {
    const seen: boolean[] = [];
    const stop = subscribeConnectionDegraded(value => seen.push(value));
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await deviceLooksOnline(20);
    fetchMock.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    await expect(isDeviceOnline()).resolves.toBe(true);
    stop();
    expect(seen[seen.length - 1]).toBe(false);
  });
});

describe('probeDegradedConnection', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    markConnectionHealthy();
  });

  it('does not probe when the offline hint is off', async () => {
    fetchMock.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    await expect(probeDegradedConnection(50)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getConnectionDegraded()).toBe(false);
  });

  it('recovers when degraded and the probe succeeds', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await deviceLooksOnline(20);
    expect(getConnectionDegraded()).toBe(true);
    fetchMock.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    await expect(probeDegradedConnection(50)).resolves.toBe(true);
    expect(getConnectionDegraded()).toBe(false);
  });

  it('stays offline when degraded and the probe fails', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await deviceLooksOnline(20);
    await expect(probeDegradedConnection(20)).resolves.toBe(false);
    expect(getConnectionDegraded()).toBe(true);
  });
});
