// FactShield v1.1 – Options
(function(){
  "use strict";

  const key  = document.getElementById("apiKey");
  const m1   = document.getElementById("m1");
  const m2   = document.getElementById("m2");
  const msg  = document.getElementById("msg");

  chrome.storage.local.get({apiKey:"",model1:"gemini-1.5-flash",model2:"gemini-1.5-pro"}, d => {
    if(d.apiKey) key.value = d.apiKey;
    m1.value = d.model1;
    m2.value = d.model2;
  });

  document.getElementById("tvis").onclick = () => {
    key.type = key.type==="password" ? "text" : "password";
    document.getElementById("tvis").textContent = key.type==="password" ? "👁" : "🙈";
  };

  document.getElementById("save").onclick = () => {
    const k = key.value.trim();
    if(!k)            return setMsg("Please enter your Gemini API key.","err");
    if(!k.startsWith("AIza")) return setMsg("That doesn't look like a Gemini key (should start with AIza…)","err");
    if(m1.value===m2.value)   setMsg("⚠️ Tip: different models give a stronger cross-check.","info");
    chrome.storage.local.set({apiKey:k, model1:m1.value, model2:m2.value},
      () => setMsg("✅ Saved!","ok",4000));
  };

  document.getElementById("test").onclick = async () => {
    const k = key.value.trim();
    if(!k) return setMsg("Enter your API key first.","err");
    setMsg("Testing…","info");
    document.getElementById("test").disabled = true;
    try {
      const model = m1.value;
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${k}`,
        { method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({contents:[{role:"user",parts:[{text:"Say OK"}]}],
            generationConfig:{maxOutputTokens:5}}) }
      );
      if(r.ok)             setMsg(`✅ Connected! Model "${model}" is ready.`,"ok");
      else if(r.status===400||r.status===403) setMsg("❌ Invalid API key. Check aistudio.google.com/apikey","err");
      else if(r.status===429) setMsg("⚠️ Key valid but rate-limited. Try again in a moment.","info");
      else if(r.status===404) setMsg(`❌ Model "${model}" not found — try a different model.`,"err");
      else { const e=await r.json().catch(()=>({})); setMsg(`❌ Error ${r.status}: ${e?.error?.message||"unknown"}`,"err"); }
    } catch(e) {
      setMsg("❌ Network error: "+e.message,"err");
    } finally {
      document.getElementById("test").disabled = false;
    }
  };

  document.getElementById("clear").onclick = () => {
    if(!confirm("Clear all settings?")) return;
    chrome.storage.local.clear(()=>{
      key.value=""; m1.value="gemini-1.5-flash"; m2.value="gemini-1.5-pro";
      setMsg("Cleared.","info");
    });
  };

  function setMsg(text, type, autoHide=0) {
    msg.textContent=text; msg.className=type;
    if(autoHide) setTimeout(()=>{ msg.className=""; }, autoHide);
  }
})();
