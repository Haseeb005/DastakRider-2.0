import { Icon } from "@/components/Icon";
import { useLoginRider } from "@workspace/api-client-react";
import React, { useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "phone-pad";
  autoCapitalize?: "none" | "words";
}) {
  const c = useColors();
  return (
    <View style={{ marginBottom: 14 }}>
      <Text
        style={{
          fontFamily: "Inter_500Medium",
          fontSize: 13,
          color: c.foreground,
          marginBottom: 6,
        }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.mutedForeground}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize ?? "none"}
        style={{
          backgroundColor: c.card,
          borderWidth: 1,
          borderColor: c.input,
          borderRadius: c.radius,
          paddingHorizontal: 14,
          paddingVertical: 13,
          fontFamily: "Inter_400Regular",
          fontSize: 15,
          color: c.foreground,
        }}
      />
    </View>
  );
}

export default function LoginScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  const loginM = useLoginRider();
  const pending = loginM.isPending;

  const handleSubmit = () => {
    setError(null);
    if (!phone.trim() || !password.trim()) {
      setError("Phone and password are required.");
      return;
    }
    loginM.mutate(
      { data: { phone: phone.trim(), password } },
      {
        onSuccess: (rider) => {
          if (rider.token) signIn(rider.token);
          else setError("No token received. Please try again.");
        },
        onError: () => setError("Incorrect phone or password."),
      },
    );
  };

  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{
        paddingHorizontal: 24,
        paddingTop: (Platform.OS === "web" ? 48 : insets.top) + 24,
        paddingBottom: insets.bottom + 40,
      }}
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
    >
      <View style={{ alignItems: "center", marginBottom: 28 }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            backgroundColor: c.primary,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 14,
          }}
        >
          <Icon name="zap" size={34} color="#FFFFFF" />
        </View>
        <Text
          style={{
            fontFamily: "Inter_700Bold",
            fontSize: 26,
            color: c.foreground,
          }}
        >
          Dastak Rider
        </Text>
        <Text
          style={{
            fontFamily: "Inter_400Regular",
            fontSize: 14,
            color: c.mutedForeground,
            marginTop: 4,
          }}
        >
          Sign in to your account
        </Text>
      </View>

      <Field
        label="Phone number"
        value={phone}
        onChangeText={setPhone}
        placeholder="03001234567"
        keyboardType="phone-pad"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••"
        secureTextEntry
      />

      {error ? (
        <View
          style={{
            backgroundColor: "#FEE2E2",
            borderRadius: c.radius,
            padding: 12,
            marginBottom: 14,
          }}
        >
          <Text
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 13,
              color: c.destructive,
            }}
          >
            {error}
          </Text>
        </View>
      ) : null}

      <Button
        label="Login"
        onPress={handleSubmit}
        loading={pending}
        icon="arrow-right"
        style={{ marginTop: 4 }}
      />
    </KeyboardAwareScrollView>
  );
}
