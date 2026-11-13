#!/usr/bin/env bash
# Exercise the recurring (DCA) automation path end to end.
# Usage: bash scripts/dca-test.sh [base-url]
set -uo pipefail
BASE="${1:-https://kterminal.vercel.app}"
JAR="$(mktemp -d)/cookies.txt"

echo "== create a wallet + the automation wallet =="
curl -sS --max-time 90 -c "$JAR" -X POST "$BASE/api/wallet" -H 'content-type: application/json' \
  -d '{"action":"new-seed"}' > /tmp/opencode/dca-wallet.json
SEED=$(node -e "const j=require('/tmp/opencode/dca-wallet.json');console.log(j.seed||'')")
ADDR=$(node -e "const j=require('/tmp/opencode/dca-wallet.json');console.log(j.address||'')")
echo "wallet: ${ADDR:0:20}…"
curl -sS --max-time 60 -X POST "$BASE/api/wallet" -H 'content-type: application/json' -d "{\"action\":\"register\",\"address\":\"$ADDR\"}" >/dev/null

echo
echo "== create the automation wallet (server-side, for unattended swaps) =="
curl -sS --max-time 90 -X POST "$BASE/api/automations/wallet" -H 'content-type: application/json' -d "{\"seed\":\"$SEED\"}" | head -c 300
echo
echo "-- its balances (it needs funds to actually swap) --"
curl -sS --max-time 60 "$BASE/api/automations/wallet" | head -c 400
echo

echo
echo "== create a recurring automation (every 15m: 0.01 KTA -> USDC) =="
KTA=$(curl -sS --max-time 45 -X POST "$BASE/api/models" -H 'content-type: application/json' -d '{"baseUrl":"https://ollama.com/v1"}' >/dev/null; echo "keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg")
USDC="keeta_amnkge74xitii5dsobstldatv3irmyimujfjotftx7plaaaseam4bntb7wnna"
auto=$(curl -sS --max-time 90 -X POST "$BASE/api/automations" -H 'content-type: application/json' \
  -d "{\"kind\":\"recurring\",\"name\":\"dca-test\",\"fromToken\":\"$KTA\",\"toToken\":\"$USDC\",\"amount\":\"0.01\",\"everyMinutes\":15,\"seed\":\"$SEED\"}")
echo "$auto" | head -c 400
echo
AID=$(echo "$auto" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).automation?.id||'')}catch(e){console.log('')}})")

echo
echo "== make it due, then run it =="
# The API always schedules the first run 15 minutes out, so move nextRunAt
# into the past directly in the store.
node -e "
const fs=require('node:fs');
const t=fs.readFileSync(process.env.MIG_ENV||'/tmp/opencode/mig.env','utf8');
for (const l of t.split('\n')) { const i=l.indexOf('='); if(i>0) process.env[l.slice(0,i)] = l.slice(i+1); }
import('postgres').then(async ({default: postgres}) => {
  const db = postgres(process.env.DATABASE_URL, { ssl:'require', max:2, prepare:false });
  const rows = await db\`SELECT value FROM kt_store WHERE key = 'automations'\`;
  const list = Array.isArray(rows[0]?.value) ? rows[0].value : [];
  const past = new Date(Date.now()-60000).toISOString();
  for (const a of list) if (a.id === '$AID') a.nextRunAt = past;
  await db\`UPDATE kt_store SET value = \${db.json(list)} WHERE key = 'automations'\`;
  console.log('  made due:', list.filter(a=>a.id==='$AID').length);
  await db.end();
});" 2>&1 | grep -v Warning | tail -2
run=$(curl -sS --max-time 180 -X POST "$BASE/api/automations/run" -H 'content-type: application/json' -d "{\"seed\":\"$SEED\"}")
echo "$run"
echo
echo "== the automation's own record =="
curl -sS --max-time 60 "$BASE/api/automations" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const j=JSON.parse(d);
  const a=(j.automations||[]).find(x=>x.name==='dca-test');
  console.log(JSON.stringify(a,null,1));
  console.log('log:', JSON.stringify((j.log||[]).filter(l=>l.automationId===(a||{}).id),null,1).slice(0,700));
});"

echo
echo
echo "== cleanup =="
curl -sS --max-time 60 -X POST "$BASE/api/automations" -H 'content-type: application/json' -d "{\"action\":\"delete\",\"id\":\"$AID\",\"seed\":\"$SEED\"}" >/dev/null
echo "removed the test automation"
