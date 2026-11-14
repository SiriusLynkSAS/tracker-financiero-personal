import {requireUser} from "./guard.js";
import {getEntity,atomicWrite} from "./data-service.js?v=1.0.82";
import {money,escapeHtml} from "./utils.js";
import {confirmAction,toast} from "./ui.js";
import {MIG008_TARGETS,inspectMig008Debt,migrateMig008Schedule,mig008Summary} from "./mig008-logic.js?v=1.0.82";

const panel=document.querySelector("#mig008-panel");
const statusBox=document.querySelector("#mig008-status");
const detail=document.querySelector("#mig008-detail");
const apply=document.querySelector("#mig008-apply");
let rows=[];
const ids=Object.keys(MIG008_TARGETS);

function paidTotal(row,installments=[]){
  const set=new Set(installments.map(Number));
  return (row?.schedule||[]).filter(x=>set.has(Number(x?.n))).reduce((s,x)=>s+Number(x?.paidAmount||0),0);
}

function render(){
  if(!panel)return;
  panel.hidden=false;
  const summary=mig008Summary(rows);
  if(summary.resolved){
    statusBox.className="tf-alert tf-alert-success is-visible";
    statusBox.textContent="MIG-008 resuelta: las 26 cuotas legacy ya están clasificadas como históricas/manuales y las 2 cuotas con movimiento real permanecen fuera de la migración.";
    apply.hidden=true;
  }else if(summary.safe){
    statusBox.className="tf-alert tf-alert-info is-visible";
    statusBox.textContent=`Caso auditado confirmado: ${summary.candidateCount} cuota(s) requieren clasificación histórica. La migración no crea movimientos ni altera montos, fechas o saldos.`;
    apply.hidden=false; apply.disabled=false;
  }else{
    statusBox.className="tf-alert tf-alert-error is-visible";
    statusBox.textContent="MIG-008 bloqueada: los datos reales ya no coinciden con la firma auditada. No se realizará una corrección automática.";
    apply.hidden=false; apply.disabled=true;
  }
  const cards=rows.map(row=>{
    const i=inspectMig008Debt(row);
    const target=i.target||MIG008_TARGETS[row?.id]||{};
    const total=paidTotal(row,target.historicalInstallments||[]);
    const linked=(target.linkedInstallments||[]).join(", ")||"—";
    return `<div class="tf-card" style="padding:.9rem">
      <strong>${escapeHtml(row?.creditor||row?.id||"Registro no encontrado")}</strong>
      <div class="tf-muted">${escapeHtml(row?.concept||"")} · principal ${money(row?.originalPrincipal||0)}</div>
      <div style="margin-top:.4rem">Históricas auditadas: <strong>${(target.historicalInstallments||[]).length}</strong> · pendientes de marcar: <strong>${i.candidates?.length||0}</strong> · total histórico preservado: <strong>${money(total)}</strong></div>
      <div class="tf-muted">Cuota(s) con movimiento real excluidas: ${escapeHtml(linked)}</div>
      ${i.blockers?.length?`<div class="tf-alert tf-alert-error is-visible" style="margin-top:.5rem">${i.blockers.map(escapeHtml).join(" · ")}</div>`:""}
    </div>`;
  }).join("");
  detail.innerHTML=cards + (summary.blockers.length?`<div class="tf-subtle" style="margin-top:.6rem">${summary.blockers.map(escapeHtml).join("<br>")}</div>`:"");
}

async function refresh(){
  rows=await Promise.all(ids.map(id=>getEntity("liabilities",id)));
  render();
}

apply?.addEventListener("click",async()=>{
  await refresh();
  const summary=mig008Summary(rows);
  if(!summary.safe){toast("MIG-008 no coincide con el caso auditado. Requiere reauditoría.");return;}
  if(summary.resolved){toast("MIG-008 ya está resuelta.");return;}
  const total=rows.reduce((s,row)=>{
    const i=inspectMig008Debt(row);return s+paidTotal(row,i.target?.historicalInstallments||[]);
  },0);
  if(!await confirmAction({
    title:"MIG-008 · clasificar pagos históricos",
    message:`Se marcarán ${summary.candidateCount} cuotas legacy como históricas/manuales.`,
    impact:[
      `Se preservan paidDate y paidAmount de las 26 cuotas (total registrado ${money(total)}).`,
      "No se crean movimientos bancarios retroactivos ni se modifica ningún saldo de cuenta.",
      "No se cambian capital, interés, cuota esperada, cronograma, paidThroughInstallment ni estado de la deuda.",
      "Las cuotas 10 (Amparito) y 18 (COAC Politécnica) permanecen como pagos reales porque tienen transactionId.",
      "Cualquier detalle manual existente sin transactionId se conserva íntegramente y queda explícitamente clasificado como histórico."
    ],
    confirmText:"Clasificar 26 cuotas"
  })) return;
  apply.disabled=true;
  try{
    const ops=rows.map(row=>({
      collection:"liabilities",id:row.id,action:"update",auditType:"liability",
      data:{schedule:migrateMig008Schedule(row)},
      note:"MIG-008 · clasificación de cuotas paid legacy sin transactionId como historicalPayment=true; preserva paidDate/paidAmount y no crea movimientos"
    }));
    await atomicWrite(ops);
    await refresh();
    toast("MIG-008 aplicada correctamente.");
  }catch(err){
    console.error(err);toast(err?.message||"No se pudo aplicar MIG-008.");await refresh();
  }
});

requireUser(()=>refresh().catch(err=>{
  console.error(err);
  if(panel)panel.hidden=false;
  if(statusBox){statusBox.className="tf-alert tf-alert-error is-visible";statusBox.textContent="No se pudo verificar MIG-008 contra Firebase.";}
  if(apply)apply.disabled=true;
}));
