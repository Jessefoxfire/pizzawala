
import React from 'react';
import Svg, { Path, Circle, Polygon, Rect, G, SvgProps } from 'react-native-svg';

export const Icons = {
  check: (props: SvgProps) => (
    <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <Path d="M20 6 9 17l-5-5"/>
    </Svg>
  ),
  eye: (props: SvgProps) => (
    <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <Path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
      <Circle cx="12" cy="12" r="3"/>
    </Svg>
  ),
  eyeOff: (props: SvgProps) => (
    <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <Path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
      <Path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
      <Path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
      <Path d="M2 2 22 22"/>
    </Svg>
  ),
  navigationArrow: (props: SvgProps) => (
    <Svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <Path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
    </Svg>
  ),
  book: (props: SvgProps) => (
     <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <Path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
        <Path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
     </Svg>
  ),
};
