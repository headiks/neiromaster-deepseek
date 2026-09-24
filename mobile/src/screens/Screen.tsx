// Каркас экрана: прокрутка под плавающим таб-баром, отступ сверху — под системную строку.
// stickToBottom — как в мессенджере: при новых сообщениях держимся у низа ленты, пока
// человек сам не прокрутил вверх читать старое.
import React, { useRef } from "react";
import { RefreshControl, ScrollView, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { S, useTheme } from "../theme";

export const TABBAR_SPACE = 100;

export function Screen({ children, stickToBottom, onRefresh, refreshing, footerSpace = TABBAR_SPACE }: {
  children: React.ReactNode; stickToBottom?: boolean; onRefresh?: () => void; refreshing?: boolean; footerSpace?: number;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const ref = useRef<ScrollView>(null);
  const atBottom = useRef(true);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    atBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 48;
  };
  return (
    <ScrollView ref={ref} style={{ flex: 1 }} keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingTop: insets.top + S.lg, paddingHorizontal: S.lg, paddingBottom: insets.bottom + footerSpace, gap: S.md }}
                onScroll={stickToBottom ? onScroll : undefined} scrollEventThrottle={100}
                onContentSizeChange={stickToBottom ? () => { if (atBottom.current) ref.current?.scrollToEnd({ animated: false }); } : undefined}
                refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.primary} /> : undefined}>
      {children}
    </ScrollView>
  );
}
