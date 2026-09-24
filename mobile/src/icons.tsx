// Линейные иконки в стиле Lucide (как на сайте): viewBox 24, штрих 1.9, круглые концы.
import React from "react";
import Svg, { Circle, Line, Path, Polyline, Rect } from "react-native-svg";

type P = { color: string; size?: number; strokeWidth?: number };
const I = ({ color, size = 23, strokeWidth = 1.9, children }: P & { children: React.ReactNode }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}
       strokeLinecap="round" strokeLinejoin="round">{children}</Svg>
);

export const ChatIcon = (p: P) => <I {...p}><Path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></I>;
export const HistoryIcon = (p: P) => <I {...p}><Path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><Path d="M3 3v5h5" /><Path d="M12 7v5l4 2" /></I>;
export const AskIcon = (p: P) => <I {...p}><Circle cx="12" cy="12" r="10" /><Path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><Path d="M12 17h.01" /></I>;
export const SettingsIcon = (p: P) => <I {...p}><Path d="M20 7h-9" /><Path d="M14 17H5" /><Circle cx="17" cy="17" r="3" /><Circle cx="7" cy="7" r="3" /></I>;
export const ArrowUpIcon = (p: P) => <I {...p}><Path d="m5 12 7-7 7 7" /><Path d="M12 19V5" /></I>;
export const CheckIcon = (p: P) => <I {...p}><Polyline points="20 6 9 17 4 12" /></I>;
export const FileIcon = (p: P) => <I {...p}><Path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><Path d="M14 2v4a2 2 0 0 0 2 2h4" /></I>;
export const AlertIcon = (p: P) => <I {...p}><Path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><Path d="M12 9v4" /><Path d="M12 17h.01" /></I>;
export const RetryIcon = (p: P) => <I {...p}><Path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><Path d="M3 3v5h5" /></I>;
export const LogOutIcon = (p: P) => <I {...p}><Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><Polyline points="16 17 21 12 16 7" /><Line x1="21" y1="12" x2="9" y2="12" /></I>;
export const HelpIcon = (p: P) => <I {...p}><Path d="M21.42 10.92a1 1 0 0 0-.02-1.84L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.83l8.57 3.91a2 2 0 0 0 1.66 0z" /><Path d="M22 10v6" /><Path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" /></I>;
export const InboxIcon = (p: P) => <I {...p}><Polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><Path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></I>;
export const ThermometerIcon = (p: P) => <I {...p}><Path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" /></I>;
export const CalendarIcon = (p: P) => <I {...p}><Rect x="3" y="4" width="18" height="18" rx="2" /><Line x1="16" y1="2" x2="16" y2="6" /><Line x1="8" y1="2" x2="8" y2="6" /><Line x1="3" y1="10" x2="21" y2="10" /></I>;
