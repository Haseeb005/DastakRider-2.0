# Android Play Store Build & Submit Guide

This guide covers how to build the Dastak Rider AAB and submit it to Google Play.
Replit's Expo Launch only handles iOS (App Store) — the Android pipeline must be
run from a local machine or CI with the EAS CLI installed.

---

## Prerequisites

1. **EAS CLI** installed and logged in to the `haseeb0042-2` Expo account:
   ```bash
   npm install -g eas-cli
   eas login
   ```

2. **Google Play service-account key** (JSON file) placed at:
   ```
   artifacts/rider-mobile/google-service-account.json
   ```
   To create one:
   - Open [Google Play Console](https://play.google.com/console) → Setup → API access
   - Link to a Google Cloud project (or create one)
   - Create a service account with the **Release Manager** role
   - Download the JSON key and save it as `google-service-account.json` in the
     `artifacts/rider-mobile/` directory
   - **Do not commit this file** — add it to `.gitignore`

3. The app must already exist in Play Console (at least as a draft) with the package
   name `com.dastakriders` before the first submission.

---

## Build

Run from the **`artifacts/rider-mobile/`** directory (or pass `--non-interactive`
from the monorepo root):

```bash
cd artifacts/rider-mobile
eas build --platform android --profile production
```

- EAS builds remotely on Expo's servers — no local Android toolchain needed.
- `autoIncrement: true` in `eas.json` bumps `versionCode` automatically each build.
- The output is a signed **AAB** (Android App Bundle) ready for Play Store upload.
- Build status and the download link appear at [expo.dev](https://expo.dev) under the
  `haseeb0042-2` account → project **rider-mobile**.

---

## Submit to Play Store

After the build finishes, submit the latest successful AAB:

```bash
cd artifacts/rider-mobile
eas submit --platform android --profile production
```

EAS will:
1. Fetch the latest production AAB from Expo's servers automatically.
2. Authenticate with Google Play using `google-service-account.json`.
3. Upload the AAB to the **internal** track.

To target a different track (alpha, beta, production), change `track` in `eas.json`:
```json
"submit": {
  "production": {
    "android": {
      "serviceAccountKeyPath": "./google-service-account.json",
      "track": "internal"
    }
  }
}
```

Available tracks: `internal` → `alpha` → `beta` → `production`

---

## One-command build + submit

```bash
cd artifacts/rider-mobile
eas build --platform android --profile production --auto-submit
```

`--auto-submit` triggers the submit step automatically once the build succeeds,
using the `submit.production` config from `eas.json`.

---

## Checklist before first upload

- [ ] `com.dastakriders` app created in Play Console (can be a draft)
- [ ] `google-service-account.json` present at `artifacts/rider-mobile/google-service-account.json`
- [ ] Service account granted **Release Manager** permission in Play Console
- [ ] `app.json` `android.versionCode` is higher than any previously uploaded build
      (currently `28`; `autoIncrement: true` handles this automatically)
- [ ] At least one screenshot and store listing filled in Play Console before
      promoting from internal → production

---

## App details

| Field           | Value                          |
|-----------------|--------------------------------|
| Package name    | `com.dastakriders`             |
| Current version | `4.3.0` (versionCode `28`)    |
| EAS project ID  | `fc7bfa99-d113-4c75-878d-7b1ddb1c630c` |
| Expo owner      | `haseeb0042-2`                 |
