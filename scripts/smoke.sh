#!/usr/bin/env bash
# End-to-end smoke test of the deployed terminal.
# Usage: bash scripts/smoke.sh [base-url]
set -uo pipefail
BASE="${1:-https://kterminal.vercel.app}"
JAR="$(mktemp -d)/cookies.txt"
# Passphrase of the wallet in the store. Set SMOKE_PASS for a different one.
PASS="${SMOKE_PASS:-skills-verify-passphrase-01}"
fails=0

check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then printf 'PASS  %-46s %s\n' "$1" "$3"
  else printf 'FAIL  %-46s expected=%s got=%s\n' "$1" "$2" "$3"; fails=$((fails+1)); fi
}
code() { curl -sS --max-time 60 -o /dev/null -w '%{http_code}' "$@"; }

echo "== static & pwa =="
check "GET /" 200 "$(code $BASE/)"
check "GET /manifest.webmanifest" 200 "$(code $BASE/manifest.webmanifest)"
check "GET /sw.js" 200 "$(code $BASE/sw.js)"
check "GET /icon-192.png" 200 "$(code $BASE/icon-192.png)"
check "GET /apple-touch-icon.png" 200 "$(code $BASE/apple-touch-icon.png)"

echo
echo "== api: state & settings =="
check "GET /api/state" 200 "$(code $BASE/api/state)"
check "GET /api/wallet" 200 "$(code $BASE/api/wallet)"
check "POST /api/wallet (bad action -> 400)" 400 "$(code -X POST $BASE/api/wallet -H 'content-type: application/json' -d '{"action":"nope"}')"
check "POST /api/wallet (bad address -> 400)" 400 "$(code -X POST $BASE/api/wallet -H 'content-type: application/json' -d '{"action":"register","address":"not-an-address"}')"
check "POST /api/automations (no seed -> 401)" 401 "$(code -X POST $BASE/api/automations -H 'content-type: application/json' -d '{"kind":"alert","symbol":"KTA","op":"lt","valueUsd":1}')" 
check "GET /api/chats" 200 "$(code $BASE/api/chats)"
check "GET /api/automations" 200 "$(code $BASE/api/automations)"
check "GET /api/automations/wallet" 200 "$(code $BASE/api/automations/wallet)"
check "GET /api/settings (public cap read)" 200 "$(code $BASE/api/settings)"
check "POST /api/settings (no seed -> 401)" 401 "$(code -X POST $BASE/api/settings -H 'content-type: application/json' -d '{"dailyCapUsd":50}')"
check "GET /api/models (bad body -> 400)" 400 "$(code -X POST $BASE/api/models -H 'content-type: application/json' -d '{}')"
check "GET /api/models (private url -> 400)" 400 "$(code -X POST $BASE/api/models -H 'content-type: application/json' -d '{"baseUrl":"http://169.254.169.254/"}')"

echo
echo "== api: model lists =="
for spec in "ollama cloud|https://ollama.com/v1" "kilo|https://api.kilo.ai/api/gateway" "pollinations|https://text.pollinations.ai/openai" "openrouter|https://openrouter.ai/api/v1"; do
  name="${spec%%|*}"; url="${spec##*|}"
  n=$(curl -sS --max-time 60 -X POST $BASE/api/models -H 'content-type: application/json' -d "{\"baseUrl\":\"$url\"}" \
      | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log((j.models||[]).length)}catch(e){console.log(0)}})")
  if [ "${n:-0}" -gt 0 ]; then printf 'PASS  %-46s %s models\n' "model list: $name" "$n"
  else printf 'FAIL  %-46s 0 models\n' "model list: $name"; fails=$((fails+1)); fi
done

echo
echo "== api: chat without a provider =="
check "POST /api/chat (no provider -> 400)" 400 "$(code -X POST $BASE/api/chat -H 'content-type: application/json' -d '{"messages":[]}')"

echo
echo "== api: wallet registry (public address only) =="
# The server never holds the seed: the test asks it for one once (the same
# fallback the app uses when a browser cannot run the Keeta client), then keeps
# it in memory exactly like the device vault does.
wallet=$(curl -sS --max-time 90 -X POST $BASE/api/wallet -H 'content-type: application/json' -d '{"action":"new-seed"}')
SEED=$(echo "$wallet" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).seed||'')}catch(e){console.log('')}})")
addr=$(echo "$wallet" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).address||'')}catch(e){console.log('')}})")
if [ -n "$addr" ] && [ -n "$SEED" ]; then printf 'PASS  %-46s %s\n' "seed derived (never stored)" "${addr:0:16}…"
else echo "FAIL  seed derivation ($wallet)"; fails=$((fails+1)); fi

