import { Icon } from "@/components/Icon";
import { Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useOrderChat } from "@/lib/useOrderChat";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ChatScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { messages, loading, sending, sendMessage } = useOrderChat(orderId);
  const [text, setText] = useState("");
  const inputRef = useRef<TextInput>(null);

  // Newest first for FlatList inverted — newest message appears at bottom
  const reversed = [...messages].reverse();

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setText("");
    await sendMessage(trimmed);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingBottom: 12,
          paddingHorizontal: 16,
          backgroundColor: c.card,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Icon name="arrow-left" size={22} color={c.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily: "Inter_600SemiBold",
              fontSize: 16,
              color: c.foreground,
            }}
          >
            Chat with Customer
          </Text>
          <Text
            style={{
              fontFamily: "Inter_400Regular",
              fontSize: 12,
              color: c.mutedForeground,
            }}
          >
            Order #{String(orderId).slice(-6).toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Messages */}
      {loading ? (
        <Loading />
      ) : (
        <FlatList
          data={reversed}
          keyExtractor={(m) => m.id}
          inverted
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
          renderItem={({ item: msg }) => {
            const isRider = msg.fromRole === "rider";
            return (
              <View
                style={{
                  alignSelf: isRider ? "flex-end" : "flex-start",
                  maxWidth: "75%",
                  marginBottom: 8,
                }}
              >
                <View
                  style={{
                    backgroundColor: isRider ? c.primary : c.muted,
                    borderRadius: 18,
                    borderBottomRightRadius: isRider ? 4 : 18,
                    borderBottomLeftRadius: isRider ? 18 : 4,
                    paddingHorizontal: 14,
                    paddingVertical: 9,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "Inter_400Regular",
                      fontSize: 15,
                      color: isRider ? c.primaryForeground : c.foreground,
                      lineHeight: 22,
                    }}
                  >
                    {msg.text}
                  </Text>
                </View>
                <Text
                  style={{
                    fontFamily: "Inter_400Regular",
                    fontSize: 11,
                    color: c.mutedForeground,
                    marginTop: 3,
                    alignSelf: isRider ? "flex-end" : "flex-start",
                    marginHorizontal: 4,
                  }}
                >
                  {msg.time}
                </Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <View
              style={{
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 60,
              }}
            >
              <Icon name="message-circle" size={52} color={c.border} />
              <Text
                style={{
                  fontFamily: "Inter_500Medium",
                  fontSize: 16,
                  color: c.mutedForeground,
                  marginTop: 14,
                }}
              >
                No messages yet
              </Text>
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 13,
                  color: c.mutedForeground,
                  marginTop: 4,
                  textAlign: "center",
                  paddingHorizontal: 32,
                }}
              >
                Send a message to keep the customer updated
              </Text>
            </View>
          }
        />
      )}

      {/* Input bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 12),
          backgroundColor: c.card,
          borderTopWidth: 1,
          borderTopColor: c.border,
          gap: 8,
        }}
      >
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder="Type a message…"
          placeholderTextColor={c.mutedForeground}
          multiline
          maxLength={500}
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
          style={{
            flex: 1,
            backgroundColor: c.muted,
            borderRadius: 22,
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: 10,
            fontFamily: "Inter_400Regular",
            fontSize: 15,
            color: c.foreground,
            maxHeight: 120,
          }}
        />
        <Pressable
          onPress={handleSend}
          disabled={!text.trim() || sending}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor:
              !text.trim() || sending ? c.muted : c.primary,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <Icon
            name="send"
            size={18}
            color={
              !text.trim() || sending
                ? c.mutedForeground
                : c.primaryForeground
            }
          />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
