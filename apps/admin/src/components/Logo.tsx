import React from 'react';

interface LogoProps {
  size?: number;
}

/**
 * Logo officiel 237GO.
 */
export default function Logo({ size = 48 }: LogoProps) {
  return (
    <img
      src="/icon-512.png"
      alt="237GO"
      width={size}
      height={size}
      style={{ objectFit: 'contain', borderRadius: 8 }}
    />
  );
}
