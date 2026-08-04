/**
 * ChatBadgeButton
 *
 * A "Chat with Customer" button that shows a red badge when there are
 * unread customer messages for the given order.  The badge is driven by
 * useChatUnread and clears automatically when the rider opens the chat screen.
 */

import React from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useChatUnread } from "@/lib/useChatUnread";

interface Props {
  orderId: string;
  onPress: () => void;
}

export function ChatBadgeButton({ orderId, onPress }: Props) {
  const c = useColors();
  const unread = useChatUnread(orderId);

  return (
    <View style={{ position: "relative", alignSelf: "stretch" }}>
      <Button
        label="Chat with Customer"
        icon="message-circle"
        variant="outline"
        onPress={onPress}
        style={{ alignSelf: "stretch", marginTop: 6 }}
      />

      {unread > 0 && (
        <View
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: c.destructive ?? "#DB143C",
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 4,
            // Small white border so the badge stands out against the button edge
            borderWidth: 1.5,
            borderColor: c.background,
          }}
        >
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 10,
              color: "#FFFFFF",
              lineHeight: 13,
            }}
          >
            {unread > 99 ? "99+" : String(unread)}
          </Text>
        </View>
      )}
    </View>
  );
}
