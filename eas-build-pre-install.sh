#!/usr/bin/env bash
# Injecte google-services.json depuis le secret EAS avant le build Android
if [ -n "$GOOGLE_SERVICES_JSON_BASE64" ]; then
  echo "$GOOGLE_SERVICES_JSON_BASE64" | base64 --decode > ./google-services.json
  echo "google-services.json écrit depuis EAS secret."
fi
