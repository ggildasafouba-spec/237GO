import React from 'react';

interface LogoProps {
  size?: number;
}

/**
 * Logo 237GO pour le dashboard admin (SVG web).
 * Badge vert avec flèche de mouvement, "237" blanc et "GO" jaune.
 */
export default function Logo({ size = 48 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="adminGoGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2EE066" />
          <stop offset="1" stopColor="#1DB954" />
        </linearGradient>
        <linearGradient id="adminArrowGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FCD116" />
          <stop offset="1" stopColor="#E6B800" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="url(#adminGoGrad)" />
      <path
        d="M22 62 Q50 42 74 50 L68 44 M74 50 L68 56"
        stroke="url(#adminArrowGrad)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <text x="50" y="40" fontSize="26" fontWeight="bold" fill="#FFFFFF" textAnchor="middle">237</text>
      <text x="50" y="82" fontSize="20" fontWeight="bold" fill="#FCD116" textAnchor="middle" letterSpacing="2">GO</text>
    </svg>
  );
}
