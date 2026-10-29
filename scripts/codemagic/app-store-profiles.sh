#!/bin/bash
# The App Store provisioning profiles of Wispra and its extensions (T-1076), made and fetched from App Store
# Connect with the API key of the Codemagic integration (it is never read or printed here). Used by both
# Codemagic workflows in codemagic.yaml:
#   - "iOS: create App Store profile" (a pushed profile-* tag): makes the profiles that are missing.
#   - "iOS TestFlight" (a pushed build-* tag): makes the missing ones and saves them all on the build machine,
#     so that nobody has to press "Fetch profiles" in Codemagic when an extension or a bundle id is added.
#
# Usage: app-store-profiles.sh [--save]
#   --save  also writes every profile to the folder Xcode and `xcode-project use-profiles` read
#
# To add an extension, add one line to PROFILES below: bundle id | name of the bundle id (if it has to be
# registered) | name of the profile. Nothing else changes.
set -euo pipefail

PROFILES=(
  "com.sinhgiang.wispramobile|Wispra|Wispra App Store"
  "com.sinhgiang.wispramobile.keyboard|Wispra Keyboard|Wispra Keyboard App Store"
  "com.sinhgiang.wispramobile.recording|Wispra Recording|Wispra Recording App Store"
)

SAVE=0
if [ "${1:-}" = "--save" ]; then SAVE=1; fi
PROFILES_DIR="${PROFILES_DIR:-$HOME/Library/MobileDevice/Provisioning Profiles}"

# Ids from the JSON the Codemagic CLI prints (a list of Apple resources), skipping anything expired
ids() {
  node -e '
    let text = "";
    process.stdin.on("data", (d) => (text += d)).on("end", () => {
      const now = new Date().toISOString();
      for (const item of JSON.parse(text || "[]")) {
        const exp = (item.attributes || {}).expirationDate;
        if (!exp || exp > now) console.log(item.id);
      }
    });
  '
}

certs=$( { app-store-connect certificates list --type DISTRIBUTION --json | ids; app-store-connect certificates list --type IOS_DISTRIBUTION --json | ids; } | sort -u)
if [ -z "$certs" ]; then
  echo "No valid distribution certificate in the Apple Developer account."
  exit 1
fi
echo "Distribution certificates found: $(echo "$certs" | wc -l | tr -d ' ')"

for line in "${PROFILES[@]}"; do
  IFS='|' read -r bundle_id bundle_name profile_name <<< "$line"
  existing=$(app-store-connect profiles list --type IOS_APP_STORE --name "$profile_name" --state ACTIVE --json | ids)
  if [ -n "$existing" ]; then
    echo "The profile '$profile_name' already exists."
  else
    bundle=$(app-store-connect bundle-ids list --bundle-id-identifier "$bundle_id" --strict-match-identifier --json | ids | head -n 1)
    if [ -z "$bundle" ]; then
      echo "Registering the bundle id $bundle_id."
      app-store-connect bundle-ids create "$bundle_id" --name "$bundle_name" --platform IOS
      bundle=$(app-store-connect bundle-ids list --bundle-id-identifier "$bundle_id" --strict-match-identifier --json | ids | head -n 1)
    fi
    # shellcheck disable=SC2086
    app-store-connect profiles create "$bundle" --type IOS_APP_STORE --name "$profile_name" --certificate-ids $certs
    echo "Created the App Store profile '$profile_name' for $bundle_id."
  fi
  if [ "$SAVE" = "1" ]; then
    mkdir -p "$PROFILES_DIR"
    app-store-connect profiles list --type IOS_APP_STORE --name "$profile_name" --state ACTIVE --save --profiles-dir "$PROFILES_DIR" > /dev/null
    echo "Saved '$profile_name' to $PROFILES_DIR."
  fi
done
