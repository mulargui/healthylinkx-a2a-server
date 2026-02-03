set -e

# Minimal local smoke checks (assumes you run a2a/src with PORT=3001 or mapped port)
BASE_URL=${BASE_URL:-http://localhost:3000}

echo "== Agent card =="
curl -sS "$BASE_URL/.well-known/agent-card.json" | head -c 500

echo "\n== message:send (metadata.searchDoctors) =="
curl -sS -X POST "$BASE_URL/message:send" \
  -H 'Content-Type: application/a2a+json' \
  -d '{
    "message": {"role":"ROLE_USER","parts":[{"text":"search"}]},
    "metadata": {"searchDoctors": {"zipcode": 98052, "lastname": "DOE", "specialty": "Surgeon", "gender": "male"}}
  }' | head -c 1000

echo "\n"
