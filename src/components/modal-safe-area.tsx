import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import {
  useSafeAreaInsets,
  type Edge,
} from "react-native-safe-area-context";

type Props = {
  edges?: readonly Edge[];
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children?: ReactNode;
};

// Drop-in for SafeAreaView inside a React Native <Modal>. The native
// SafeAreaView receives zero insets there, so full-screen modals drew their
// header under the status bar. The window insets from the root provider are
// correct for a full-screen modal, so pad with those instead.
export function ModalSafeArea({
  edges = ["top", "bottom", "left", "right"],
  style,
  testID,
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View
      testID={testID}
      style={[
        style,
        {
          paddingTop: edges.includes("top") ? insets.top : 0,
          paddingBottom: edges.includes("bottom") ? insets.bottom : 0,
          paddingLeft: edges.includes("left") ? insets.left : 0,
          paddingRight: edges.includes("right") ? insets.right : 0,
        },
      ]}
    >
      {children}
    </View>
  );
}
