import { requireUser } from "./guard.js";
import { listTransactions } from "./data-service.js";
import { monthKey } from "./utils.js";

let transactions = [];
let cashflowChart = null;
let categoryChart = null;

function palette() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  return {
    text: dark ? "#dbe5f5" : "#41516a",
    grid: dark ? "rgba(148,163,184,.16)" : "rgba(100,116,139,.14)",
    surface: dark ? "#111a2b" : "#ffffff",
    income: dark ? "#59cabb" : "#0f9f8f",
    expense: dark ? "#ed8a80" : "#d95d52",
    categories: [
      dark ? "#75a7ff" : "#3f7fdd",
      dark ? "#59cabb" : "#0f9f8f",
      dark ? "#e8b85a" : "#d79018",
      dark ? "#a694ef" : "#7c63d6",
      dark ? "#ed8a80" : "#d95d52",
      dark ? "#78b8df" : "#3f8fc7",
      dark ? "#b6c2d4" : "#7a8798"
    ]
  };
}

function render() {
  const p = palette();
  const months = [...new Set(transactions.map(t => monthKey(t.date)))]
    .sort()
    .slice(-12);

  const income = months.map(m =>
    transactions
      .filter(t => monthKey(t.date) === m && t.type === "income")
      .reduce((s, t) => s + Number(t.amount || 0), 0)
  );

  const expense = months.map(m =>
    transactions
      .filter(t => monthKey(t.date) === m && t.type === "expense")
      .reduce((s, t) => s + Number(t.amount || 0), 0)
  );

  cashflowChart?.destroy();
  cashflowChart = new Chart(document.querySelector("#cashflow-chart"), {
    type: "bar",
    data: {
      labels: months,
      datasets: [
        {
          label: "Ingresos",
          data: income,
          backgroundColor: p.income,
          borderRadius: 7
        },
        {
          label: "Egresos",
          data: expense,
          backgroundColor: p.expense,
          borderRadius: 7
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          labels: {
            color: p.text,
            usePointStyle: true
          }
        }
      },
      scales: {
        x: {
          ticks: { color: p.text },
          grid: { display: false }
        },
        y: {
          ticks: { color: p.text },
          grid: { color: p.grid }
        }
      }
    }
  });

  const cats = {};
  for (const t of transactions.filter(t => t.type === "expense")) {
    if (t.splits?.length) {
      for (const s of t.splits) {
        cats[s.category || "Sin categoría"] =
          (cats[s.category || "Sin categoría"] || 0) +
          Number(s.amount || 0);
      }
    } else {
      cats[t.category || "Sin categoría"] =
        (cats[t.category || "Sin categoría"] || 0) +
        Number(t.amount || 0);
    }
  }

  const rows = Object.entries(cats).sort((a, b) => b[1] - a[1]);

  categoryChart?.destroy();
  categoryChart = new Chart(document.querySelector("#category-chart"), {
    type: "doughnut",
    data: {
      labels: rows.map(([name]) => name),
      datasets: [{
        data: rows.map(([, value]) => value),
        backgroundColor: rows.map((_, i) =>
          p.categories[i % p.categories.length]
        ),
        borderColor: p.surface,
        borderWidth: 3,
        hoverOffset: 5
      }]
    },
    options: {
      responsive: true,
      cutout: "62%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: p.text,
            usePointStyle: true,
            boxWidth: 10,
            padding: 14
          }
        }
      }
    }
  });
}

async function init() {
  transactions = await listTransactions();
  render();
}

window.addEventListener("tf-theme-change", render);
requireUser(() => init().catch(console.error));
