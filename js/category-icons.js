import { escapeHtml } from "./utils.js";

export const CATEGORY_COLORS = [
  {id:"blue", label:"Azul"},
  {id:"sky", label:"Celeste"},
  {id:"teal", label:"Teal"},
  {id:"green", label:"Verde"},
  {id:"amber", label:"Ámbar"},
  {id:"coral", label:"Coral"},
  {id:"violet", label:"Violeta"},
  {id:"slate", label:"Gris"}
];

export const CATEGORY_ICONS = [
  ["utensils","Alimentación",`<path d="M7 3v7M4 3v5a3 3 0 0 0 6 0V3M7 11v10M16 3v18M16 3c3 2 4 5 4 8h-4"/>`],
  ["car","Transporte",`<path d="M5 17h14l1-6-2-4H6l-2 4z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M6 11h12"/>`],
  ["home","Vivienda",`<path d="M3 11 12 3l9 8"/><path d="M5 10v11h14V10M9 21v-7h6v7"/>`],
  ["heart","Salud",`<path d="M20.8 5.7c-2.1-2.2-5.6-2.2-7.7 0L12 6.8l-1.1-1.1a5.4 5.4 0 0 0-7.7 7.6L12 22l8.8-8.7a5.4 5.4 0 0 0 0-7.6z"/>`],
  ["graduation","Educación",`<path d="m3 10 9-5 9 5-9 5z"/><path d="M7 13v4c3 2 7 2 10 0v-4M21 10v6"/>`],
  ["film","Entretenimiento",`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M17 9h4M3 15h4M17 15h4"/>`],
  ["shield","Seguros",`<path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/>`],
  ["bolt","Servicios",`<path d="m13 2-8 12h7l-1 8 8-12h-7z"/>`],
  ["bag","Compras",`<path d="M5 8h14l-1 13H6z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>`],
  ["plane","Viajes",`<path d="M22 2 9 15M22 2l-7 20-4-9-9-4z"/>`],
  ["paw","Mascotas",`<circle cx="7" cy="8" r="2"/><circle cx="17" cy="8" r="2"/><circle cx="5" cy="13" r="2"/><circle cx="19" cy="13" r="2"/><path d="M8 19c1.5-4 6.5-4 8 0 1 3-2 3-4 2-2 1-5 1-4-2z"/>`],
  ["receipt","Impuestos",`<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h4"/>`],
  ["credit-card","Comisiones",`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 15h4"/>`],
  ["briefcase","Trabajo",`<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M3 12h18"/>`],
  ["chart","Inversiones",`<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`],
  ["building","Contratos",`<path d="M4 21V6l8-3 8 3v15M8 9h2M14 9h2M8 13h2M14 13h2M9 21v-4h6v4"/>`],
  ["gift","Otros ingresos",`<rect x="4" y="9" width="16" height="12"/><path d="M12 9v12M3 9h18v-4H3z"/><path d="M12 5c-2-4-6-3-5 0h5zm0 0c2-4 6-3 5 0h-5z"/>`],
  ["wallet","Finanzas",`<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19v16H6.5A2.5 2.5 0 0 1 4 17.5z"/><path d="M4 7h13M15 11h6v5h-6z"/>`],
  ["fuel","Combustible",`<path d="M5 3h10v18H5zM7 7h6M15 8h2l2 2v7a2 2 0 0 0 2 2V9l-3-3"/>`],
  ["phone","Telefonía",`<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M10 5h4M11 18h2"/>`],
  ["wifi","Internet",`<path d="M4 9a12 12 0 0 1 16 0M7 12a8 8 0 0 1 10 0M10 15a4 4 0 0 1 4 0"/><circle cx="12" cy="19" r="1"/>`],
  ["dumbbell","Deporte",`<path d="M6 8v8M3 10v4M18 8v8M21 10v4M6 12h12"/>`],
  ["coffee","Café",`<path d="M5 8h11v7a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10h2a3 3 0 0 1 0 6h-2M8 3v2M12 3v2"/>`]
];

const iconMap = new Map(CATEGORY_ICONS.map(([id,label,svg]) => [id,{label,svg}]));

export const UNIQUE_CATEGORY_ICONS = [
  ...new Map(CATEGORY_ICONS.map(item => [item[0], item])).values()
];

export function categoryIconSvg(id="wallet", className="tf-category-icon-svg") {
  const item = iconMap.get(id) || iconMap.get("wallet");
  return `<svg class="${escapeHtml(className)}" viewBox="0 0 24 24" aria-hidden="true">${item.svg}</svg>`;
}

export function categoryBadge({icon="wallet",color="blue",label="",showLabel=false}={}) {
  return `<span class="tf-category-badge tf-cat-${escapeHtml(color)}" title="${escapeHtml(label)}">
    ${categoryIconSvg(icon)}
    ${showLabel ? `<span>${escapeHtml(label)}</span>` : ""}
  </span>`;
}

export function iconOptionHtml(id, selected="wallet") {
  const item=iconMap.get(id) || iconMap.get("wallet");
  const resolvedId=iconMap.has(id) ? id : "wallet";

  return `
    <button
      type="button"
      class="tf-icon-choice ${resolvedId===selected?"is-selected":""}"
      data-icon-choice="${escapeHtml(resolvedId)}"
      title="${escapeHtml(item.label)}"
    >
      ${categoryIconSvg(resolvedId)}
      <span>${escapeHtml(item.label)}</span>
    </button>
  `;
}

export function iconOptionsHtml(selected="wallet") {
  return UNIQUE_CATEGORY_ICONS
    .map(([id]) => iconOptionHtml(id, selected))
    .join("");
}

export function colorOptionsHtml(selected="blue") {
  return CATEGORY_COLORS.map(c => `
    <button type="button" class="tf-color-choice tf-cat-${c.id} ${c.id===selected?"is-selected":""}" data-color-choice="${c.id}" title="${escapeHtml(c.label)}">
      <span></span><small>${escapeHtml(c.label)}</small>
    </button>
  `).join("");
}

export function defaultStyleForName(name="", type="expense") {
  const n = String(name).toLocaleLowerCase("es");
  const rules = [
    [["aliment","comida","restaurant","super"],["utensils","coral"]],
    [["transport","auto","vehic","taxi"],["car","sky"]],
    [["vivi","arriendo","casa","hogar"],["home","teal"]],
    [["salud","médic","medic"],["heart","coral"]],
    [["educ"],["graduation","violet"]],
    [["entreten","ocio","cine"],["film","violet"]],
    [["segur"],["shield","violet"]],
    [["servicio","luz","agua"],["bolt","amber"]],
    [["viaj"],["plane","sky"]],
    [["mascot"],["paw","amber"]],
    [["impuesto"],["receipt","slate"]],
    [["comision"],["credit-card","coral"]],
    [["trabajo","sueldo","salario","honorario"],["briefcase","teal"]],
    [["invers"],["chart","violet"]],
    [["contrato","alquiler","arriendo"],["building","teal"]],
    [["combust"],["fuel","amber"]],
    [["internet"],["wifi","sky"]],
    [["telefon"],["phone","sky"]],
    [["deporte","gym"],["dumbbell","teal"]]
  ];
  for (const [keys, style] of rules) {
    if (keys.some(k => n.includes(k))) return {icon:style[0], color:style[1]};
  }
  return type === "income"
    ? {icon:"wallet",color:"teal"}
    : {icon:"wallet",color:"blue"};
}
