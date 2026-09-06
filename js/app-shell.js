const currentFile = (() => {
  const path = location.pathname.split("/").pop() || "index.html";
  return path.replace(/\.html$/, "") || "index";
})();

const isLogin = currentFile === "index";

const pageGroup = (() => {
  const operation = ["cuentas","movimientos","categorias"];
  const planning = ["presupuestos","plan_mensual","recurrentes","fondo_emergencia","metas"];
  const obligations = ["deudas","seguros","contratos","impuestos"];
  const wealth = ["activos","inversiones"];
  const control = ["conciliacion","importar_exportar","reportes","calendario","auditoria"];
  if (operation.includes(currentFile)) return "operation";
  if (planning.includes(currentFile)) return "planning";
  if (obligations.includes(currentFile)) return "obligations";
  if (wealth.includes(currentFile)) return "wealth";
  if (control.includes(currentFile)) return "control";
  if (currentFile === "perfil") return "profile";
  return "home";
})();

const icon = name => {
  const icons = {
    home: `<svg viewBox="0 0 24 24"><path d="M3 10.8 12 3l9 7.8v9.7a.5.5 0 0 1-.5.5H15v-6H9v6H3.5a.5.5 0 0 1-.5-.5z"/></svg>`,
    wallet: `<svg viewBox="0 0 24 24"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19v16H6.5A2.5 2.5 0 0 1 4 17.5z"/><path d="M4 7h13M15 11h6v5h-6z"/></svg>`,
    arrows: `<svg viewBox="0 0 24 24"><path d="M7 7h12l-3-3m3 3-3 3M17 17H5l3 3m-3-3 3-3"/></svg>`,
    budget: `<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h5M8 16h3"/></svg>`,
    plan: `<svg viewBox="0 0 24 24"><path d="M4 20V7M9 20V11M14 20V4M19 20v-6"/><path d="M3 20h18"/><path d="m5 8 4-3 5 2 5-5"/></svg>`,
    repeat: `<svg viewBox="0 0 24 24"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>`,
    target: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M22 12h-3"/></svg>`,
    card: `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 15h4"/></svg>`,
    shield: `<svg viewBox="0 0 24 24"><path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>`,
    emergency: `<svg viewBox="0 0 24 24"><path d="M12 21s8-4.5 8-11V5l-8-3-8 3v5c0 6.5 8 11 8 11z"/><path d="M12 7v6M9 10h6"/></svg>`,
    tax: `<svg viewBox="0 0 24 24"><path d="M5 3h14v18H5z"/><path d="M8 7h8M8 11h8M8 15h3"/><circle cx="16" cy="16" r="2"/></svg>`,
    box: `<svg viewBox="0 0 24 24"><path d="m4 7 8-4 8 4v10l-8 4-8-4z"/><path d="m4 7 8 4 8-4M12 11v10"/></svg>`,
    chart: `<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`,
    briefcase: `<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M3 12h18"/></svg>`,
    check: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>`,
    upload: `<svg viewBox="0 0 24 24"><path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 15v5h16v-5"/></svg>`,
    report: `<svg viewBox="0 0 24 24"><path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5M8 17v-4M12 17V9M16 17v-6"/></svg>`,
    audit: `<svg viewBox="0 0 24 24"><path d="M4 5h16v16H4z"/><path d="M8 2v6M16 2v6M8 12h8M8 16h5"/></svg>`,
    user: `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-5 3.5-7 8-7s7.2 2 8 7"/></svg>`,
    tags: `<svg viewBox="0 0 24 24"><path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8" cy="8" r="1.5"/></svg>`,
    menu: `<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
    close: `<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>`,
    moon: `<svg viewBox="0 0 24 24"><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5z"/></svg>`,
    sun: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`
  };
  return icons[name] || icons.home;
};

const groups = [
  {
    title: "Principal",
    items: [["dashboard","Resumen","home"]]
  },
  {
    title: "Operación",
    items: [
      ["cuentas","Bancos y cuentas","wallet"],
      ["movimientos","Movimientos","arrows"],
      ["categorias","Categorías","tags"]
    ]
  },
  {
    title: "Planificación",
    items: [
      ["presupuestos","Presupuestos","budget"],
      ["plan_mensual","Plan mensual","plan"],
      ["recurrentes","Recurrentes","repeat"],
      ["fondo_emergencia","Fondo de emergencia","emergency"],
      ["metas","Metas","target"]
    ]
  },
  {
    title: "Obligaciones",
    items: [
      ["deudas","Deudas y tarjetas","card"],
      ["seguros","Seguros","shield"],
      ["contratos","Contratos y cobros","briefcase"],
      ["impuestos","IVA / Impuestos","tax"]
    ]
  },
  {
    title: "Patrimonio",
    items: [
      ["activos","Activos","box"],
      ["inversiones","Inversiones","chart"]
    ]
  },
  {
    title: "Control",
    items: [
      ["conciliacion","Conciliación","check"],
      ["importar_exportar","Importar / Exportar","upload"],
      ["reportes","Reportes","report"],
      ["calendario","Calendario","calendar"],
      ["auditoria","Auditoría","audit"]
    ]
  }
];

function linkItem([file, label, iconName]) {
  const active = currentFile === file;
  return `
    <a class="tf-side-link ${active ? "is-active" : ""}" href="${file}.html">
      <span class="tf-side-icon">${icon(iconName)}</span>
      <span class="tf-side-label">${label}</span>
    </a>
  `;
}

function sidebarHtml() {
  return `
    <aside class="tf-sidebar" data-sidebar>
      <div class="tf-sidebar-brand">
        <div class="tf-brand-mark tf-brand-mark-image" aria-hidden="true">
          <img src="assets/brand/tracker-sirius-mark.svg" alt="">
        </div>
        <div class="tf-brand-copy">
          <strong>Tracker Financiero</strong>
          <span>Personal · Sirius</span>
        </div>
        <button class="tf-icon-button tf-sidebar-close" data-sidebar-close aria-label="Cerrar menú">
          ${icon("close")}
        </button>
      </div>

      <nav class="tf-side-nav">
        ${groups.map(group => `
          <section class="tf-side-group">
            <div class="tf-side-group-title">${group.title}</div>
            ${group.items.map(linkItem).join("")}
          </section>
        `).join("")}
      </nav>

      <div class="tf-sidebar-footer">
        <a class="tf-side-link ${currentFile === "perfil" ? "is-active" : ""}" href="perfil.html">
          <span class="tf-side-icon">${icon("user")}</span>
          <span class="tf-side-label">Perfil y seguridad</span>
        </a>

        <button class="tf-side-link tf-side-theme" type="button" data-app-theme-toggle>
          <span class="tf-side-icon" data-app-theme-icon>${icon("moon")}</span>
          <span class="tf-side-label" data-app-theme-label>Modo oscuro</span>
        </button>
      </div>
    </aside>
    <div class="tf-sidebar-overlay" data-sidebar-overlay></div>
  `;
}

function mobileBarHtml() {
  const title =
    groups.flatMap(g => g.items).find(x => x[0] === currentFile)?.[1] ||
    (currentFile === "perfil" ? "Perfil y seguridad" : "Tracker Financiero");

  return `
    <header class="tf-mobile-bar">
      <button class="tf-icon-button" data-sidebar-open aria-label="Abrir menú">
        ${icon("menu")}
      </button>
      <div class="tf-mobile-title-wrap">
        <img class="tf-mobile-brand-mark" src="assets/brand/tracker-sirius-mark.svg" alt="" aria-hidden="true">
        <div class="tf-mobile-title">${title}</div>
      </div>
      <button class="tf-icon-button" data-mobile-theme-toggle aria-label="Cambiar tema">
        <span data-mobile-theme-icon>${icon("moon")}</span>
      </button>
    </header>
  `;
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("tf-theme-preference", theme);

  const themeMeta=document.querySelector('meta[name="theme-color"]');
  if(themeMeta){
    themeMeta.setAttribute(
      "content",
      theme==="dark" ? "#081525" : "#0C3567"
    );
  }

  const dark = theme === "dark";
  document.querySelectorAll("[data-app-theme-label]").forEach(el => {
    el.textContent = dark ? "Modo claro" : "Modo oscuro";
  });
  document.querySelectorAll("[data-app-theme-icon]").forEach(el => {
    el.innerHTML = dark ? icon("sun") : icon("moon");
  });
  document.querySelectorAll("[data-mobile-theme-icon]").forEach(el => {
    el.innerHTML = dark ? icon("sun") : icon("moon");
  });

  window.dispatchEvent(new CustomEvent("tf-theme-change", {
    detail: { theme }
  }));
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  setTheme(current === "dark" ? "light" : "dark");
}

function openSidebar(open) {
  document.body.classList.toggle("tf-sidebar-open", open);
}

if (!isLogin) {
  document.addEventListener("DOMContentLoaded", () => {
    document.body.dataset.page = currentFile;
    document.body.dataset.group = pageGroup;
    document.body.insertAdjacentHTML("afterbegin", sidebarHtml());
    document.body.insertAdjacentHTML("afterbegin", mobileBarHtml());

    document.querySelector("[data-sidebar-open]")?.addEventListener("click", () => openSidebar(true));
    document.querySelector("[data-sidebar-close]")?.addEventListener("click", () => openSidebar(false));
    document.querySelector("[data-sidebar-overlay]")?.addEventListener("click", () => openSidebar(false));
    document.querySelector("[data-app-theme-toggle]")?.addEventListener("click", toggleTheme);
    document.querySelector("[data-mobile-theme-toggle]")?.addEventListener("click", toggleTheme);

    setTheme(document.documentElement.getAttribute("data-theme") || "light");
  });
}