registered=$(curl -sS --max-time 60 -X POST $BASE/api/wallet -H 'content-type: application/json' -d "{\"action\":\"register\",\"address\":\"$addr\"}")
check "register the public address" true "$(echo "$registered" | grep -q '"ok":true' && echo true || echo false)"

derived=$(curl -sS --max-time 60 -X POST $BASE/api/wallet -H 'content-type: application/json' -d "{\"action\":\"derive\",\"seed\":\"$SEED\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).address||'')}catch(e){console.log('')}})")
check "derive matches the address" "$addr" "$derived"

stored=$(curl -sS --max-time 30 $BASE/api/wallet)
if echo "$stored" | grep -q "$addr"; then printf 'PASS  %-46s\n' "server stores only the address"
else echo "FAIL  server wallet record ($stored)"; fails=$((fails+1)); fi
if echo "$stored" | grep -qi "ciphertext\|seed\|passphrase"; then echo "FAIL  server wallet record contains key material"; fails=$((fails+1));
else printf 'PASS  %-46s\n' "no key material in the server record"; fi

unlocked=$(curl -sS --max-time 60 -X POST $BASE/api/state -H 'content-type: application/json' -d "{\"seed\":\"$SEED\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).unlocked)}catch(e){console.log('false')}})")
check "state reads balances with the seed" true "$unlocked"

echo
echo "== api: automations =="
auto=$(curl -sS --max-time 60 -X POST $BASE/api/automations -H 'content-type: application/json' \
  -d "{\"kind\":\"alert\",\"name\":\"smoke\",\"symbol\":\"KTA\",\"op\":\"lt\",\"valueUsd\":0.0001,\"seed\":\"$SEED\"}")
aid=$(echo "$auto" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).automation.id||'')}catch(e){console.log('')}})")
if [ -n "$aid" ]; then printf 'PASS  %-46s %s\n' "create alert" "${aid:0:8}…"; else echo "FAIL  create alert ($auto)"; fails=$((fails+1)); fi

run=$(curl -sS --max-time 120 -X POST $BASE/api/automations/run -H 'content-type: application/json' -d "{\"seed\":\"$SEED\"}")
checked=$(echo "$run" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).checked)}catch(e){console.log(-1)}})")
check "manual run checks the alert" 1 "$checked"

toggled=$(curl -sS --max-time 60 -X POST $BASE/api/automations -H 'content-type: application/json' -d "{\"action\":\"toggle\",\"id\":\"$aid\",\"seed\":\"$SEED\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).automation.enabled)}catch(e){console.log('?')}})")
check "toggle flips enabled" false "$toggled"

curl -sS --max-time 60 -X POST $BASE/api/automations -H 'content-type: application/json' -d "{\"action\":\"delete\",\"id\":\"$aid\",\"seed\":\"$SEED\"}" >/dev/null
left=$(curl -sS --max-time 30 $BASE/api/automations | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).automations.length)}catch(e){console.log(-1)}})")
check "delete removes the alert" 0 "$left"

echo
echo "== api: chat with the free provider + skills =="
stream=$(curl -sS -N --max-time 300 -X POST $BASE/api/chat -H 'content-type: application/json' \
  -d "{\"messages\":[{\"id\":\"m1\",\"role\":\"user\",\"parts\":[{\"type\":\"text\",\"text\":\"Call list_skills, then read_skill for read-prices, then get_portfolio. Be brief.\"}]}],\"providerConfig\":{\"type\":\"openai-compatible\",\"name\":\"pollinations\",\"baseUrl\":\"https://text.pollinations.ai/openai\",\"model\":\"openai-fast\"},\"seed\":\"$SEED\"}")
tools=$(echo "$stream" | grep -o '"toolName":"[^"]*"' | sort -u | tr '\n' ' ')
if echo "$tools" | grep -q "ks_list_skills"; then printf 'PASS  %-46s %s\n' "agent called ks_list_skills" "$tools"
else printf 'FAIL  %-46s %s\n' "agent called ks_list_skills" "$tools"; fails=$((fails+1)); fi
if echo "$tools" | grep -q "get_portfolio"; then printf 'PASS  %-46s %s\n' "agent called get_portfolio" "$tools"
else printf 'FAIL  %-46s %s\n' "agent called get_portfolio" "$tools"; fails=$((fails+1)); fi
if echo "$stream" | grep -q "tool-input-error"; then printf 'FAIL  %-46s\n' "no tool errors"; fails=$((fails+1));
else printf 'PASS  %-46s\n' "no tool errors"; fi

echo
echo "== cleanup =="
echo "wallet seed kept out of the server"

echo
if [ "$fails" -eq 0 ]; then echo "ALL CHECKS PASSED"; else echo "$fails CHECK(S) FAILED"; fi
exit $fails
