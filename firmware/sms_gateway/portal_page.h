#pragma once

// The setup page served on http://192.168.4.1/. Values are filled in by script from /info,
// never pasted into the HTML.
static const char PORTAL_PAGE[] = R"HTML(<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SMS Gateway setup</title>
<style>
:root{--ink:#132321;--muted:#4c5a57;--line:#cdd4cc;--bg:#f3f5f2;--rail:#10292b;--accent:#0b7356;--bad:#b8322b}
@media (prefers-color-scheme:dark){:root{--ink:#e3eeeb;--muted:#a9bab6;--line:#33504c;--bg:#0c1615;--accent:#3fcf9f;--bad:#f47d74}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
header{background:var(--rail);color:#eef7f5;padding:22px 18px 18px}header h1{margin:0;font-size:1.25rem;font-weight:600}
header p{margin:4px 0 0;color:#a9c4be;font-size:.85rem}
main{max-width:460px;margin:0 auto;padding:18px}
form{display:flex;flex-direction:column;gap:16px}
label{display:flex;flex-direction:column;gap:6px;font-size:.88rem;font-weight:600;color:var(--muted)}
input,select{font:inherit;color:var(--ink);background:transparent;border:1px solid var(--line);border-radius:8px;padding:10px 11px;min-height:44px;width:100%}
input:focus,select:focus{outline:2px solid var(--accent);outline-offset:1px}
.row{display:flex;gap:8px;align-items:center}.row select{flex:1}
.hint{font-weight:400;font-size:.8rem;color:var(--muted)}
.check{flex-direction:row;align-items:center;gap:10px;font-weight:400}.check input{width:auto;min-height:0}
button{font:inherit;font-weight:600;border:0;border-radius:8px;min-height:46px;padding:0 16px;background:var(--accent);color:#fff;cursor:pointer}
@media (prefers-color-scheme:dark){button{color:#06231a}}
button.link{background:none;color:var(--accent);min-height:0;padding:6px 2px;font-weight:500}
details{font-size:.88rem;color:var(--muted)}summary{cursor:pointer;padding:4px 0}
#msg{padding:14px;border-radius:8px;border:1px solid var(--line);display:none}#msg.bad{border-color:var(--bad);color:var(--bad)}
.hide{display:none}
.key{border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:20px}
.key p{margin:0}#kh{font-size:.88rem;font-weight:600;color:var(--muted);margin-bottom:8px}
.key input{font:600 1.2rem/1 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.04em;text-align:center}
.key button{min-height:44px}.key .hint{margin-top:8px}
details .link{display:block;margin-top:10px}
</style></head><body>
<header><h1>SMS Gateway setup</h1><p id="dev">&nbsp;</p></header>
<main>
<section class="key" aria-labelledby="kh">
 <p id="kh">Device key</p>
 <div class="row"><input id="key" readonly aria-labelledby="kh"><button type="button" id="copy">Copy</button></div>
 <p class="hint" id="khint">Add this key in your panel: Devices, then Add a gateway. It is also on the gateway screen.</p>
</section>
<form id="f" autocomplete="off">
 <label>Wi-Fi network
  <span class="row"><select id="net"><option value="">Searching for networks…</option></select>
  <button type="button" class="link" id="again">Scan again</button></span>
  <input id="ssid" class="hide" placeholder="Network name">
 </label>
 <label>Wi-Fi password
  <input id="pass" type="password" autocomplete="new-password">
  <span class="check hint"><input type="checkbox" id="show"> show password</span>
 </label>
 <label>Server address
  <input id="server" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="https://sms.example.com" required>
  <span class="hint">The address of your panel.</span>
 </label>
 <label>Name <input id="name" maxlength="32" placeholder="SMS Gateway"></label>
 <details><summary>Advanced</summary>
  <label class="check"><input type="checkbox" id="insecure"> Skip the HTTPS certificate check (only for a self-signed certificate)</label>
  <button type="button" class="link" id="newkey">Make a new device key</button>
  <span class="hint">Only when the gateway gets a new owner: the old key stops working in the panel.</span>
 </details>
 <div id="msg" role="status"></div>
 <button id="save">Save and connect</button>
</form>
</main>
<script>
const $=id=>document.getElementById(id);
let info={};
function msg(t,bad){const m=$('msg');m.textContent=t;m.className=bad?'bad':'';m.style.display=t?'block':'none'}
async function scan(again){
  const sel=$('net');
  for(let i=0;i<20;i++){
    const r=await fetch('/scan'+(again&&i===0?'?again=1':'')).then(r=>r.json()).catch(()=>({scanning:true}));
    if(!r.scanning){
      const cur=sel.value||info.ssid||'';
      sel.replaceChildren();
      for(const n of r.networks){const o=new Option(n.ssid+'  ('+n.rssi+' dBm'+(n.lock?'':', open')+')',n.ssid);sel.add(o)}
      if(info.ssid&&!r.networks.some(n=>n.ssid===info.ssid))sel.add(new Option(info.ssid+'  (saved, not seen)',info.ssid));
      sel.add(new Option('Other network…','__other'));
      sel.value=cur||(r.networks[0]?r.networks[0].ssid:'__other');
      sel.onchange();return;
    }
    await new Promise(r=>setTimeout(r,1000));
  }
}
$('net').onchange=()=>$('ssid').classList.toggle('hide',$('net').value!=='__other');
$('again').onclick=()=>scan(true);
$('show').onchange=e=>$('pass').type=e.target.checked?'text':'password';
$('copy').onclick=async()=>{
  const k=$('key');let ok=false;
  try{await navigator.clipboard.writeText(k.value);ok=true}catch(e){}
  if(!ok){k.focus();k.select();k.setSelectionRange(0,99);try{ok=document.execCommand('copy')}catch(e){}}
  $('copy').textContent=ok?'Copied':'Copy';
  if(!ok)$('khint').textContent='Copying is blocked here: press and hold the key to copy it, or type it from the gateway screen.';
};
$('newkey').onclick=async()=>{
  if(!confirm('Make a new device key? The panel then has to add the gateway again with the new key.'))return;
  const r=await fetch('/newkey',{method:'POST'}).then(r=>r.json()).catch(()=>null);
  if(r){$('key').value=r.key;$('copy').textContent='Copy'}
};
fetch('/info').then(r=>r.json()).then(d=>{
  info=d;$('dev').textContent='ID '+d.id+' · firmware '+d.fw;$('key').value=d.key;
  $('server').value=d.server||'';$('name').value=d.name||'';$('insecure').checked=!!d.insecure;
  if(d.hasPass)$('pass').placeholder='saved (leave empty to keep)';
  scan(false);
});
$('f').onsubmit=async e=>{
  e.preventDefault();
  const ssid=$('net').value==='__other'?$('ssid').value.trim():$('net').value;
  const body=new URLSearchParams({ssid,pass:$('pass').value,server:$('server').value.trim(),name:$('name').value.trim(),insecure:$('insecure').checked?'1':'0'});
  $('save').disabled=true;msg('Saving…');
  try{
    const r=await fetch('/save',{method:'POST',body}).then(r=>r.json());
    if(!r.ok){msg(r.error,true);$('save').disabled=false;return}
    msg('Connecting to '+ssid+'…');
    for(let i=0;i<40;i++){
      await new Promise(r=>setTimeout(r,1000));
      const s=await fetch('/status').then(r=>r.json()).catch(()=>null);
      if(!s)continue;
      if(s.state==='connected'){msg('Connected to '+ssid+' (address '+s.ip+'). Last step: in your panel open Devices and add the key '+$('key').value+'. The gateway restarts now; you can leave this Wi-Fi.');return}
      if(s.state==='failed'){msg('Could not join '+ssid+'. Check the password and try again.',true);$('save').disabled=false;return}
    }
    msg('No answer. If the gateway screen shows your Wi-Fi, it worked; otherwise join this hotspot again.',true);
  }catch(err){msg('The gateway did not answer: '+err.message,true)}
  $('save').disabled=false;
};
</script></body></html>)HTML";
