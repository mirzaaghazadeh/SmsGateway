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
#saved{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:8px}
#saved li{display:flex;align-items:center;gap:8px;padding:6px 6px 6px 12px;font-weight:400;color:var(--ink)}
#saved li+li{border-top:1px solid var(--line)}#saved li span{flex:1;overflow-wrap:anywhere}
#saved .now{font-size:.75rem;color:var(--accent);font-weight:600}
</style></head><body>
<header><h1>SMS Gateway setup</h1><p id="dev">&nbsp;</p></header>
<main>
<section class="key" aria-labelledby="kh">
 <p id="kh">Device key</p>
 <div class="row"><input id="key" readonly aria-labelledby="kh"><button type="button" id="copy">Copy</button></div>
 <p class="hint" id="khint">Add this key in your panel: Devices, then Add a gateway. It is also on the gateway screen.</p>
</section>
<form id="f" autocomplete="off">
 <div id="savedBox" class="hide"><label id="sh">Saved Wi-Fi networks</label>
  <ul id="saved" aria-labelledby="sh"></ul>
  <span class="hint">The gateway joins whichever of these is in range. It keeps up to 5.</span>
 </div>
 <label>Add a Wi-Fi network
  <span class="row"><select id="net"><option value="">Searching for networks…</option><option value="__other">Other network…</option></select>
  <button type="button" class="link" id="again">Scan again</button></span>
  <input id="ssid" class="hide" placeholder="Network name" maxlength="32">
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
  <span class="hint" id="newkeyhint">Only when the gateway gets a new owner: the old key stops working in the panel.</span>
 </details>
 <div id="msg" role="status"></div>
 <button id="save">Save and connect</button>
</form>
</main>
<script>
const $=id=>document.getElementById(id);
let info={};
function msg(t,bad){const m=$('msg');m.textContent=t;m.className=bad?'bad':'';m.style.display=t?'block':'none'}
const saved=()=>info.nets||[];
async function scan(again){
  const sel=$('net');
  if(sel.options[0].value===''||again)sel.options[0].textContent='Searching for networks…';
  for(let i=0;i<60;i++){
    const r=await fetch('/scan'+(again&&i===0?'?again=1':'')).then(r=>r.json()).catch(()=>({scanning:true}));
    if(!r.scanning){
      const cur=sel.value&&sel.value!==''?sel.value:'';
      sel.replaceChildren();
      for(const n of r.networks){
        const tag=saved().includes(n.ssid)?', saved':'';
        sel.add(new Option(n.ssid+'  ('+n.rssi+' dBm'+(n.lock?'':', open')+tag+')',n.ssid));
      }
      sel.add(new Option('Other network…','__other'));
      const first=r.networks.find(n=>!saved().includes(n.ssid));
      sel.value=cur&&[...sel.options].some(o=>o.value===cur)?cur:(first?first.ssid:(r.networks[0]?r.networks[0].ssid:'__other'));
      sel.onchange();return;
    }
    await new Promise(r=>setTimeout(r,1000));
  }
  sel.options[0].textContent='No networks found: press Scan again, or choose Other network';
}
function drawSaved(){
  const ul=$('saved');ul.replaceChildren();
  $('savedBox').classList.toggle('hide',!saved().length);
  for(const s of saved()){
    const li=document.createElement('li');const name=document.createElement('span');name.textContent=s;li.append(name);
    const inUse=info.connected&&s===info.ssid;
    if(inUse){const b=document.createElement('span');b.className='now';b.textContent='in use';li.append(b)}
    if(saved().length>1&&!inUse){
      const x=document.createElement('button');x.type='button';x.className='link';x.textContent='Remove';
      x.onclick=async()=>{
        if(!confirm('Forget '+s+'?'))return;
        const r=await fetch('/forget',{method:'POST',body:new URLSearchParams({ssid:s})}).then(r=>r.json()).catch(()=>null);
        if(r&&r.ok){info.nets=saved().filter(n=>n!==s);drawSaved();sel_pass()}else msg(r?r.error:'The gateway did not answer.',true);
      };
      li.append(x);
    }
    ul.append(li);
  }
}
function chosen(){return $('net').value==='__other'?$('ssid').value.trim():$('net').value}
function sel_pass(){$('pass').placeholder=saved().includes(chosen())?'saved (leave empty to keep)':''}
$('net').onchange=()=>{$('ssid').classList.toggle('hide',$('net').value!=='__other');sel_pass()};
$('ssid').oninput=sel_pass;
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
  if(d.mode==='lan'){ // opened on the gateway's Wi-Fi: others on it must not read or change the key
    $('copy').classList.add('hide');$('newkey').classList.add('hide');$('newkeyhint').classList.add('hide');
    $('khint').textContent='Only the end of the key is shown here. The whole key is on the gateway screen and its own setup hotspot.';
    $('save').textContent='Save';
  }
  drawSaved();
  scan(false);
});
$('f').onsubmit=async e=>{
  e.preventDefault();
  const ssid=chosen();
  if(!ssid){msg('Choose a Wi-Fi network, or type its name under Other network.',true);return}
  const body=new URLSearchParams({ssid,pass:$('pass').value,server:$('server').value.trim(),name:$('name').value.trim(),insecure:$('insecure').checked?'1':'0'});
  $('save').disabled=true;msg('Saving…');
  try{
    const r=await fetch('/save',{method:'POST',body}).then(r=>r.json());
    if(!r.ok){msg(r.error,true);$('save').disabled=false;return}
    if(r.kept){ // on the Wi-Fi: saved, the gateway stays connected
      const rest=saved().filter(n=>n!==ssid&&n!==info.ssid);
      info.nets=(info.connected&&ssid!==info.ssid?[info.ssid,ssid,...rest]:[ssid,...rest]).slice(0,5);drawSaved();sel_pass();$('pass').value='';
      msg('Saved. The gateway stays on '+info.ssid+' and joins '+ssid+' when that one is in range.');
      $('save').disabled=false;return;
    }
    msg('Connecting to '+ssid+'…');
    for(let i=0;i<40;i++){
      await new Promise(r=>setTimeout(r,1000));
      const s=await fetch('/status').then(r=>r.json()).catch(()=>null);
      if(!s)continue;
      if(s.state==='connected'){msg('Connected to '+ssid+' (address '+s.ip+'). If this gateway is not in your panel yet, open Devices there and add the key '+$('key').value+'. The gateway restarts now; you can leave this Wi-Fi.');return}
      if(s.state==='failed'){msg('Could not join '+ssid+' (it is saved anyway). If it is in range, check the password and save again.',true);$('save').disabled=false;return}
    }
    msg('No answer. If the gateway screen shows your Wi-Fi, it worked; otherwise join this hotspot again.',true);
  }catch(err){msg('The gateway did not answer: '+err.message,true)}
  $('save').disabled=false;
};
</script></body></html>)HTML";
