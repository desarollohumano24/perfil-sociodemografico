const totalSteps=6;
function radioValue(n){
  const x=document.querySelector(`input[name="q${n}"]:checked`);
  return x?x.value:"";
}
function selectValue(n){
  const x=document.getElementById(`q${n}_input`);
  return x?x.value:"";
}
function checkboxValues(n){
  return [...document.querySelectorAll(`input[name="q${n}"]:checked`)].map(x=>x.value);
}
function showStep(n){
  document.querySelectorAll(".step").forEach(s=>s.classList.remove("active"));
  const step=document.getElementById("step"+n);
  if(step)step.classList.add("active");
  const labels=["Autorización","Datos personales","Educación y vivienda","Información laboral","Información de caracterización","Salud y hábitos","Finalizado"];
  document.getElementById("stepLabel").textContent=labels[n]||"Formulario";
  document.getElementById("stepPercent").textContent=n===0?"Inicio":(n===6?"Completado":Math.round((n/5)*100)+"%");
  document.getElementById("progressBar").style.width=(n===0?7:Math.min(100,n*20))+"%";
  window.scrollTo({top:0,behavior:"smooth"});
  updateConditions();
}
function goTo(n){showStep(n)}
function startForm(){
  if(!document.getElementById("authorization").checked){
    alert("Para continuar, debes leer y aceptar la autorización.");
    return;
  }
  goTo(1);
}
function clearError(field){
  field.classList.remove("invalid");
  const e=field.querySelector(".field-error");
  if(e)e.remove();
}
function error(field,msg){
  clearError(field);
  field.classList.add("invalid");
  const e=document.createElement("div");
  e.className="field-error";
  e.textContent=msg;
  field.appendChild(e);
}
function visible(field){
  return field.offsetParent!==null;
}
function validField(field){
  const radios=field.querySelectorAll('input[type="radio"]');
  const checks=field.querySelectorAll('input[type="checkbox"]');
  const select=field.querySelector("select");
  const input=field.querySelector('input[type="text"],input[type="date"],input[type="number"]');
  if(radios.length)return [...radios].some(x=>x.checked);
  if(checks.length)return [...checks].some(x=>x.checked);
  if(select)return select.value.trim()!=="";
  if(input)return input.value.trim()!=="";
  return true;
}
function validateStep(stepNo){
  updateConditions();
  const step=document.getElementById("step"+stepNo);
  if(!step)return true;
  let first=null;
  step.querySelectorAll(".field").forEach(field=>{
    clearError(field);
    if(!visible(field))return;
    if(field.id==="q2"){
      const v=document.getElementById("q2_input").value.trim();
      const pas=selectValue(1)==="Pasaporte";
      const ok=pas?/^[A-Z0-9]{5,15}$/.test(v):/^[0-9]{5,11}$/.test(v);
      if(!ok){
        error(field,pas?"Pasaporte: de 5 a 15 letras o números, sin espacios.":"Debe tener entre 5 y 11 dígitos, sin puntos ni espacios.");
        if(!first)first=field;
      }
      return;
    }
    if(!validField(field)){
      error(field,"Este campo es obligatorio.");
      if(!first)first=field;
    }
  });
  if(first){
    first.scrollIntoView({behavior:"smooth",block:"center"});
    return false;
  }
  return true;
}
function nextStep(current,next){
  if(validateStep(current))goTo(next);
}
function getQuestionValue(n){
  const els=[...document.querySelectorAll(`[data-q="${n}"]`)];
  const checks=els.filter(x=>((x.type==='checkbox'||x.type==='radio')&&x.checked));
  if(checks.length)return checks.map(x=>x.value).join(' | ');
  const el=els.find(x=>!((x.type==='checkbox'||x.type==='radio')));
  return el ? (el.value || '').trim() : '';
}
function makeResponseId(){
  const d=new Date();
  const p=n=>String(n).padStart(2,'0');
  return `ANG-${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
}
function buildPayload(){
  const now=new Date(Date.now()-5*3600*1000).toISOString().slice(0,19).replace('T',' ');
  const payload={"Fecha y hora":now};
  for(let n=1;n<=57;n++)payload[`Q${n}`]=getQuestionValue(n);
  return payload;
}
/* ===== Envío seguro: el navegador solo habla con /api/enviar (nunca con Power Automate) ===== */
const ENDPOINT_ENVIO='/api/enviar';
const MSG_ENVIO_ERROR='No fue posible enviar la información. Verifica tu conexión e inténtalo nuevamente.';
let turnstileWidgetId=null;
let turnstilePending=null;
let turnstileInit=null;

function initTurnstile(){
  if(!turnstileInit){
    turnstileInit=loadTurnstile().catch(function(err){turnstileInit=null;throw err;});
  }
  return turnstileInit;
}
function loadTurnstile(){
  return fetch('/api/config',{headers:{'Accept':'application/json'}})
    .then(r=>r.ok?r.json():Promise.reject(new Error('config')))
    .then(cfg=>waitForTurnstile().then(()=>{
      if(!cfg || !cfg.siteKey)throw new Error('config');
      turnstileWidgetId=window.turnstile.render('#turnstileBox',{
        sitekey:cfg.siteKey,
        action:'perfil',
        execution:'execute',
        appearance:'interaction-only',
        language:'es',
        callback:function(token){if(turnstilePending){turnstilePending.resolve(token);turnstilePending=null;}},
        'error-callback':function(){if(turnstilePending){turnstilePending.reject(new Error('turnstile'));turnstilePending=null;}return true;},
        'expired-callback':function(){try{window.turnstile.reset(turnstileWidgetId);}catch(e){}}
      });
      return true;
    }));
}
function waitForTurnstile(){
  return new Promise((resolve,reject)=>{
    let tries=0;
    (function check(){
      if(window.turnstile && typeof window.turnstile.render==='function')return resolve();
      if(++tries>100)return reject(new Error('turnstile'));
      setTimeout(check,100);
    })();
  });
}
function getTurnstileToken(){
  return initTurnstile().then(()=>new Promise((resolve,reject)=>{
    turnstilePending={resolve,reject};
    try{window.turnstile.reset(turnstileWidgetId);}catch(e){}
    window.turnstile.execute(turnstileWidgetId);
    setTimeout(()=>{if(turnstilePending){turnstilePending.reject(new Error('timeout'));turnstilePending=null;}},120000);
  }));
}
async function submitForm(){
  if(!validateStep(5))return;
  const btn=document.querySelector('#step5 button.primary');
  const original=btn ? btn.textContent : 'Finalizar →';
  if(btn){btn.disabled=true;btn.textContent='Enviando...';}
  let message=MSG_ENVIO_ERROR;
  try{
    const token=await getTurnstileToken();
    const response=await fetch(ENDPOINT_ENVIO,{
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'application/json'},
      credentials:'same-origin',
      body:JSON.stringify({token:token,datos:buildPayload()})
    });
    if(!response.ok){
      try{const r=await response.json(); if(r && typeof r.mensaje==='string')message=r.mensaje;}catch(e){}
      throw new Error('envio');
    }
    goTo(6);
  }catch(error){
    alert(message);
    if(btn){btn.disabled=false;btn.textContent=original;}
  }finally{
    try{if(turnstileWidgetId!==null)window.turnstile.reset(turnstileWidgetId);}catch(e){}
  }
}
function updateConditions(){
  const conditions={
    9:()=>radioValue(8)==='Sí',
    10:()=>radioValue(8)==='Sí',
    13:()=>radioValue(12)==='Sí' && (radioValue(5)==='Mujer' || ['Mujer','Mujer trans'].includes(selectValue(6))),
    16:()=>radioValue(15)==='Sí',
    22:()=>['Motocicleta','Automóvil particular'].includes(selectValue(21)),
    33:()=>radioValue(32)==='Sí',
    36:()=>checkboxValues(35).includes('Persona con discapacidad'),
    37:()=>checkboxValues(35).includes('Persona con discapacidad'),
    38:()=>checkboxValues(35).includes('Persona con discapacidad'),
    39:()=>checkboxValues(35).includes('Persona con discapacidad') && selectValue(38)==='Sí',
    44:()=>selectValue(43)==='Sí',
    45:()=>selectValue(43)==='Sí' && checkboxValues(44).includes('Otra'),
    46:()=>selectValue(43)==='Sí',
    48:()=>selectValue(47)==='Sí',
    49:()=>selectValue(47)==='Sí' && checkboxValues(48).includes('Otro'),
    50:()=>selectValue(47)==='Sí',
    51:()=>selectValue(47)==='Sí',
    54:()=>selectValue(53)==='Sí consumo',
  };
  Object.entries(conditions).forEach(([n,fn])=>{
    const field=document.getElementById("q"+n);
    if(!field)return;
    const show=fn();
    field.classList.toggle("show",show);
    field.dataset.active=show?"1":"0";
    if(!show){
      field.querySelectorAll("input").forEach(x=>{x.checked=false;});
      field.querySelectorAll("select").forEach(x=>{x.value="";});
      field.querySelectorAll("input[type=text],input[type=date],input[type=number]").forEach(x=>{x.value="";});
      clearError(field);
    }
  });
}
document.addEventListener("change",function(e){
  const t=e.target;
  if(t && t.name==="q35" && t.checked){
    document.querySelectorAll('input[name="q35"]').forEach(function(x){
      if(t.value==="Ninguno"?x!==t:x.value==="Ninguno")x.checked=false;
    });
  }
  if(t && t.id==="q1_input"){
    const d=document.getElementById("q2_input");
    d.setAttribute("inputmode",t.value==="Pasaporte"?"text":"numeric");
    d.value="";
  }
  updateConditions();
});
document.addEventListener("DOMContentLoaded",()=>{
  document.getElementById("progressBar").style.width="7%";
  updateConditions();
});
document.addEventListener("DOMContentLoaded", function(){
  // Texto ingresado: mayúsculas automáticas.
  document.querySelectorAll('input[type="text"], textarea').forEach(function(el){
    const labelText = (el.parentElement && el.parentElement.innerText) || "";
    if (el.id!=='q2_input' && !/número de documento/i.test(labelText)) {
      el.classList.add("uppercase-input");
      el.addEventListener("input", function(){
        const start = this.selectionStart, end = this.selectionEnd;
        this.value = this.value.toUpperCase();
        try { this.setSelectionRange(start, end); } catch(e) {}
      });
    }
  });

  // Cédula: solo números, máximo 11 dígitos y mínimo 5 para validar.
  document.querySelectorAll('#q2_input').forEach(function(el){
    el.addEventListener("input", function(){
      const pas=(document.getElementById("q1_input")||{}).value==="Pasaporte";
      this.value = pas ? this.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,15) : this.value.replace(/\D/g, "").slice(0,11);
      this.classList.remove("input-error");
      const msg=this.parentElement.querySelector(".validation-message");
      if(msg) msg.style.display="none";
    });
    el.addEventListener("keypress", function(e){
      const pas=(document.getElementById("q1_input")||{}).value==="Pasaporte";
      if(!(pas?/[A-Za-z0-9]/:/[0-9]/).test(e.key) && !["Backspace","Delete","Tab","ArrowLeft","ArrowRight","Home","End"].includes(e.key)){
        e.preventDefault();
      }
    });
    el.addEventListener("blur", function(){
      const value=this.value.trim();
      let msg=this.parentElement.querySelector(".validation-message");
      if(!msg){
        msg=document.createElement("div");
        msg.className="validation-message";
        this.parentElement.appendChild(msg);
      }
      if(value && value.length < 5){
        msg.textContent="El documento debe tener mínimo 5 caracteres.";
        msg.style.display="block";
        this.classList.add("input-error");
      } else {
        msg.style.display="none";
        this.classList.remove("input-error");
      }
    });
  });
});
document.addEventListener("DOMContentLoaded", function(){
  document.querySelectorAll("#q56_input,#q57_input").forEach(function(el){
    el.addEventListener("input", function(){
      this.value = this.value.replace(/[^0-9.,]/g,"").replace(",", ".");
    });
  });
});

/* Botones de navegación (antes onclick en el HTML; se movió aquí para permitir una CSP estricta) */
document.addEventListener("click",function(e){
  const b=e.target.closest("[data-goto],[data-next],[data-action]");
  if(!b)return;
  if(b.dataset.goto!==undefined){goTo(Number(b.dataset.goto));return;}
  if(b.dataset.next){const p=b.dataset.next.split(",").map(Number);nextStep(p[0],p[1]);return;}
  if(b.dataset.action==="start"){startForm();return;}
  if(b.dataset.action==="submit"){submitForm();}
});
document.addEventListener("DOMContentLoaded",function(){initTurnstile().catch(function(){});});
