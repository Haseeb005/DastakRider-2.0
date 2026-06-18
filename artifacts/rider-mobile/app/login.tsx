import { Feather } from "@expo/vector-icons";
import {
  useLoginRider,
  useRegisterRider,
} from "@workspace/api-client-react";
import React, { useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";

const CITIES = [
  "Lahore",
  "Karachi",
  "Islamabad",
  "Rawalpindi",
  "Faisalabad",
  "Multan",
  "Peshawar",
  "Gujranwala",
  "Sialkot",
];

const VEHICLES = ["Motorcycle", "Bicycle", "Car"];

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

function Chips({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const c = useColors();
  return (
    <View
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}
    >
      {options.map((opt) => {
        const active = value === opt;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 9,
              borderRadius: 999,
              backgroundColor: active ? c.primary : c.card,
              borderWidth: 1,
              borderColor: active ? c.primary : c.border,
            }}
          >
            <Text
              style={{
                fontFamily: "Inter_500Medium",
                fontSize: 13,
                color: active ? "#FFFFFF" : c.foreground,
              }}
            >
              {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function LoginScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState(CITIES[0]);
  const [vehicleType, setVehicleType] = useState(VEHICLES[0]);

  const loginM = useLoginRider();
  const registerM = useRegisterRider();
  const pending = loginM.isPending || registerM.isPending;

  const handleSubmit = () => {
    setError(null);
    if (!phone.trim() || !password.trim()) {
      setError("Phone aur password zaroori hai.");
      return;
    }
    if (mode === "login") {
      loginM.mutate(
        { data: { phone: phone.trim(), password } },
        {
          onSuccess: (rider) => {
            if (rider.token) signIn(rider.token);
            else setError("Token nahi mila. Dobara koshish karein.");
          },
          onError: () => setError("Phone ya password ghalat hai."),
        },
      );
    } else {
      if (!name.trim()) {
        setError("Apna naam likhein.");
        return;
      }
      registerM.mutate(
        {
          data: {
            name: name.trim(),
            phone: phone.trim(),
            password,
            city,
            vehicleType,
          },
        },
        {
          onSuccess: (rider) => {
            if (rider.token) signIn(rider.token);
            else setError("Registration ho gaya, ab login karein.");
          },
          onError: () => setError("Registration fail hua. Phone pehle se mojood ho sakta hai."),
        },
      );
    }
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
          <Feather name="zap" size={34} color="#FFFFFF" />
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
          {mode === "login"
            ? "Apne account mein login karein"
            : "Naya rider account banayein"}
        </Text>
      </View>

      <View
        style={{
          flexDirection: "row",
          backgroundColor: c.muted,
          borderRadius: c.radius,
          padding: 4,
          marginBottom: 22,
        }}
      >
        {(["login", "register"] as const).map((m) => {
          const active = mode === m;
          return (
            <Pressable
              key={m}
              onPress={() => {
                setMode(m);
                setError(null);
              }}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: c.radius - 4,
                backgroundColor: active ? c.card : "transparent",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                  color: active ? c.foreground : c.mutedForeground,
                }}
              >
                {m === "login" ? "Login" : "Register"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {mode === "register" ? (
        <Field
          label="Pura naam"
          value={name}
          onChangeText={setName}
          placeholder="Ahmed Ali"
          autoCapitalize="words"
        />
      ) : null}

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

      {mode === "register" ? (
        <>
          <Text
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 13,
              color: c.foreground,
              marginBottom: 6,
            }}
          >
            Sheher
          </Text>
          <Chips options={CITIES} value={city} onChange={setCity} />
          <Text
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 13,
              color: c.foreground,
              marginBottom: 6,
            }}
          >
            Sawari
          </Text>
          <Chips
            options={VEHICLES}
            value={vehicleType}
            onChange={setVehicleType}
          />
        </>
      ) : null}

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
        label={mode === "login" ? "Login" : "Account banayein"}
        onPress={handleSubmit}
        loading={pending}
        icon="arrow-right"
        style={{ marginTop: 4 }}
      />
    </KeyboardAwareScrollView>
  );
}
