function openNativePicker(input){
  if(!input)return;
  try{
    if(typeof input.showPicker==="function") input.showPicker();
    else { input.focus(); input.click(); }
  }catch{
    try{ input.focus(); input.click(); }catch{}
  }
}

function displayValue(input){
  if(input.value)return input.value;
  return input.required ? "Seleccionar fecha" : "Sin fecha";
}

function updatePicker(input,button,clearButton){
  const strong=button.querySelector("strong");
  if(strong)strong.textContent=displayValue(input);
  if(clearButton)clearButton.hidden=input.required||!input.value;
  button.classList.toggle("is-empty",!input.value);
}

export function enhanceDateInput(input){
  if(!input || input.dataset.tfDatePickerEnhanced==="true")return;
  if(input.classList.contains("tf-native-picker-input"))return;
  if(input.type!=="date")return;

  input.dataset.tfDatePickerEnhanced="true";
  const wrapper=document.createElement("div");
  wrapper.className="tf-picker-field tf-date-only-picker";

  const button=document.createElement("button");
  button.type="button";
  button.className="tf-picker-button tf-date-only-button";
  button.setAttribute("aria-label", input.getAttribute("aria-label") || "Seleccionar fecha");
  button.innerHTML='<span aria-hidden="true">📅</span><strong></strong>';

  const clearButton=document.createElement("button");
  clearButton.type="button";
  clearButton.className="tf-date-clear";
  clearButton.textContent="Quitar";
  clearButton.setAttribute("aria-label","Quitar fecha");
  clearButton.hidden=true;

  const parent=input.parentNode;
  parent.insertBefore(wrapper,input);
  wrapper.appendChild(button);
  wrapper.appendChild(clearButton);
  wrapper.appendChild(input);

  input.classList.add("tf-native-picker-input");
  input.tabIndex=-1;
  input.setAttribute("aria-hidden","true");

  // Mantiene el texto visible sincronizado también cuando otros módulos hacen input.value = "YYYY-MM-DD".
  const valueDescriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");
  if(valueDescriptor?.get&&valueDescriptor?.set){
    Object.defineProperty(input,"value",{
      configurable:true,
      get(){return valueDescriptor.get.call(this)},
      set(v){valueDescriptor.set.call(this,v);queueMicrotask(()=>updatePicker(input,button,clearButton))}
    });
  }
  input.form?.addEventListener("reset",()=>setTimeout(()=>updatePicker(input,button,clearButton),0));

  button.addEventListener("click",()=>openNativePicker(input));
  clearButton.addEventListener("click",()=>{
    input.value="";
    input.dispatchEvent(new Event("input",{bubbles:true}));
    input.dispatchEvent(new Event("change",{bubbles:true}));
    updatePicker(input,button,clearButton);
  });
  input.addEventListener("input",()=>updatePicker(input,button,clearButton));
  input.addEventListener("change",()=>updatePicker(input,button,clearButton));

  const observer=new MutationObserver(()=>updatePicker(input,button,clearButton));
  observer.observe(input,{attributes:true,attributeFilter:["value","required","min","max"]});

  updatePicker(input,button,clearButton);
}

export function enhanceDateInputs(root=document){
  root.querySelectorAll?.('input[type="date"]').forEach(enhanceDateInput);
}

export function initDateOnlyPickers(){
  enhanceDateInputs(document);
  const observer=new MutationObserver(records=>{
    for(const record of records){
      for(const node of record.addedNodes){
        if(!(node instanceof Element))continue;
        if(node.matches?.('input[type="date"]'))enhanceDateInput(node);
        enhanceDateInputs(node);
      }
    }
  });
  observer.observe(document.body,{childList:true,subtree:true});
}
