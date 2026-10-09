import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path, Text as SvgText, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { colors } from '../theme';

interface LogoProps {
  size?: number;
  /** 'light' pour fond sombre (texte blanc), 'dark' pour fond clair (texte foncé) */
  variant?: 'light' | 'dark';
  /** Afficher le badge rond autour */
  badge?: boolean;
}

/**
 * Logo 237GO : un badge dynamique évoquant le mouvement (flèche/route)
 * aux couleurs du Cameroun (vert + jaune).
 */
export default function Logo({ size = 96, variant = 'light', badge = true }: LogoProps) {
  const textColor = variant === 'light' ? '#FFFFFF' : colors.primaryDark;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <SvgGradient id="goGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.primaryLight} />
            <Stop offset="1" stopColor={colors.primary} />
          </SvgGradient>
          <SvgGradient id="arrowGrad" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={colors.secondary} />
            <Stop offset="1" stopColor={colors.secondaryDark} />
          </SvgGradient>
        </Defs>

        {/* Badge rond */}
        {badge && (
          <Circle cx="50" cy="50" r="48" fill="url(#goGrad)" />
        )}

        {/* Flèche de mouvement (évoque la route / le déplacement) */}
        <Path
          d="M22 62 Q50 42 74 50 L68 44 M74 50 L68 56"
          stroke="url(#arrowGrad)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/* Texte 237 */}
        <SvgText
          x="50"
          y="40"
          fontSize="26"
          fontWeight="bold"
          fill={textColor}
          textAnchor="middle"
        >
          237
        </SvgText>

        {/* Texte GO */}
        <SvgText
          x="50"
          y="82"
          fontSize="20"
          fontWeight="bold"
          fill={colors.secondary}
          textAnchor="middle"
          letterSpacing="2"
        >
          GO
        </SvgText>
      </Svg>
    </View>
  );
}
