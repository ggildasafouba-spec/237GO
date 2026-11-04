import React from 'react';
import { Image } from 'react-native';

interface LogoProps {
  size?: number;
  variant?: 'light' | 'dark';
  badge?: boolean;
}

/**
 * Logo officiel 237GO.
 */
export default function Logo({ size = 96 }: LogoProps) {
  return (
    <Image
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      source={require('../../assets/icon.png')}
      style={{ width: size, height: size, resizeMode: 'contain' }}
      accessibilityLabel="Logo 237GO"
    />
  );
}
