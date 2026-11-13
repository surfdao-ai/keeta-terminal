#!/usr/bin/env bash
# Run the four starter prompts (plus the liquidity check) and show how much
# the agent actually says.
set -uo pipefail
BASE="${1:-https://kterminal.vercel.app}"

run() {
  echo
  echo "=== prompt: $1"
  timeout 240 curl -sS -N -X POST "$BASE/api/chat" -H 'content-type: application/json' \
    -d "{\"messages\":[{\"id\":\"m1\",\"role\":\"user\",\"parts\":[{\"type\":\"text\",\"text\":\"$1\"}]}],\"providerConfig\":{\"type\":\"openai-compatible\",\"name\":\"pollinations\",\"baseUrl\":\"https://text.pollinations.ai/openai\",\"model\":\"openai-fast\"}}" \
    | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const lines=d.split('\n').filter(l=>l.startsWith('data: '));
  let text=''; const tools=[];
  for (const l of lines) { try { const j=JSON.parse(l.slice(6));
    if (j.type==='text-delta') text+=j.delta;
    if (j.type==='tool-input-available') tools.push(j.toolName);
    if (j.type==='error') text+='\n[error] '+String(j.errorText).slice(0,200);
  } catch(e){} }
  console.log('  tools:', tools.join(', ') || '(none)');
  console.log('  chars:', text.length, '| lines:', text.split('\n').filter(Boolean).length);
  console.log('  ---');
  console.log(text.split('\n').map(l=>'  '+l).join('\n'));
});"
}

run "portfolio"
run "list tokens"
run "estimate 1 KTA to USDC"
run "liquidity KTA USDC"
