import {
  collection,
  doc,
  getDocsFromServer,
  getDocFromServer
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";
import { requireUser } from "./guard.js";
import { downloadText } from "./utils.js";
import { toast } from "./ui.js";

const COLLECTIONS = [
  "accounts",
  "transactions",
  "budgets",
  "monthlyPlans",
  "categories",
  "recurring",
  "goals",
  "liabilities",
  "financingPlans",
  "insurance",
  "assets",
  "contracts",
  "receivables",
  "investments",
  "reconciliations",
  "taxPayments",
  "emergencyFund",
  "businessTrips",
  "tripExpenses",
  "tripSettlements",
  "auditLog"
];

function serializeFirestoreValue(value) {
  if (value === null || value === undefined) return value ?? null;
  if (["string", "number", "boolean"].includes(typeof value)) return value;

  if (Array.isArray(value)) {
    return value.map(serializeFirestoreValue);
  }

  if (value instanceof Date) {
    return { __type: "Date", iso: value.toISOString() };
  }

  if (typeof value === "object") {
    // Firestore Timestamp
    if (
      typeof value.toDate === "function" &&
      Number.isFinite(value.seconds) &&
      Number.isFinite(value.nanoseconds)
    ) {
      return {
        __type: "Timestamp",
        iso: value.toDate().toISOString(),
        seconds: value.seconds,
        nanoseconds: value.nanoseconds
      };
    }

    // Firestore DocumentReference
    if (typeof value.path === "string" && value.firestore) {
      return { __type: "DocumentReference", path: value.path };
    }

    // Firestore GeoPoint
    if (
      Number.isFinite(value.latitude) &&
      Number.isFinite(value.longitude) &&
      value.constructor?.name === "GeoPoint"
    ) {
      return {
        __type: "GeoPoint",
        latitude: value.latitude,
        longitude: value.longitude
      };
    }

    // Firestore Bytes / Blob
    if (typeof value.toBase64 === "function") {
      try {
        return { __type: "Bytes", base64: value.toBase64() };
      } catch {}
    }

    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = serializeFirestoreValue(item);
    }
    return out;
  }

  return String(value);
}

async function exportCollection(uid, collectionName) {
  const path = `users/${uid}/${collectionName}`;
  try {
    const snapshot = await getDocsFromServer(collection(db, "users", uid, collectionName));
    return {
      name: collectionName,
      path,
      status: snapshot.empty ? "empty" : "ok",
      documentCount: snapshot.size,
      documents: snapshot.docs.map((snap) => ({
        id: snap.id,
        path: snap.ref.path,
        data: serializeFirestoreValue(snap.data())
      }))
    };
  } catch (error) {
    return {
      name: collectionName,
      path,
      status: "error",
      documentCount: null,
      error: {
        code: String(error?.code || "unknown"),
        message: String(error?.message || error || "Error desconocido")
      },
      documents: []
    };
  }
}

async function buildAuditExport(user) {
  const uid = user.uid;
  const rootRef = doc(db, "users", uid);

  let profile;
  try {
    const snap = await getDocFromServer(rootRef);
    profile = {
      id: uid,
      path: rootRef.path,
      status: snap.exists() ? "ok" : "missing",
      data: snap.exists() ? serializeFirestoreValue(snap.data()) : null
    };
  } catch (error) {
    profile = {
      id: uid,
      path: rootRef.path,
      status: "error",
      error: {
        code: String(error?.code || "unknown"),
        message: String(error?.message || error || "Error desconocido")
      },
      data: null
    };
  }

  const collections = {};
  let totalDocuments = 0;
  let okCollections = 0;
  let emptyCollections = 0;
  let errorCollections = 0;

  // Secuencial para evitar una ráfaga innecesaria de lecturas y facilitar diagnóstico.
  for (const name of COLLECTIONS) {
    const result = await exportCollection(uid, name);
    collections[name] = result;
    if (result.status === "ok") okCollections += 1;
    if (result.status === "empty") emptyCollections += 1;
    if (result.status === "error") errorCollections += 1;
    if (Number.isFinite(result.documentCount)) totalDocuments += result.documentCount;
  }

  return {
    metadata: {
      kind: "tracker-financiero-firestore-audit-export",
      exporterVersion: "1.0.0",
      sourceAppVersion: "V1.0.47",
      firebaseProjectId: "tracker-financiero-personal",
      exportedAt: new Date().toISOString(),
      readOnly: true,
      source: "Firestore server reads via authenticated Web SDK",
      userUid: uid,
      userEmail: user.email || "",
      knownCollectionCount: COLLECTIONS.length,
      totalDocuments,
      okCollections,
      emptyCollections,
      errorCollections,
      note: "Exportación RAW de colecciones conocidas para auditoría Paso 1B. No usa normalizadores de data-service.js."
    },
    userProfile: profile,
    collections
  };
}

function setStatus(message, kind = "info") {
  const el = document.querySelector("#audit-export-status");
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind;
}

const button = document.querySelector("#export-audit-raw");

requireUser((user) => {
  if (!button) return;
  button.disabled = false;
  button.dataset.uid = user.uid;
  setStatus("Listo para exportar. La operación es de solo lectura.");
});

button?.addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) {
    toast("No hay un usuario autenticado.");
    return;
  }

  button.disabled = true;
  const original = button.textContent;
  button.textContent = "Exportando…";
  setStatus("Leyendo datos directamente desde Firestore. No cierres esta pestaña.");

  try {
    const payload = await buildAuditExport(user);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `tracker-financiero-auditoria-${date}.json`;
    downloadText(filename, JSON.stringify(payload, null, 2), "application/json");

    const errors = payload.metadata.errorCollections;
    setStatus(
      errors
        ? `Exportación completada con ${errors} colección(es) con error. Puedes subir el JSON: el diagnóstico está incluido.`
        : `Exportación completada: ${payload.metadata.totalDocuments} documento(s) en ${payload.metadata.knownCollectionCount} colecciones revisadas.`,
      errors ? "warning" : "success"
    );
    toast("JSON de auditoría descargado.");
  } catch (error) {
    console.error(error);
    setStatus(`No se pudo exportar: ${error?.message || error}`, "error");
    toast("No se pudo generar la exportación de auditoría.");
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});
