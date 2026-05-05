import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './AppNavigator';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export const navigate = <T extends keyof RootStackParamList>(
  name: T,
  params?: RootStackParamList[T]
) => {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate(name, params as never);
};
