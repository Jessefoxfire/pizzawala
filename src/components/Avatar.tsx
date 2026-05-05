import React from 'react';
import { Image, StyleSheet } from 'react-native';
import { Avatars, AvatarKey } from '../../assets/avatars';

type Props = {
  name: AvatarKey;
  size?: number;
};

export default function Avatar({ name, size = 64 }: Props) {
  return (
    <Image
      source={Avatars[name]}
      style={[
        styles.image,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  image: {
    resizeMode: 'cover',
  },
});
