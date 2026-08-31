const STORAGE_KEY = "tf-theme-preference";

function initialTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(STORAGE_KEY, theme);

  const themeMeta=document.querySelector('meta[name="theme-color"]');
  if(themeMeta){
    themeMeta.setAttribute(
      "content",
      theme==="dark" ? "#081525" : "#0C3567"
    );
  }

  const button = document.querySelector("[data-login-theme-toggle]");
  if (button) {
    button.textContent = theme === "dark" ? "☀️ Modo claro" : "🌙 Modo oscuro";
  }

  window.dispatchEvent(new CustomEvent("tf-theme-change", {
    detail: { theme }
  }));
}

document.documentElement.setAttribute("data-theme", initialTheme());

window.addEventListener("DOMContentLoaded", () => {
  const path = location.pathname.split("/").pop() || "index.html";
  const isLogin = path === "index.html" || path === "";

  if (isLogin) {
    const button = document.createElement("button");
    button.className = "tf-login-theme-toggle";
    button.type = "button";
    button.setAttribute("data-login-theme-toggle", "true");
    button.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "light";
      applyTheme(current === "dark" ? "light" : "dark");
    });
    document.body.appendChild(button);
    applyTheme(document.documentElement.getAttribute("data-theme") || initialTheme());
  }
});
