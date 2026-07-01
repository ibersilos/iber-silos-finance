import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const CLIENTS = ["Buzzatti", "Coder SA", "Molino dalla Giovanna", "Presta Silo", "Altro"];
const SUPPLIERS = ["CCI Italia SRLS", "BMB Trasporti", "T-Way (renting)", "La Clau Assessors", "Gestrams", "DKV", "E100", "Altro"];const IVA_TYPES = {
  "21%": 0.21,
  "10%": 0.10,
  "4%": 0.04,
  "RC (reverse charge)": 0,
  "RC art.44 Dir.2006/112/CE": 0,
  "RC art.41 D.L.331/93": 0,
  "art.25 Ley 37/1992": 0,
  "Esente": 0,
  "0%": 0,
  "NoSujeto": 0,
  "IVA IT 22%": 0,   // IVA estera IT — il valore recuperabile è in ivaEsteraAmount, non in ivaAmount
  "IVA FR 20%": 0,
  "IVA DE 19%": 0,
  "IVA AT 20%": 0,
  "IVA BE 21%": 0,
  "RC art.7-ter (intra) NS": 0,
  "IVA 0% (exento)": 0,
};
const IBKR_ETFS = ["VWCE", "VUAA", "SEC0", "C50", "Altro"];
const STORAGE_KEY = "iber-silos-v2";

// ── TAX & FINANCIAL CONSTANTS ─────────────────────────────────────────────────
const IVA_RATES = { IT: 0.22, FR: 0.20, DE: 0.19, AT: 0.20, BE: 0.21, ES: 0.21 };
const AMORT_RATES = { maquinaria: 0.12, equiposInfo: 0.25, vehiculos: 0.16 };
// Direttiva 2008/9/CE art.17: richiesta annuale (resto anno) → soglia €50;
// richiesta trimestrale (≥3 mesi) → soglia €400.
const IVA_ESTERA_SOGLIA_ANNUA = 50;
const IVA_ESTERA_SOGLIA_TRIM  = 400;
const IVA_FLAGS = { IT:"🇮🇹", FR:"🇫🇷", DE:"🇩🇪", AT:"🇦🇹", BE:"🇧🇪" };
// Paesi UE con recupero IVA disponibile per società spagnole (Direttiva 2008/9/CE)
const PAESI_UE_IVA = [
  { code:"ES", label:"Spagna (IVA ordinaria 303)", flag:"🇪🇸", rate: 0.21 },
  { code:"IT", label:"Italia",    flag:"🇮🇹", rate: 0.22 },
  { code:"FR", label:"Francia",   flag:"🇫🇷", rate: 0.20 },
  { code:"DE", label:"Germania",  flag:"🇩🇪", rate: 0.19 },
  { code:"AT", label:"Austria",   flag:"🇦🇹", rate: 0.20 },
  { code:"BE", label:"Belgio",    flag:"🇧🇪", rate: 0.21 },
];

const fmt = (n) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("it-IT") : "—";
const today = () => new Date().toISOString().split("T")[0];
const addDays = (d, n) => { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().split("T")[0]; };
const getPacAmount = (ds) => { const d = new Date(ds); return (d.getFullYear() > 2026 || (d.getFullYear() === 2026 && d.getMonth() >= 6)) ? 500 : 300; };

// Años fiscales Iber-Silos
const EJERCICIOS = [
  { id:"EF1", label:"EF1 (2025)", from:"2025-01-20", to:"2026-01-19" },
  { id:"EF2", label:"EF2 (2026)", from:"2026-01-20", to:"2027-01-19" },
  { id:"todos", label:"Todos", from:"2000-01-01", to:"2099-12-31" },
];

// ── PGC ACCOUNTS ──────────────────────────────────────────────────────────────
const PGC_ACCOUNTS = [
  { code:"100", name:"Capital social", group:"1", tipo:"pasivo" },
  { code:"112", name:"Reserva legal", group:"1", tipo:"pasivo" },
  { code:"120", name:"Remanente", group:"1", tipo:"pasivo" },
  { code:"129", name:"Resultado del ejercicio (PyG)", group:"1", tipo:"pasivo" },
  { code:"224", name:"Maquinaria (compresores)", group:"2", tipo:"activo" },
  { code:"217", name:"Equipos informáticos", group:"2", tipo:"activo" },
  { code:"281", name:"Amortización acumulada inmovilizado material", group:"2", tipo:"activo_contra" },
  { code:"400", name:"Proveedores", group:"4", tipo:"pasivo" },
  { code:"430", name:"Clientes", group:"4", tipo:"activo" },
  { code:"472", name:"HP IVA soportado", group:"4", tipo:"activo" },
  { code:"477", name:"HP IVA repercutido", group:"4", tipo:"pasivo" },
  { code:"475", name:"HP acreedora por IS", group:"4", tipo:"pasivo" },
  { code:"520", name:"Deudas CP con entidades de crédito", group:"5", tipo:"pasivo" },
  { code:"551", name:"Cuenta corriente con socios", group:"5", tipo:"pasivo" },
  { code:"572", name:"Bancos — Revolut Business", group:"5", tipo:"activo" },
  { code:"5721", name:"Bancos — BBVA", group:"5", tipo:"activo" },
  { code:"5722", name:"IBKR SL — Inversiones financieras", group:"5", tipo:"activo" },
  { code:"621", name:"Arrendamientos y cánones (renting/alquiler)", group:"6", tipo:"gasto" },
  { code:"622", name:"Reparaciones y conservación", group:"6", tipo:"gasto" },
  { code:"623", name:"Servicios de profesionales independientes", group:"6", tipo:"gasto" },
  { code:"624", name:"Transportes (subcontratación)", group:"6", tipo:"gasto" },
  { code:"625", name:"Primas de seguros", group:"6", tipo:"gasto" },
  { code:"626", name:"Servicios bancarios y similares", group:"6", tipo:"gasto" },
  { code:"629", name:"Otros servicios", group:"6", tipo:"gasto" },
  { code:"640", name:"Sueldos y salarios", group:"6", tipo:"gasto" },
  { code:"642", name:"Seguridad Social a cargo empresa", group:"6", tipo:"gasto" },
  { code:"681", name:"Amortización del inmovilizado material", group:"6", tipo:"gasto" },
  { code:"705", name:"Prestaciones de servicios (agencia transporte)", group:"7", tipo:"ingreso" },
  { code:"706", name:"Ingresos por alquiler compresores", group:"7", tipo:"ingreso" },
  { code:"769", name:"Otros ingresos financieros", group:"7", tipo:"ingreso" },
];
const ACC_MAP = {};
PGC_ACCOUNTS.forEach(a => { ACC_MAP[a.code] = a; });

// ── FIXED ASSETS ──────────────────────────────────────────────────────────────
const DEFAULT_ASSETS = [
  { id:"comp1", name:"Compresor 1", account:"224", costEur:4000, dateAcq:"2025-01-20", rateAnnual:AMORT_RATES.maquinaria },
  { id:"comp2", name:"Compresor 2", account:"224", costEur:3000, dateAcq:"2025-01-20", rateAnnual:AMORT_RATES.maquinaria },
];

function calcAmortYear(asset, year) {
  const acqDate = new Date(asset.dateAcq);
  const acqYear = acqDate.getFullYear();
  if (year < acqYear) return 0;
  const annualAmt = asset.costEur * asset.rateAnnual;
  const acqStartDay = Math.floor((acqDate - new Date(acqYear, 0, 1)) / 86400000);
  const acqYearQuota = parseFloat(((annualAmt * (365 - acqStartDay)) / 365).toFixed(2));
  if (year === acqYear) return acqYearQuota;
  let accumulated = acqYearQuota;
  for (let y = acqYear + 1; y < year; y++) {
    accumulated += Math.min(annualAmt, Math.max(0, asset.costEur - accumulated));
  }
  return Math.min(annualAmt, Math.max(0, asset.costEur - accumulated));
}

function calcAmortAccumulated(asset, upToYear) {
  let total = 0;
  for (let y = new Date(asset.dateAcq).getFullYear(); y <= upToYear; y++) {
    total += calcAmortYear(asset, y);
  }
  return Math.min(total, asset.costEur);
}

// ── STORAGE ───────────────────────────────────────────────────────────────────
// Campi IVA estera introdotti con Step A — valori neutri per fatture esistenti
const IVA_ESTERA_DEFAULTS = {
  paisIvaOrigen:    "ES",   // default Spagna = IVA ordinaria 303, nessuna pratica UE
  vatForeignNumber: "",
  ivaEsteraBase:    0,
  ivaEsteraRate:    0,
  ivaEsteraAmount:  0,
};

function migrateInvoice(inv) {
  if (inv.type !== "ricevuta") return inv;
  const migrated = { ...inv };
  Object.entries(IVA_ESTERA_DEFAULTS).forEach(([k, v]) => {
    if (migrated[k] === undefined || migrated[k] === null) migrated[k] = v;
  });
  return migrated;
}

async function loadData() {
  try {
    const res = localStorage.getItem(STORAGE_KEY);
    if (res) {
      const d = JSON.parse(res);
      if (!d.asientos)          d.asientos          = [];
      if (!d.fixedAssets)       d.fixedAssets       = DEFAULT_ASSETS;
      if (!d.ibkrPositions)     d.ibkrPositions     = [];
      if (!d.ibkrPrices)        d.ibkrPrices        = {};
      if (!d.ivaEsteraStatus)   d.ivaEsteraStatus   = {};
      if (!d.acciseStatus)      d.acciseStatus      = {};
      // Migration: aggiunge campi IVA estera a tutte le fatture ricevute esistenti
      if (d.invoices) d.invoices = d.invoices.map(migrateInvoice);
      return d;
    }
  } catch {}
  return { invoices: [], movements: [], ibkrPositions: [], ibkrPrices: {}, asientos: [], fixedAssets: DEFAULT_ASSETS, ivaEsteraStatus: {}, acciseStatus: {} };
}
function saveData(data, onError) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  catch (e) { if (onError) onError("⚠ Errore salvataggio: " + e.message); }
}

// ── RECONCILIATION ────────────────────────────────────────────────────────────
function autoReconcile(movements, invoices) {
  const updated = movements.map(m => ({ ...m }));
  const claimedIds = new Set(updated.filter(m => m.reconciled && m.invoiceId).map(m => m.invoiceId));
  updated.forEach(mov => {
    if (mov.reconciled || mov.invoiceId) return;
    const amt = Math.abs(parseFloat(mov.amount) || 0);
    const movDate = new Date(mov.date);
    const candidates = invoices.filter(inv => {
      if (claimedIds.has(inv.id)) return false;
      if (mov.type === "entrata" && inv.type !== "emessa") return false;
      if (mov.type === "uscita" && inv.type !== "ricevuta") return false;
      if (inv.status === "riconciliata") return false;
      if (Math.abs((parseFloat(inv.grossAmount) || 0) - amt) > 0.05) return false;
      return Math.abs((new Date(inv.dueDate || inv.date) - movDate) / 86400000) <= 10;
    });
    if (candidates.length === 1) {
      mov.invoiceId = candidates[0].id; mov.reconciled = true; mov._autoMatch = true;
      claimedIds.add(candidates[0].id);
    }
  });
  return updated;
}

// ── FORECAST ──────────────────────────────────────────────────────────────────
function buildForecast(invoices, movements) {
  const baseDate = new Date();
  // Saldo reale = tutti i movimenti cumulati
  const lastBalance = movements.reduce((acc, m) => acc + (m.type === "entrata" ? 1 : -1) * (parseFloat(m.amount) || 0), 0);
  const events = [];
  invoices.forEach(inv => {
    if (inv.status === "riconciliata" || inv.status === "annullata") return;
    const due = new Date(inv.dueDate || (inv.date ? addDays(inv.date, 30) : addDays(today(), 30)));
    const diff = Math.ceil((due - baseDate) / 86400000);
    if (diff < -5 || diff > 90) return;
    events.push({ day: Math.max(0, diff), amount: inv.type === "emessa" ? (parseFloat(inv.grossAmount)||0) : -(parseFloat(inv.grossAmount)||0) });
  });
  const points = [];
  let running = lastBalance;
  for (let d = 0; d <= 90; d += 3) {
    events.filter(e => e.day >= d && e.day < d + 3).forEach(e => { running += e.amount; });
    const dt = new Date(baseDate); dt.setDate(dt.getDate() + d);
    points.push({ day: dt.toLocaleDateString("it-IT", { day: "2-digit", month: "short" }), balance: parseFloat(running.toFixed(2)) });
  }
  return points;
}

// ── PARSE REVOLUT PDF ─────────────────────────────────────────────────────────
// Legge estratto conto Revolut Business in PDF (formato testo nativo, non scansione)
// Struttura attesa per riga transazione:
//   "DD mmm YYYY  [TIPO]  Descrizione  [€X.XXX,XX]  [€X.XXX,XX]  €X.XXX,XX"
// dove il primo importo opzionale è uscita, il secondo entrata, il terzo saldo

async function parseRevolutPDF(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        // Usa pdf.js via CDN per estrarre testo dal PDF
        const pdfjsLib = await loadPdfJs();
        const typedArray = new Uint8Array(e.target.result);
        const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;

        let allText = "";
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const content = await page.getTextContent();
          // Ricostruisce le righe ordinando per posizione Y (top→bottom), poi X
          const items = content.items
            .filter(item => item.str.trim())
            .sort((a, b) => {
              const yDiff = Math.round(b.transform[5]) - Math.round(a.transform[5]);
              return yDiff !== 0 ? yDiff : a.transform[4] - b.transform[4];
            });
          // Raggruppa per riga (stessa coordinata Y ± 3px)
          const rows = [];
          let currentRow = [], lastY = null;
          for (const item of items) {
            const y = Math.round(item.transform[5]);
            if (lastY !== null && Math.abs(y - lastY) > 3) {
              if (currentRow.length) rows.push(currentRow.join(" "));
              currentRow = [];
            }
            currentRow.push(item.str.trim());
            lastY = y;
          }
          if (currentRow.length) rows.push(currentRow.join(" "));
          allText += rows.join("\n") + "\n";
        }

        resolve(parseRevolutText(allText));
      } catch (err) {
        reject(new Error("Errore lettura PDF: " + err.message));
      }
    };
    reader.onerror = () => reject(new Error("Errore lettura file"));
    reader.readAsArrayBuffer(file);
  });
}

// Carica pdf.js dinamicamente (evita bundling)
let _pdfjsLib = null;
async function loadPdfJs() {
  if (_pdfjsLib) return _pdfjsLib;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      _pdfjsLib = window.pdfjsLib;
      resolve(_pdfjsLib);
    };
    script.onerror = () => reject(new Error("pdf.js CDN non raggiungibile. Verifica la connessione internet e riprova."));
    document.head.appendChild(script);
  });
}

// Parser del testo estratto dal PDF Revolut Business
function parseRevolutText(text) {
  const results = [];

  // Mappa mesi italiani → numero
  const MESI = { gen:1,feb:2,mar:3,apr:4,mag:5,giu:6,lug:7,ago:8,set:9,ott:10,nov:11,dic:12 };

  // Regex data: "29 apr 2026" o "09 apr 2026"
  const reDate = /^(\d{1,2})\s+(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)\s+(\d{4})/i;

  // Regex importo Revolut: "€1.234,56" o "€234,56" o "€10"
  const reAmt  = /€([\d.]+,\d{2}|[\d]+)/g;

  // Tipi transazione Revolut
  const TIPOS = /^(MOS|MOA|CAR|FEE|SLD|CRE|CAS|TOP|EXC)\b/;

  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const dateMatch = line.match(reDate);
    if (!dateMatch) continue;

    const day   = dateMatch[1].padStart(2, "0");
    const month = String(MESI[dateMatch[2].toLowerCase()]).padStart(2, "0");
    const year  = dateMatch[3];
    const isoDate = `${year}-${month}-${day}`;

    // Resto della riga dopo la data
    const rest = line.slice(dateMatch[0].length).trim();

    // Tipo (opzionale, 3 lettere maiuscole)
    const tipoMatch = rest.match(TIPOS);
    const tipo = tipoMatch ? tipoMatch[1] : "";
    const afterTipo = tipoMatch ? rest.slice(tipoMatch[0].length).trim() : rest;

    // Estrae tutti gli importi dalla riga
    const amts = [];
    let m;
    reAmt.lastIndex = 0;
    while ((m = reAmt.exec(afterTipo)) !== null) {
      // Converte formato IT "1.234,56" → float
      const val = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
      if (!isNaN(val)) amts.push(val);
    }
    if (amts.length === 0) continue;

    // Descrizione = testo prima del primo importo
    const firstAmtIdx = afterTipo.search(/€/);
    const description = (firstAmtIdx > 0 ? afterTipo.slice(0, firstAmtIdx) : afterTipo)
      .trim().replace(/\s+/g, " ");

    // Logica importi:
    // Se 3 importi: [uscita, entrata, saldo] — uno dei primi due è 0 (non compare se vuoto)
    // Se 2 importi: [importo, saldo]
    // Se 1 importo: saldo o importo ambiguo
    // Il tipo MOS/CAR/FEE = uscita, MOA/CRE = entrata
    let amount = 0;
    let type = "uscita";

    if (amts.length >= 2) {
      // Con 3 importi il parser pdf.js a volte collassa uscita+entrata
      // Usiamo il tipo per discriminare
      if (tipo === "MOA" || tipo === "CRE") {
        // Entrata: prendo il valore più grande (saldo è sempre il maggiore di solito)
        // ma non il saldo — prendo il primo o secondo a seconda del layout
        amount = amts[0];
        type   = "entrata";
      } else {
        amount = amts[0];
        type   = "uscita";
      }
    } else if (amts.length === 1) {
      amount = amts[0];
      type   = (tipo === "MOA" || tipo === "CRE") ? "entrata" : "uscita";
    }

    if (amount <= 0 || !description) continue;

    results.push({
      id: `imp-${Date.now()}-${i}`,
      date: isoDate,
      description,
      amount,
      type,
      account: "Revolut Business",
      invoiceId: null,
      reconciled: false,
      notes: tipo ? `[${tipo}]` : ""
    });
  }

  return results;
}

// ── LOGO ──────────────────────────────────────────────────────────────────────
const IbersilosLogo = ({ height = 42 }) => (
  <div style={{ padding:"4px 8px", background:"white", borderRadius:6, display:"inline-flex", alignItems:"center" }}>
    <img src="/iber-silos-finance/logo.png" alt="Ibersilos" style={{ height, width:"auto", display:"block" }} />
  </div>
);

// ── NAV ICONS (Feather-style SVG) ─────────────────────────────────────────────
const Icon = ({ d, d2, rect, poly, circle, size=16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
    {d && <path d={d} />}
    {d2 && <path d={d2} />}
    {rect && <rect {...rect} />}
    {poly && <polyline points={poly} />}
    {circle && <circle {...circle} />}
  </svg>
);

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
// ── FATTURE APERTE MODAL ─────────────────────────────────────────────────────
function FattureAperteModal({ invoices, onClose }) {
  const emesseAperte = invoices.filter(i => i.type === "emessa" && i.status === "aperta");
  const ricevuteAperte = invoices.filter(i => i.type === "ricevuta" && i.status === "aperta");
  const totCrediti = emesseAperte.reduce((s, i) => s + (parseFloat(i.grossAmount) || 0), 0);
  const totDebiti  = ricevuteAperte.reduce((s, i) => s + (parseFloat(i.grossAmount) || 0), 0);
  const todayStr   = new Date().toISOString().split("T")[0];

  const rowStyle = (inv) => ({
    background: inv.dueDate && inv.dueDate < todayStr ? "#fff5f5" : "white",
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:720 }} onClick={e => e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div className="modal-title">📋 Facturas Abiertas</div>
          <button onClick={onClose} style={{ background:"none", fontSize:20, color:"#999" }}>×</button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:20 }}>
          <div style={{ background:"#e8f5e9", border:"1.5px solid #a5d6a7", borderRadius:10, padding:"12px 16px" }}>
            <div style={{ fontSize:10, fontWeight:700, color:"#2e7d32", letterSpacing:"0.1em", textTransform:"uppercase" }}>Créditos activos</div>
            <div style={{ fontSize:22, fontWeight:800, color:"#28a745", marginTop:4 }}>{fmt(totCrediti)}</div>
            <div style={{ fontSize:11, color:"#999", marginTop:2 }}>{emesseAperte.length} facturas emitidas</div>
          </div>
          <div style={{ background:"#ffebee", border:"1.5px solid #ef9a9a", borderRadius:10, padding:"12px 16px" }}>
            <div style={{ fontSize:10, fontWeight:700, color:"#c62828", letterSpacing:"0.1em", textTransform:"uppercase" }}>Débitos abiertos</div>
            <div style={{ fontSize:22, fontWeight:800, color:"#E30613", marginTop:4 }}>{fmt(totDebiti)}</div>
            <div style={{ fontSize:11, color:"#999", marginTop:2 }}>{ricevuteAperte.length} facturas recibidas</div>
          </div>
          <div style={{ background: totCrediti - totDebiti >= 0 ? "#e8f5e9" : "#ffebee", border:`1.5px solid ${totCrediti-totDebiti>=0?"#a5d6a7":"#ef9a9a"}`, borderRadius:10, padding:"12px 16px" }}>
            <div style={{ fontSize:10, fontWeight:700, color:"#666", letterSpacing:"0.1em", textTransform:"uppercase" }}>Saldo neto</div>
            <div style={{ fontSize:22, fontWeight:800, color: totCrediti-totDebiti >= 0 ? "#28a745" : "#E30613", marginTop:4 }}>{fmt(totCrediti - totDebiti)}</div>
            <div style={{ fontSize:11, color:"#999", marginTop:2 }}>{emesseAperte.length + ricevuteAperte.length} en total abiertas</div>
          </div>
        </div>
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"1.5px", textTransform:"uppercase", color:"#28a745", marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ width:10, height:10, background:"#28a745", borderRadius:2, display:"inline-block" }} />
            Facturas Emitidas — Por cobrar
          </div>
          {emesseAperte.length === 0 ? (
            <div style={{ color:"#bbb", fontSize:13, padding:"10px 0" }}>Sin facturas emitidas abiertas ✅</div>
          ) : (
            <table>
              <thead><tr><th>N°</th><th>Fecha</th><th>Venc.</th><th>Cliente</th><th style={{ textAlign:"right" }}>Total</th><th>Note</th></tr></thead>
              <tbody>
                {[...emesseAperte].sort((a,b) => (a.dueDate||a.date).localeCompare(b.dueDate||b.date)).map(inv => (
                  <tr key={inv.id} style={rowStyle(inv)}>
                    <td style={{ fontWeight:700, color:"#E30613" }}>{inv.number || "—"}</td>
                    <td style={{ color:"#999", fontSize:12 }}>{fmtDate(inv.date)}</td>
                    <td style={{ color: inv.dueDate && inv.dueDate < todayStr ? "#E30613" : "#999", fontWeight: inv.dueDate && inv.dueDate < todayStr ? 700 : 400, fontSize:12 }}>
                      {fmtDate(inv.dueDate)} {inv.dueDate && inv.dueDate < todayStr && "⚠️"}
                    </td>
                    <td style={{ fontWeight:600 }}>{inv.client || "—"}</td>
                    <td style={{ textAlign:"right", fontWeight:700, color:"#28a745" }}>{fmt(inv.grossAmount)}</td>
                    <td style={{ fontSize:11, color:"#bbb", maxWidth:140, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{inv.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"1.5px", textTransform:"uppercase", color:"#E30613", marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ width:10, height:10, background:"#E30613", borderRadius:2, display:"inline-block" }} />
            Facturas Recibidas — Por pagar
          </div>
          {ricevuteAperte.length === 0 ? (
            <div style={{ color:"#bbb", fontSize:13, padding:"10px 0" }}>Sin facturas recibidas abiertas ✅</div>
          ) : (
            <table>
              <thead><tr><th>N°</th><th>Fecha</th><th>Venc.</th><th>Proveedor</th><th style={{ textAlign:"right" }}>Total</th><th>Note</th></tr></thead>
              <tbody>
                {[...ricevuteAperte].sort((a,b) => (a.dueDate||a.date).localeCompare(b.dueDate||b.date)).map(inv => (
                  <tr key={inv.id} style={rowStyle(inv)}>
                    <td style={{ fontWeight:700, color:"#E30613" }}>{inv.number || "—"}</td>
                    <td style={{ color:"#999", fontSize:12 }}>{fmtDate(inv.date)}</td>
                    <td style={{ color: inv.dueDate && inv.dueDate < todayStr ? "#E30613" : "#999", fontWeight: inv.dueDate && inv.dueDate < todayStr ? 700 : 400, fontSize:12 }}>
                      {fmtDate(inv.dueDate)} {inv.dueDate && inv.dueDate < todayStr && "⚠️"}
                    </td>
                    <td style={{ fontWeight:600 }}>{inv.supplier || "—"}</td>
                    <td style={{ textAlign:"right", fontWeight:700, color:"#E30613" }}>{fmt(inv.grossAmount)}</td>
                    <td style={{ fontSize:11, color:"#bbb", maxWidth:140, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{inv.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <button className="btn-ghost" style={{ width:"100%", marginTop:20 }} onClick={onClose}>Cerrar</button>
      </div>
    </div>
  );
}

// ── CONFIRM MODAL ─────────────────────────────────────────────────────────────
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth:360 }} onClick={e=>e.stopPropagation()}>
        <div style={{ fontSize:32, textAlign:"center", marginBottom:12 }}>🗑️</div>
        <div style={{ fontSize:15, fontWeight:700, textAlign:"center", marginBottom:8 }}>¿Confirmar eliminación?</div>
        <div style={{ fontSize:13, color:"#666", textAlign:"center", marginBottom:24 }}>{message || "Esta acción no se puede deshacer."}</div>
        <div style={{ display:"flex", gap:10 }}>
          <button className="btn-ghost" style={{ flex:1 }} onClick={onCancel}>Cancelar</button>
          <button className="btn-red" style={{ flex:1 }} onClick={onConfirm}>Eliminar</button>
        </div>
      </div>
    </div>
  );
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
// SEC-1 fix: PIN memorizzato come SHA-256 — non leggibile in plaintext
// Hash generato con: SHA-256(userId.toUpperCase() + ':' + pin)
// Per aggiornare il PIN: node -e "const c=require('crypto'); console.log(c.createHash('sha256').update('AC001:NUOVO_PIN').digest('hex'))"
const USERS = {
  'AC001': 'ccb82fbb38213f3a2753138f3451cd57de9d532f1197484e9d2bd70d08c11261',
};

// Calcola SHA-256 usando Web Crypto API (disponibile in tutti i browser moderni)
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function LoginScreen({ onLogin }) {
  const [userId, setUserId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [errFields, setErrFields] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(() => {
    const a = sessionStorage.getItem('ibs_attempts');
    return a ? parseInt(a, 10) : 0;
  });
  const [lockedUntil, setLockedUntil] = useState(() => {
    const t = sessionStorage.getItem('ibs_locked');
    return t ? parseInt(t, 10) : 0;
  });

  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS = 5 * 60 * 1000; // 5 minuti

  const doLogin = async () => {
    const now = Date.now();
    if (lockedUntil > now) {
      const remaining = Math.ceil((lockedUntil - now) / 1000);
      setErr(`Troppi tentativi. Riprova tra ${remaining}s.`);
      return;
    }
    const uid = userId.trim().toUpperCase();
    const expectedHash = USERS[uid];
    if (!expectedHash) {
      setErr('Credenziali non valide. Riprova.');
      setErrFields(true);
      setPw('');
      setTimeout(() => { setErr(''); setErrFields(false); }, 3000);
      return;
    }
    setLoading(true);
    try {
      const inputHash = await sha256(uid + ':' + pw.trim());
      if (inputHash !== expectedHash) {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        sessionStorage.setItem('ibs_attempts', newAttempts);
        if (newAttempts >= MAX_ATTEMPTS) {
          const until = Date.now() + LOCKOUT_MS;
          setLockedUntil(until);
          sessionStorage.setItem('ibs_locked', until);
          setErr(`Accesso bloccato per 5 minuti.`);
        } else {
          setErr(`Credenziali non valide. Tentativi rimasti: ${MAX_ATTEMPTS - newAttempts}`);
        }
        setErrFields(true);
        setPw('');
        setTimeout(() => { setErr(''); setErrFields(false); }, 4000);
        return;
      }
      sessionStorage.setItem('ibs_auth', inputHash);
      sessionStorage.removeItem('ibs_attempts');
      sessionStorage.removeItem('ibs_locked');
      onLogin();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'white', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', fontFamily:"'Segoe UI',Roboto,Arial,sans-serif", zIndex:9999 }}>
      <div style={{ position:'fixed', top:0, left:0, right:0, height:4, background:'#F5C800' }} />
      <div style={{ position:'fixed', top:4, left:0, right:0, height:4, background:'#E30613' }} />
      <div style={{ width:360, maxWidth:'96vw', background:'white', borderRadius:12, boxShadow:'0 4px 32px rgba(0,0,0,0.10)', border:'1px solid #ebebeb', overflow:'hidden' }}>
        <div style={{ background:'white', padding:'36px 32px 24px', textAlign:'center', borderBottom:'1px solid #f0f0f0' }}>
          <img src="/iber-silos-finance/logo.png" alt="Ibersilos" style={{ height:110, width:'auto', display:'block', margin:'0 auto 16px' }} />
          <p style={{ color:'#aaa', fontSize:11, margin:0, letterSpacing:'0.8px', textTransform:'uppercase', fontFamily:"'DM Sans','Segoe UI',sans-serif" }}>Gestión Financiera · Reus, Tarragona</p>
        </div>
        <div style={{ padding:'28px 32px' }}>
          <div style={{ marginBottom:16 }}>
            <label style={{ display:'block', fontSize:10, fontWeight:700, color:'#999', textTransform:'uppercase', letterSpacing:'0.8px', marginBottom:6 }}>ID Utente</label>
            <input type="text" value={userId} placeholder="es. AC001" onChange={e => setUserId(e.target.value)} onKeyDown={e => e.key === 'Enter' && document.getElementById('ibs-pw').focus()} style={{ width:'100%', padding:'11px 13px', border:`1.5px solid ${errFields?'#E30613':'#e0e0e0'}`, borderRadius:8, fontSize:15, fontFamily:'inherit', outline:'none', boxSizing:'border-box', background:errFields?'#fff5f5':'#fafafa', color:'#1a1a1a' }} />
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={{ display:'block', fontSize:10, fontWeight:700, color:'#999', textTransform:'uppercase', letterSpacing:'0.8px', marginBottom:6 }}>Password</label>
            <input id="ibs-pw" type="password" value={pw} placeholder="••••" onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && doLogin()} style={{ width:'100%', padding:'11px 13px', border:`1.5px solid ${errFields?'#E30613':'#e0e0e0'}`, borderRadius:8, fontSize:15, fontFamily:'inherit', outline:'none', boxSizing:'border-box', background:errFields?'#fff5f5':'#fafafa', color:'#1a1a1a' }} />
          </div>
          <div style={{ color:'#E30613', fontSize:12, fontWeight:700, textAlign:'center', marginBottom:14, minHeight:18 }}>{err}</div>
          <button onClick={doLogin} disabled={loading} style={{ width:'100%', padding:13, background: loading?'#aaa':'#E30613', color:'white', border:'none', borderRadius:8, fontSize:14, fontWeight:800, cursor: loading?'not-allowed':'pointer', letterSpacing:'0.3px', boxShadow:'0 2px 8px rgba(227,6,19,0.25)' }}>{loading ? '...' : 'Accedi'}</button>
        </div>
      </div>
    </div>
  );
}

// ── IVA ESTERA TAB ────────────────────────────────────────────────────────────
const PAESI_INFO = [
  { code:"IT", flag:"🇮🇹", label:"Italia",   aliquota:0.22, portale:"Portale VIES + Agenzia Entrate IT", scadenza:"30/09 anno succ.", normativa:"Dir. 2008/9/CE" },
  { code:"FR", flag:"🇫🇷", label:"Francia",  aliquota:0.20, portale:"impots.gouv.fr — Service des impôts", scadenza:"30/09 anno succ.", normativa:"Dir. 2008/9/CE" },
  { code:"DE", flag:"🇩🇪", label:"Germania", aliquota:0.19, portale:"BZSt Online-Portal (BOP)", scadenza:"30/09 anno succ.", normativa:"Dir. 2008/9/CE" },
  { code:"AT", flag:"🇦🇹", label:"Austria",  aliquota:0.20, portale:"FinanzOnline Austria", scadenza:"30/09 anno succ.", normativa:"Dir. 2008/9/CE" },
  { code:"BE", flag:"🇧🇪", label:"Belgio",   aliquota:0.21, portale:"MyMinfin — SPF Finances", scadenza:"30/09 anno succ.", normativa:"Dir. 2008/9/CE" },
];
const IVA_STATUS_OPTS = [
  { id:"pending",  label:"Da avviare",   color:"#999",    bg:"#F5F5F5" },
  { id:"open",     label:"Pratica aperta", color:"#b8860b", bg:"#fffde7" },
  { id:"sent",     label:"Inviata",      color:"#3949ab", bg:"#e8eaf6" },
  { id:"received", label:"Ricevuta ✓",   color:"#28a745", bg:"#e8f5e9" },
];

function IvaEsteraStatusModal({ paese, status, onClose, onSave }) {
  const pi = PAESI_INFO.find(p => p.code === paese);
  const [form, setForm] = useState({ ...status });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:420 }} onClick={e => e.stopPropagation()}>
        <div style={{ display:"flex",justifyContent:"space-between",marginBottom:20 }}>
          <div className="modal-title">{pi?.flag} {pi?.label} — Stato pratica</div>
          <button onClick={onClose} style={{ background:"none",fontSize:20,color:"#999" }}>×</button>
        </div>
        <div style={{ background:"#FAFAFA",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#666" }}>
          <strong>Portale:</strong> {pi?.portale}<br/>
          <strong>Scadenza:</strong> {pi?.scadenza} · {pi?.normativa}
        </div>
        <div className="form-row">
          <div>
            <label>Stato pratica</label>
            <select value={form.stato} onChange={e => set("stato", e.target.value)}>
              {IVA_STATUS_OPTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row form-row-2">
          <div><label>Data invio</label><input type="date" value={form.dataInvio||""} onChange={e => set("dataInvio", e.target.value)} /></div>
          <div><label>Importo ricevuto (€)</label><input type="number" step="0.01" value={form.importoRicevuto||""} onChange={e => set("importoRicevuto", e.target.value)} placeholder="0.00" /></div>
        </div>
        <div className="form-row">
          <div><label>Note</label><textarea value={form.note||""} onChange={e => set("note", e.target.value)} rows={2} placeholder="Note pratica..." /></div>
        </div>
        <div style={{ display:"flex",gap:10,marginTop:4 }}>
          <button className="btn-ghost" style={{ flex:1 }} onClick={onClose}>Cancelar</button>
          <button className="btn-red" style={{ flex:1 }} onClick={() => onSave(paese, form)}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

function IvaEsteraTab({ data, persist, ejercicio, EJERCICIOS, exportIvaEsteraCSV }) {
  const ej   = EJERCICIOS.find(e=>e.id===ejercicio) || EJERCICIOS[1];
  const anno = ej.from.slice(0,4);
  const [selectedPaese, setSelectedPaese] = useState(null);
  const [statusModal, setStatusModal] = useState(null); // { paese, ej }
  const [filterPaese, setFilterPaese] = useState("ALL");

  const trimestri = [
    { id:"T1", mesi:[1,2,3], label:"T1 Gen–Mar", scad:`30/04/${anno}` },
    { id:"T2", mesi:[4,5,6], label:"T2 Apr–Giu", scad:`31/07/${anno}` },
    { id:"T3", mesi:[7,8,9], label:"T3 Lug–Set", scad:`31/10/${anno}` },
    { id:"T4", mesi:[10,11,12], label:"T4 Ott–Dic", scad:`31/01/${parseInt(anno)+1}` },
  ];

  // Calcolo IVA per paese e trimestre
  const calc = useMemo(() => {
    const byPaese = {};
    const byTrim  = {};
    PAESI_INFO.forEach(p => { byPaese[p.code] = { tot:0, fatture:[] }; });
    trimestri.forEach(t => { byTrim[t.id] = { tot:0, ...Object.fromEntries(PAESI_INFO.map(p=>[p.code,0])) }; });

    data.invoices.forEach(inv => {
      if (inv.type !== "ricevuta") return;
      const d = inv.fechaOperacion || inv.date || "";
      if (!d || d < ej.from || d > ej.to) return;
      const p = inv.paisIvaOrigen;
      if (!p || p === "ES" || !byPaese[p]) return;
      const iva = parseFloat(inv.ivaEsteraAmount) || 0;
      if (iva <= 0) return;
      const mo = parseInt(d.slice(5,7));
      const t  = mo<=3?"T1":mo<=6?"T2":mo<=9?"T3":"T4";
      byPaese[p].tot += iva;
      byPaese[p].fatture.push({ ...inv, _trim:t });
      byTrim[t][p] += iva;
      byTrim[t].tot += iva;
    });
    const totale = Object.values(byPaese).reduce((s,p)=>s+p.tot,0);
    return { byPaese, byTrim, totale };
  }, [data.invoices, ejercicio]);

  const getStatus = (paese) => {
    const key = `${ej.id}_${paese}`;
    return data.ivaEsteraStatus?.[key] || { stato:"pending", dataInvio:"", importoRicevuto:"", note:"" };
  };

  const saveStatus = (paese, updates) => {
    const key = `${ej.id}_${paese}`;
    const current = getStatus(paese);
    persist({ ...data, ivaEsteraStatus: { ...(data.ivaEsteraStatus||{}), [key]: { ...current, ...updates } } });
    setStatusModal(null);
  };

  // Fatture filtrate per la tabella in basso
  const fattureVisibili = useMemo(() => {
    let list = data.invoices.filter(inv => {
      if (inv.type !== "ricevuta") return false;
      const d = inv.fechaOperacion || inv.date || "";
      if (!d || d < ej.from || d > ej.to) return false;
      if (!inv.paisIvaOrigen || inv.paisIvaOrigen === "ES") return false;
      if (!(parseFloat(inv.ivaEsteraAmount) > 0)) return false;
      if (filterPaese !== "ALL" && inv.paisIvaOrigen !== filterPaese) return false;
      return true;
    });
    return list.sort((a,b)=>(b.fechaOperacion||b.date||"").localeCompare(a.fechaOperacion||a.date||""));
  }, [data.invoices, ejercicio, filterPaese]);

  const fmtN = v => new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR",minimumFractionDigits:2}).format(v||0);

  const scadAnno = parseInt(anno) + 1;
  const scadDate = new Date(`${scadAnno}-09-30`);
  const daysLeft = Math.ceil((scadDate - new Date()) / 86400000);
  const scadColor = daysLeft <= 60 ? "#E30613" : daysLeft <= 180 ? "#b8860b" : "#28a745";

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
        <div className="section-title">Recupero IVA Estera — Dir. 2008/9/CE</div>
        <div style={{ fontSize:11,color:"#999",fontFamily:"'IBM Plex Mono',monospace" }}>
          Soglia annuale: <strong style={{color:"#1A1A1A"}}>€{IVA_ESTERA_SOGLIA_ANNUA}</strong> · Soglia trimestrale: <strong style={{color:"#1A1A1A"}}>€{IVA_ESTERA_SOGLIA_TRIM}</strong>
        </div>
      </div>
      {/* Scadenza countdown */}
      <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:16,padding:"8px 14px",background:`${scadColor}11`,border:`1.5px solid ${scadColor}33`,borderRadius:8 }}>
        <span style={{ fontSize:18 }}>{daysLeft<=60?"🔴":daysLeft<=180?"🟡":"🟢"}</span>
        <div>
          <span style={{ fontSize:12,fontWeight:700,color:scadColor }}>Scadenza Dir. 2008/9/CE: 30/09/{scadAnno}</span>
          <span style={{ fontSize:11,color:"#666",marginLeft:10 }}>
            {daysLeft > 0 ? `${daysLeft} giorni rimasti` : "SCADUTA"}
          </span>
        </div>
      </div>

      {/* KPI totale */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14,marginBottom:20 }}>
        <div className="kpi-card" style={{ borderLeftColor:"#F5C800" }}>
          <div className="kpi-label">Totale recuperabile {anno}</div>
          <div className="kpi-value" style={{ color: calc.totale>=IVA_ESTERA_SOGLIA_ANNUA?"#28a745":"#b8860b" }}>{fmtN(calc.totale)}</div>
          <div style={{ fontSize:10,color:"#bbb",marginTop:4 }}>
            {calc.totale>=IVA_ESTERA_SOGLIA_ANNUA ? "✓ Soglia annuale superata" : `⚠ Mancano €${(IVA_ESTERA_SOGLIA_ANNUA-calc.totale).toFixed(2)} alla soglia`}
          </div>
        </div>
        <div className="kpi-card" style={{ borderLeftColor:"#3949ab" }}>
          <div className="kpi-label">Paesi attivi</div>
          <div className="kpi-value" style={{ color:"#3949ab" }}>{PAESI_INFO.filter(p=>calc.byPaese[p.code].tot>0).length}</div>
          <div style={{ fontSize:10,color:"#bbb",marginTop:4 }}>{PAESI_INFO.filter(p=>calc.byPaese[p.code].tot>0).map(p=>p.flag).join(" ")}</div>
        </div>
        <div className="kpi-card" style={{ borderLeftColor:"#28a745" }}>
          <div className="kpi-label">Fatture con IVA estera</div>
          <div className="kpi-value" style={{ color:"#28a745" }}>{fattureVisibili.length}</div>
          <div style={{ fontSize:10,color:"#bbb",marginTop:4 }}>Scad. annuale: 30/09/{parseInt(anno)+1}</div>
        </div>
      </div>

      {/* Cards per paese */}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:20 }}>
        {PAESI_INFO.map(paese => {
          const totPaese = calc.byPaese[paese.code].tot;
          const status   = getStatus(paese.code);
          const stOpt    = IVA_STATUS_OPTS.find(s=>s.id===status.stato) || IVA_STATUS_OPTS[0];
          const okTrim   = totPaese >= IVA_ESTERA_SOGLIA_TRIM;
          const okAnnuo  = totPaese >= IVA_ESTERA_SOGLIA_ANNUA;
          return (
            <div key={paese.code}
              onClick={() => setSelectedPaese(selectedPaese===paese.code ? null : paese.code)}
              style={{
                background:"white", borderRadius:10, padding:"14px 14px 12px",
                border:`2px solid ${selectedPaese===paese.code?"#E30613":"#EBEBEB"}`,
                cursor:"pointer", transition:"all 0.15s",
                boxShadow: selectedPaese===paese.code?"0 4px 16px rgba(227,6,19,0.12)":"0 1px 4px rgba(0,0,0,0.05)"
              }}>
              <div style={{ fontSize:22,marginBottom:6 }}>{paese.flag}</div>
              <div style={{ fontWeight:800,fontSize:13,marginBottom:2 }}>{paese.label}</div>
              <div style={{ fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,fontSize:16,
                color:totPaese>0?(okAnnuo?"#28a745":"#b8860b"):"#ccc",marginBottom:8 }}>
                {totPaese>0 ? fmtN(totPaese) : "—"}
              </div>
              <div style={{ marginBottom:8 }}>
                <span style={{ fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:10,
                  background:stOpt.bg, color:stOpt.color, letterSpacing:"0.05em" }}>
                  {stOpt.label}
                </span>
              </div>
              {totPaese > 0 && (
                <div style={{ fontSize:9,color:"#bbb",lineHeight:1.4 }}>
                  {okTrim ? <span style={{color:"#3949ab"}}>✓ &gt;€{IVA_ESTERA_SOGLIA_TRIM} trim.</span> : <span>⚠ &lt;€{IVA_ESTERA_SOGLIA_TRIM} trim.</span>}<br/>
                  {okAnnuo ? <span style={{color:"#28a745"}}>✓ &gt;€{IVA_ESTERA_SOGLIA_ANNUA} annuo</span> : <span>Annuo: {fmtN(totPaese)}</span>}
                </div>
              )}
              {totPaese > 0 && (
                <button className="btn-ghost" style={{ fontSize:9,padding:"3px 8px",marginTop:8,width:"100%" }}
                  onClick={e=>{e.stopPropagation();setStatusModal({paese:paese.code, status});}}>
                  Aggiorna stato
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Tabella trimestrale */}
      <div className="card" style={{ marginBottom:20 }}>
        <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:14 }}>
          Dettaglio trimestrale {anno}
        </div>
        <table>
          <thead>
            <tr>
              <th>Trimestre</th>
              <th>Scadenza</th>
              {PAESI_INFO.map(p=><th key={p.code} style={{textAlign:"right"}}>{p.flag} {p.code}</th>)}
              <th style={{textAlign:"right"}}>Totale</th>
              <th style={{textAlign:"center"}}>Export</th>
            </tr>
          </thead>
          <tbody>
            {trimestri.map(t => {
              const row = calc.byTrim[t.id];
              const okTrimTot = row.tot >= IVA_ESTERA_SOGLIA_TRIM;
              return (
                <tr key={t.id}>
                  <td style={{fontWeight:700}}>{t.label}</td>
                  <td style={{fontSize:11,color:"#999",fontFamily:"'IBM Plex Mono',monospace"}}>{t.scad}</td>
                  {PAESI_INFO.map(p=>(
                    <td key={p.code} style={{textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",
                      color:row[p.code]>0?"#1A1A1A":"#ddd",fontWeight:row[p.code]>0?600:400}}>
                      {row[p.code]>0 ? fmtN(row[p.code]) : "—"}
                    </td>
                  ))}
                  <td style={{textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:800,
                    color:row.tot>0?(okTrimTot?"#28a745":"#b8860b"):"#ddd"}}>
                    {row.tot>0 ? fmtN(row.tot) : "—"}
                  </td>
                  <td style={{textAlign:"center"}}>
                    {row.tot>0
                      ? <button className="btn-ghost" style={{fontSize:10,padding:"3px 10px"}}
                          onClick={()=>exportIvaEsteraCSV(t.id)}>
                          ↓ CSV
                        </button>
                      : <span style={{color:"#ddd",fontSize:11}}>—</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{background:"#FAFAFA"}}>
              <td colSpan={2} style={{fontWeight:800,fontSize:12,textTransform:"uppercase",letterSpacing:"0.5px"}}>Totale {anno}</td>
              {PAESI_INFO.map(p=>(
                <td key={p.code} style={{textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:800,
                  color:calc.byPaese[p.code].tot>0?"#1A1A1A":"#ddd"}}>
                  {calc.byPaese[p.code].tot>0 ? fmtN(calc.byPaese[p.code].tot) : "—"}
                </td>
              ))}
              <td style={{textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:900,
                color:calc.totale>=IVA_ESTERA_SOGLIA_ANNUA?"#28a745":"#b8860b",fontSize:15}}>
                {fmtN(calc.totale)}
              </td>
              <td/>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Filtro + Lista fatture */}
      <div className="card">
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
          <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb" }}>
            Fatture con IVA estera — {anno}
          </div>
          <div style={{ display:"flex",gap:6,alignItems:"center" }}>
            <span style={{ fontSize:11,color:"#999" }}>Paese:</span>
            {["ALL",...PAESI_INFO.map(p=>p.code)].map(code=>(
              <button key={code} onClick={()=>setFilterPaese(code)}
                style={{ fontSize:10,padding:"3px 10px",borderRadius:20,border:"1.5px solid",cursor:"pointer",
                  fontWeight:700,transition:"all 0.15s",
                  background:filterPaese===code?"#E30613":"white",
                  color:filterPaese===code?"white":"#666",
                  borderColor:filterPaese===code?"#E30613":"#E0E0E0" }}>
                {code==="ALL" ? "Tutti" : (PAESI_INFO.find(p=>p.code===code)?.flag+" "+code)}
              </button>
            ))}
          </div>
        </div>
        {fattureVisibili.length===0
          ? <div style={{color:"#bbb",fontSize:13,padding:"20px 0",textAlign:"center"}}>
              Nessuna fattura con IVA estera in {anno}
              {filterPaese!=="ALL" && ` per ${filterPaese}`}.
            </div>
          : <table>
              <thead><tr>
                <th>N° Fattura</th><th>Data</th><th>Fornitore</th><th>Paese</th>
                <th style={{textAlign:"right"}}>Base Impon.</th>
                <th style={{textAlign:"right"}}>Aliquota</th>
                <th style={{textAlign:"right"}}>IVA Recuperabile</th>
                <th>Trim.</th>
              </tr></thead>
              <tbody>
                {fattureVisibili.map(inv => {
                  const mo  = parseInt((inv.fechaOperacion||inv.date||"").slice(5,7));
                  const tri = mo<=3?"T1":mo<=6?"T2":mo<=9?"T3":"T4";
                  const pi  = PAESI_INFO.find(p=>p.code===inv.paisIvaOrigen);
                  return (
                    <tr key={inv.id}>
                      <td style={{fontWeight:700,color:"#E30613"}}>{inv.number||"—"}</td>
                      <td style={{fontSize:11,color:"#999",fontFamily:"'IBM Plex Mono',monospace"}}>{inv.date ? new Date(inv.date).toLocaleDateString("it-IT") : "—"}</td>
                      <td style={{fontWeight:500}}>{inv.supplier||"—"}</td>
                      <td>{pi ? `${pi.flag} ${pi.label}` : inv.paisIvaOrigen}</td>
                      <td style={{textAlign:"right",fontFamily:"'IBM Plex Mono',monospace"}}>{fmtN(inv.ivaEsteraBase)}</td>
                      <td style={{textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:"#666"}}>
                        {((parseFloat(inv.ivaEsteraRate)||0)*100).toFixed(0)}%
                      </td>
                      <td style={{textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,color:"#28a745"}}>
                        {fmtN(inv.ivaEsteraAmount)}
                      </td>
                      <td><span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:4,
                        background:"#e8eaf6",color:"#3949ab"}}>{tri}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
        }
      </div>

      {/* Modal aggiorna stato pratica */}
      {statusModal && <IvaEsteraStatusModal
        paese={statusModal.paese}
        status={statusModal.status}
        onClose={() => setStatusModal(null)}
        onSave={(paese, form) => saveStatus(paese, form)}
      />}
    </div>
  );
}

// ── ACCISE GASOLIO TAB ────────────────────────────────────────────────────────
const ACCISE_STATUS_OPTS = [
  { id:"pending",                             label:"Por iniciar",        color:"#999",    bg:"#F5F5F5" },
  { id:"en_curso_pendiente_cierre_junio",     label:"En curso — jun.",    color:"#b8860b", bg:"#fffde7" },
  { id:"en_curso_pendiente_cierre_semestre",  label:"En curso — sem.",    color:"#b8860b", bg:"#fffde7" },
  { id:"pendiente_activacion_LaClau",         label:"Pend. activación",   color:"#e65100", bg:"#fff3e0" },
  { id:"pendiente_datos_DKV",                 label:"Pend. datos DKV",    color:"#e65100", bg:"#fff3e0" },
  { id:"vencida_verificar",                   label:"Vencida — verif.",   color:"#E30613", bg:"#ffebee" },
  { id:"ricevuta",                            label:"Recibida ✓",         color:"#28a745", bg:"#e8f5e9" },
];

const ACCISE_PAESI = [
  {
    code:"IT", flag:"🇮🇹", label:"Italia",
    organismo:"ADM — Agenzia delle Dogane e dei Monopoli",
    aliquota2026: 229.18,          // €/1000L — gasolio standard (Quadro A-1); HVO eco: 214.18
    aliquotaNote: "229.18 €/kL gasóleo estándar · 214.18 €/kL HVO eco (D.Lgs. 504/95 art. 24-ter)",
    normativa:"D.Lgs. 504/95 art. 24-ter",
    periodicita:"Trimestral",
    scadenzaInvio:"30 días fin trimestre",
  },
  {
    code:"FR", flag:"🇫🇷", label:"Francia",
    organismo:"Direction Générale des Douanes (DGDDI)",
    aliquota2026: 155.60,          // €/1000L — TICPE 2026: 60.75 - 45.19 = 15.56 €/hL (>7.5t)
    aliquotaNote: "155.60 €/kL — TICPE 2026: tipo nac. 60.75 €/hL − reducido TRM 45.19 €/hL",
    normativa:"Code des douanes — ex-TICPE",
    periodicita:"Mensual / Trimestral / Anual",
    scadenzaInvio:"Declaración IVA (desde 2025)",
  },
  {
    code:"DE", flag:"🇩🇪", label:"Alemania",
    organismo:"Hauptzollamt — Bundeszollverwaltung",
    aliquota2026: 214.80,          // €/1000L — §57 EnergieStG 2026 (era 64.44 nel 2025)
    aliquotaNote: "214.80 €/kL desde 01/01/2026 (§57 EnergieStG) — era 64.44 en 2025",
    normativa:"§ 57 Energiesteuergesetz (EnergieStG)",
    periodicita:"Anual",
    scadenzaInvio:"31/12 año siguiente",
  },
  {
    code:"ES", flag:"🇪🇸", label:"España",
    organismo:"AEAT — Agencia Estatal de Administración Tributaria",
    aliquota2026: 49.00,           // €/1000L — tasso fisso da 2019; aiuto straord. +200 €/kL mar-giu 2026
    aliquotaNote: "49.00 €/kL fijo (desde 2019) + 200 €/kL ayuda extraord. 22/03–30/06/2026",
    normativa:"Ley 38/1992 — Impuestos Especiales",
    periodicita:"Anual (km recorridos año anterior)",
    scadenzaInvio:"31/03 año siguiente",
  },
];

function AcciseStatusModal({ praticaId, status, pratiche, onClose, onSave }) {
  const pr  = pratiche.find(p => p.id === praticaId);
  const pi  = ACCISE_PAESI.find(p => p.code === pr?.pais);
  const [form, setForm] = useState({ ...status });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:440 }} onClick={e => e.stopPropagation()}>
        <div style={{ display:"flex",justifyContent:"space-between",marginBottom:20 }}>
          <div className="modal-title">{pi?.flag} {pr?.id} — Estado del expediente</div>
          <button onClick={onClose} style={{ background:"none",fontSize:20,color:"#999" }}>×</button>
        </div>
        <div style={{ background:"#FAFAFA",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#666" }}>
          <strong>Período:</strong> {pr?.periodo || pr?.trimestre}<br/>
          <strong>Vencimiento envío:</strong> {pr?.fechaLimiteEnvio || "—"} · <strong>Organismo:</strong> {pr?.organismo || pi?.organismo}
        </div>
        <div className="form-row">
          <div>
            <label>Estado del expediente</label>
            <select value={form.stato} onChange={e => set("stato", e.target.value)}>
              {ACCISE_STATUS_OPTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row form-row-2">
          <div><label>Fecha envío</label><input type="date" value={form.dataInvio||""} onChange={e=>set("dataInvio",e.target.value)} /></div>
          <div><label>Importe recibido (€)</label><input type="number" step="0.01" value={form.importoRicevuto||""} onChange={e=>set("importoRicevuto",e.target.value)} placeholder="0.00" /></div>
        </div>
        <div className="form-row">
          <div><label>Notas</label><textarea value={form.note||""} onChange={e=>set("note",e.target.value)} rows={2} placeholder="Notas del expediente..." /></div>
        </div>
        <div style={{ display:"flex",gap:10,marginTop:4 }}>
          <button className="btn-ghost" style={{ flex:1 }} onClick={onClose}>Cancelar</button>
          <button className="btn-red" style={{ flex:1 }} onClick={() => onSave(praticaId, form)}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

function AcciseGasolioTab({ data, persist }) {
  const fmtN  = v => new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR",minimumFractionDigits:2}).format(v||0);
  const fmtL  = v => new Intl.NumberFormat("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2}).format(v||0);
  const [statusModal, setStatusModal] = useState(null); // { praticaId, status }

  const gasoil = data.pratiche_recupero?.accisas_gasoil || null;
  const pratiche = gasoil?.pratiche || [];
  const resumen  = gasoil?.resumen_EF2 || {};
  const comision = gasoil?._comision_bim || {};

  const getStatus = (id) => data.acciseStatus?.[id] || { stato:"pending", dataInvio:"", importoRicevuto:"", note:"" };
  const saveStatus = (id, updates) => {
    const current = getStatus(id);
    persist({ ...data, acciseStatus: { ...(data.acciseStatus||{}), [id]: { ...current, ...updates } } });
    setStatusModal(null);
  };

  const getStatusOpt = (pratica) => {
    const st = getStatus(pratica.id);
    // usa stato localStorage se impostato manualmente, altrimenti usa quello del JSON
    const statoId = (st.stato && st.stato !== "pending") ? st.stato : (pratica.status || "pending");
    return ACCISE_STATUS_OPTS.find(s => s.id === statoId) || ACCISE_STATUS_OPTS[0];
  };

  // Raggruppa per paese
  const byPaese = useMemo(() => {
    const m = {};
    ACCISE_PAESI.forEach(p => { m[p.code] = []; });
    pratiche.forEach(pr => { if (m[pr.pais]) m[pr.pais].push(pr); });
    return m;
  }, [pratiche]);

  const totLitri     = pratiche.reduce((s, p) => s + (p.litrosDeclarados || 0), 0);
  const totBruto     = pratiche.reduce((s, p) => s + (p.importeBrutoEstimado || 0), 0);
  const totRicevuto  = pratiche.reduce((s, p) => s + (parseFloat(getStatus(p.id).importoRicevuto) || p.importeRecibido || 0), 0);
  const paesiAttivi  = ACCISE_PAESI.filter(p => byPaese[p.code].length > 0);

  if (!gasoil) {
    return (
      <div style={{ padding:"40px 0", textAlign:"center", color:"#bbb" }}>
        <div style={{ fontSize:32, marginBottom:12 }}>⛽</div>
        <div style={{ fontSize:14, fontWeight:600 }}>Sin datos de devolución de accisas de gasóleo</div>
        <div style={{ fontSize:12, marginTop:6 }}>
          Importa un JSON con la clave <code style={{background:"#f5f5f5",padding:"2px 6px",borderRadius:4}}>pratiche_recupero.accisas_gasoil</code>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
        <div className="section-title">Devolución Accisas Gasóleo ⛽</div>
        <div style={{ fontSize:11,color:"#999",fontFamily:"'IBM Plex Mono',monospace" }}>
          Gestor: <strong style={{color:"#1A1A1A"}}>{gasoil?._comision_bim ? "BIM Refund (BIM Service Srl)" : "—"}</strong>
        </div>
      </div>

      {/* KPI */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:14,marginBottom:20 }}>
        <div className="kpi-card" style={{ borderLeftColor:"#F5C800" }}>
          <div className="kpi-label">Litros declarados totales</div>
          <div className="kpi-value" style={{ color:"#b8860b" }}>{fmtL(totLitri)} L</div>
          <div style={{ fontSize:10,color:"#bbb",marginTop:4 }}>Todos los expedientes activos</div>
        </div>
        <div className="kpi-card" style={{ borderLeftColor:"#3949ab" }}>
          <div className="kpi-label">Importe bruto estimado</div>
          <div className="kpi-value" style={{ color:"#3949ab" }}>{fmtN(totBruto)}</div>
          <div style={{ fontSize:10,color:"#bbb",marginTop:4 }}>Antes de comisión BIM</div>
        </div>
        <div className="kpi-card" style={{ borderLeftColor:"#28a745" }}>
          <div className="kpi-label">Importe recibido</div>
          <div className="kpi-value" style={{ color: totRicevuto > 0 ? "#28a745" : "#ccc" }}>{fmtN(totRicevuto)}</div>
          <div style={{ fontSize:10,color:"#bbb",marginTop:4 }}>{totRicevuto > 0 ? "✓ Parcialmente cobrado" : "Pendiente de devolución"}</div>
        </div>
        <div className="kpi-card" style={{ borderLeftColor:"#e65100" }}>
          <div className="kpi-label">Países activos</div>
          <div className="kpi-value" style={{ color:"#e65100" }}>{paesiAttivi.length}</div>
          <div style={{ fontSize:10,color:"#bbb",marginTop:4 }}>{paesiAttivi.map(p=>p.flag).join(" ")}</div>
        </div>
      </div>

      {/* Nota commissioni BIM */}
      {comision && (
        <div style={{ background:"#fffde7",border:"1.5px solid #ffe082",borderRadius:10,padding:"10px 16px",marginBottom:20,fontSize:12 }}>
          <strong>💼 Comisión BIM Refund:</strong> Fijo <strong>€{comision.fijo_por_practica || 90}</strong>/expediente
          {comision.porcentaje_variable && <> + <strong>{comision.porcentaje_variable}</strong> variable</>}
          {comision.regla && <span style={{color:"#b8860b",marginLeft:8}}> · {comision.regla}</span>}
        </div>
      )}

      {/* Riepilogo aliquote ufficiali 2026 */}
      <div style={{ background:"#e8eaf6",border:"1.5px solid #c5cae9",borderRadius:10,padding:"10px 16px",marginBottom:20,fontSize:11 }}>
        <div style={{ fontWeight:700,color:"#3949ab",marginBottom:6,fontSize:11,letterSpacing:"0.05em" }}>
          📋 Tipos de devolución oficiales 2026 (verificados)
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8 }}>
          {ACCISE_PAESI.map(p => (
            <div key={p.code} style={{ fontSize:10 }}>
              <span style={{ fontWeight:700 }}>{p.flag} {p.label}:</span>{" "}
              <span style={{ fontFamily:"'IBM Plex Mono',monospace",color:"#3949ab",fontWeight:700 }}>{p.aliquota2026} €/kL</span>
              <div style={{ color:"#666",fontSize:9,marginTop:2 }}>{p.aliquotaNote}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Cards per paese */}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20 }}>
        {ACCISE_PAESI.map(paese => {
          const prat = byPaese[paese.code] || [];
          if (prat.length === 0) {
            return (
              <div key={paese.code} style={{
                background:"white",borderRadius:10,padding:"14px 14px 12px",
                border:"2px solid #EBEBEB",opacity:0.45
              }}>
                <div style={{ fontSize:22,marginBottom:6 }}>{paese.flag}</div>
                <div style={{ fontWeight:800,fontSize:13,marginBottom:2 }}>{paese.label}</div>
                <div style={{ fontFamily:"'IBM Plex Mono',monospace",fontSize:14,color:"#ccc" }}>—</div>
                <div style={{ fontSize:10,color:"#bbb",marginTop:6 }}>Sin expedientes</div>
              </div>
            );
          }
          const totLitriP = prat.reduce((s,p)=>s+(p.litrosDeclarados||0),0);
          const totBrutoP = prat.reduce((s,p)=>s+(p.importeBrutoEstimado||0),0);
          return (
            <div key={paese.code} style={{
              background:"white",borderRadius:10,padding:"14px 14px 12px",
              border:"2px solid #EBEBEB",cursor:"default",
              boxShadow:"0 1px 4px rgba(0,0,0,0.05)"
            }}>
              <div style={{ fontSize:22,marginBottom:6 }}>{paese.flag}</div>
              <div style={{ fontWeight:800,fontSize:13,marginBottom:2 }}>{paese.label}</div>
              <div style={{ fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,fontSize:15,color:"#b8860b",marginBottom:4 }}>
                {totBrutoP > 0 ? fmtN(totBrutoP) : "—"}
              </div>
              <div style={{ fontSize:10,color:"#999",fontFamily:"'IBM Plex Mono',monospace",marginBottom:6 }}>
                {totLitriP > 0 ? fmtL(totLitriP)+" L" : "—"}
              </div>
              {/* Una riga per pratica con status + bottone */}
              {prat.map(pr => {
                const stOpt = getStatusOpt(pr);
                return (
                  <div key={pr.id} style={{ marginBottom:5,display:"flex",alignItems:"center",gap:5,flexWrap:"wrap" }}>
                    <span style={{ fontSize:8,fontWeight:700,padding:"2px 6px",borderRadius:10,
                      background:stOpt.bg,color:stOpt.color,letterSpacing:"0.04em",whiteSpace:"nowrap" }}>
                      {pr.trimestre} · {stOpt.label}
                    </span>
                    <button className="btn-ghost" style={{ fontSize:8,padding:"2px 7px",marginLeft:"auto" }}
                      onClick={() => setStatusModal({ praticaId: pr.id, status: getStatus(pr.id) })}>
                      ✎
                    </button>
                  </div>
                );
              })}
              <div style={{ fontSize:9,color:"#3949ab",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,marginTop:4,marginBottom:2 }}>
                {paese.aliquota2026} €/kL
              </div>
              <div style={{ fontSize:9,color:"#bbb",lineHeight:1.4 }}>
                {paese.normativa}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tabella pratiche */}
      <div className="card">
        <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:14 }}>
          Detalle de expedientes
        </div>
        <table>
          <thead>
            <tr>
              <th>ID Expediente</th>
              <th>País</th>
              <th>Período</th>
              <th>Normativa</th>
              <th style={{textAlign:"right"}}>Litros</th>
              <th style={{textAlign:"right"}}>Tipo (€/kL)</th>
              <th style={{textAlign:"right"}}>Bruto Estimado</th>
              <th style={{textAlign:"right"}}>Recibido</th>
              <th>Vencimiento</th>
              <th>Estado</th>
              <th style={{textAlign:"center"}}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {pratiche.map(pr => {
              const stOpt = getStatusOpt(pr);
              const pi    = ACCISE_PAESI.find(p => p.code === pr.pais);
              const stData = getStatus(pr.id);
              const ricevuto = parseFloat(stData.importoRicevuto) || pr.importeRecibido || 0;
              return (
                <tr key={pr.id}>
                  <td style={{ fontWeight:700,color:"#E30613",fontFamily:"'IBM Plex Mono',monospace",fontSize:11 }}>{pr.id}</td>
                  <td>{pi ? `${pi.flag} ${pi.label}` : pr.pais}</td>
                  <td style={{ fontSize:11,color:"#666" }}>{pr.periodo || pr.trimestre}</td>
                  <td style={{ fontSize:10,color:"#999" }}>{pr.normativa}</td>
                  <td style={{ textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:600 }}>
                    {fmtL(pr.litrosDeclarados)}
                  </td>
                  <td style={{ textAlign:"right",fontFamily:"'IBM Plex Mono',monospace" }}>
                    {(() => {
                      const jsonVal = pr.alicuotaReembolso_por1000L;
                      const refVal  = pi?.aliquota2026;
                      if (!jsonVal) return <span style={{color:"#ccc"}}>—</span>;
                      const match = refVal && Math.abs(jsonVal - refVal) < 0.05;
                      return (
                        <span title={pi?.aliquotaNote || ""} style={{
                          color: match ? "#28a745" : "#b8860b",
                          fontWeight: 700, cursor: pi?.aliquotaNote ? "help" : "default"
                        }}>
                          €{jsonVal}/kL{!match && refVal ? <span style={{fontSize:9,color:"#999",display:"block"}}>ref. €{refVal}</span> : null}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{ textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,color:"#b8860b" }}>
                    {fmtN(pr.importeBrutoEstimado)}
                  </td>
                  <td style={{ textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,
                    color: ricevuto > 0 ? "#28a745" : "#ccc" }}>
                    {ricevuto > 0 ? fmtN(ricevuto) : "—"}
                  </td>
                  <td style={{ fontSize:11,color: pr.fechaLimiteEnvio && pr.fechaLimiteEnvio < new Date().toISOString().slice(0,10) ? "#E30613" : "#666",
                    fontFamily:"'IBM Plex Mono',monospace" }}>
                    {pr.fechaLimiteEnvio || "—"}
                  </td>
                  <td>
                    <span style={{ fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:10,
                      background:stOpt.bg, color:stOpt.color, letterSpacing:"0.05em", whiteSpace:"nowrap" }}>
                      {stOpt.label}
                    </span>
                  </td>
                  <td style={{ textAlign:"center" }}>
                    <button className="btn-ghost" style={{ fontSize:9,padding:"3px 10px" }}
                      onClick={() => setStatusModal({ praticaId: pr.id, status: getStatus(pr.id) })}>
                      Actualizar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background:"#FAFAFA" }}>
              <td colSpan={4} style={{ fontWeight:800,fontSize:12,textTransform:"uppercase",letterSpacing:"0.5px" }}>Total</td>
              <td style={{ textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:800 }}>{fmtL(totLitri)} L</td>
              <td/>
              <td style={{ textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:900,color:"#b8860b",fontSize:14 }}>{fmtN(totBruto)}</td>
              <td style={{ textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:900,color: totRicevuto>0?"#28a745":"#ccc",fontSize:14 }}>
                {totRicevuto > 0 ? fmtN(totRicevuto) : "—"}
              </td>
              <td colSpan={3}/>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Modal aggiorna stato pratica */}
      {statusModal && <AcciseStatusModal
        praticaId={statusModal.praticaId}
        status={statusModal.status}
        pratiche={pratiche}
        onClose={() => setStatusModal(null)}
        onSave={saveStatus}
      />}
    </div>
  );
}

class TabErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(e) { return { hasError: true, error: e }; }
  componentDidUpdate(prev) { if (prev.tabKey !== this.props.tabKey) this.setState({ hasError: false, error: null }); }
  render() {
    if (this.state.hasError) return (
      <div style={{ padding:40, textAlign:"center" }}>
        <div style={{ fontSize:32, marginBottom:12 }}>⚠️</div>
        <div style={{ fontSize:15, fontWeight:700, color:"#E30613", marginBottom:8 }}>Errore nel caricamento di questa sezione</div>
        <div style={{ fontSize:12, color:"#999", fontFamily:"'IBM Plex Mono',monospace", marginBottom:20, maxWidth:480, margin:"0 auto 20px" }}>{this.state.error?.message}</div>
        <button className="btn-red" onClick={()=>this.setState({hasError:false,error:null})}>↺ Riprova</button>
      </div>
    );
    return this.props.children;
  }
}

export default function IberSilosApp() {
  const [authenticated, setAuthenticated] = useState(() => {
    const token = sessionStorage.getItem('ibs_auth');
    return !!token && Object.values(USERS).includes(token);
  });
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState({ invoices: [], movements: [], ibkrPositions: [], ibkrPrices: {}, asientos: [], fixedAssets: DEFAULT_ASSETS, ivaEsteraStatus: {} });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null); // { message, onConfirm }
  const [invoiceModal, setInvoiceModal] = useState(null);
  const [movModal, setMovModal] = useState(null);
  const [reconcileModal, setReconcileModal] = useState(null);
  const [ibkrModal, setIbkrModal] = useState(null);
  const [asientoModal, setAsientoModal] = useState(null);
  const [contabView, setContabView] = useState("diario");
  const [mayorCuenta, setMayorCuenta] = useState("572");
  const [ejercicio, setEjercicio] = useState("EF2");
  const [ivaModal, setIvaModal] = useState(false);
  const [fattureAperteModal, setFattureAperteModal] = useState(false);
  const [importConfirmModal, setImportConfirmModal] = useState(null);
  const fileRef = useRef();
  const pdfRef = useRef();

  useEffect(() => { loadData().then(d => { setData(d); setLoading(false); }); }, []);

  const showToast = useCallback((msg, type = "ok") => { setToast({ msg, type }); setTimeout(() => setToast(null), type === "err" ? 6000 : 3000); }, []);

  const persist = useCallback((newData) => { setData(newData); saveData(newData, (msg) => showToast(msg, "err")); }, [showToast]);

  const saveInvoice = (inv) => {
    const net = parseFloat(inv.netAmount) || 0;
    const rate = (inv.ivaType in IVA_TYPES) ? IVA_TYPES[inv.ivaType] : 0.21;
    const ivaAmount = parseFloat((net * rate).toFixed(2));
    // Per fatture con IVA estera (rate=0) il grossAmount originale va preservato
    // perché include l'IVA estera che non è in ivaAmount ES
    const TIPI_ESTERI = ["IVA IT 22%","IVA FR 20%","IVA DE 19%","IVA AT 20%","IVA BE 21%"];
    const grossAmount = TIPI_ESTERI.includes(inv.ivaType) && parseFloat(inv.grossAmount) > 0
      ? parseFloat(inv.grossAmount)  // preserva originale
      : parseFloat((net + ivaAmount).toFixed(2));
    const final = { ...inv, ivaAmount, grossAmount, id: inv.id || `inv-${Date.now()}` };
    if (!final.dueDate) final.dueDate = addDays(final.date, 30);
    // Fix-4: garantisce che i campi IVA estera siano sempre presenti su fatture ricevute
    if (final.type === "ricevuta") {
      Object.entries(IVA_ESTERA_DEFAULTS).forEach(([k, v]) => {
        if (final[k] === undefined || final[k] === null) final[k] = v;
      });
    }
    // Fix-5: warning se IVA estera parzialmente compilata (paese estero + base > 0 ma importo mancante)
    if (
      final.type === "ricevuta" &&
      final.paisIvaOrigen && final.paisIvaOrigen !== "ES" &&
      (parseFloat(final.ivaEsteraBase) || 0) > 0 &&
      !(parseFloat(final.ivaEsteraAmount) > 0)
    ) {
      showToast("⚠ IVA estera: base inserita ma importo recuperabile = 0. Verifica.", "warn");
      // Non blocca il salvataggio — avvisa solo
    }
    const exists = data.invoices.find(i => i.id === final.id);
    const invoices = exists ? data.invoices.map(i => i.id === final.id ? final : i) : [...data.invoices, final];
    persist({ ...data, invoices });
    setInvoiceModal(null);
    showToast(exists ? "Factura actualizada" : "Factura añadida");
  };
  const deleteInvoice = (id) => setConfirmModal({ message:"Se eliminará la factura.", onConfirm: () => { persist({ ...data, invoices: data.invoices.filter(i => i.id !== id) }); showToast("Factura eliminada", "warn"); setConfirmModal(null); } });

  const saveMov = (mov) => {
    const final = { ...mov, id: mov.id || `mov-${Date.now()}` };
    const exists = data.movements.find(m => m.id === final.id);
    const movements = exists ? data.movements.map(m => m.id === final.id ? final : m) : [...data.movements, final];
    persist({ ...data, movements }); setMovModal(null); showToast(exists ? "Actualizado" : "Añadido");
  };
  const deleteMov = (id) => setConfirmModal({ message:"Se eliminará el movimiento.", onConfirm: () => { persist({ ...data, movements: data.movements.filter(m => m.id !== id) }); showToast("Movimiento eliminado", "warn"); setConfirmModal(null); } });

  const updateIbkrPrice = useCallback((ticker, price) => {
    const ibkrPrices = { ...(data.ibkrPrices||{}), [ticker]: parseFloat(price)||0 };
    persist({ ...data, ibkrPrices });
  }, [data, persist]);

  const [ibkrLive, setIbkrLive] = useState(null); // { VWCE:{price,change_pct}, ..., _updated }
  const fetchIbkrPrices = useCallback(() => {
    fetch(import.meta.env.BASE_URL + 'etf_prices.json?t=' + Date.now())
      .then(r => r.json())
      .then(d => { if (d._updated) setIbkrLive(d); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    fetchIbkrPrices();
    const interval = setInterval(fetchIbkrPrices, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchIbkrPrices]);


  const saveIbkr = (pos) => {
    const shares = parseFloat(pos.shares) || 0, price = parseFloat(pos.priceEur) || 0, fees = parseFloat(pos.fees) || 0;
    const final = { ...pos, totalEur: parseFloat((shares * price + fees).toFixed(2)), id: pos.id || `ibkr-${Date.now()}` };
    const exists = data.ibkrPositions?.find(p => p.id === final.id);
    const ibkrPositions = exists ? (data.ibkrPositions||[]).map(p => p.id===final.id?final:p) : [...(data.ibkrPositions||[]), final];
    persist({ ...data, ibkrPositions }); setIbkrModal(null); showToast(exists ? "Actualizado" : "Añadido");
  };
  const deleteIbkr = (id) => setConfirmModal({ message:"Se eliminará la operación IBKR.", onConfirm: () => { persist({ ...data, ibkrPositions: (data.ibkrPositions||[]).filter(p => p.id!==id) }); showToast("Operación eliminada", "warn"); setConfirmModal(null); } });

  const saveAsiento = (asiento) => {
    const lineas = asiento.lineas.filter(l => l.cuenta && (parseFloat(l.debe)||parseFloat(l.haber)));
    const totalDebe = lineas.reduce((s,l) => s+(parseFloat(l.debe)||0), 0);
    const totalHaber = lineas.reduce((s,l) => s+(parseFloat(l.haber)||0), 0);
    if (Math.abs(totalDebe - totalHaber) > 0.01) { showToast(` No cuadra: D ${fmt(totalDebe)} ≠ H ${fmt(totalHaber)}`, "err"); return; }
    const asientos = data.asientos || [];
    const numero = asiento.numero || String(asientos.length + 1).padStart(4, "0");
    const final = { ...asiento, lineas, numero, id: asiento.id || `asi-${Date.now()}` };
    const exists = asientos.find(a => a.id === final.id);
    persist({ ...data, asientos: exists ? asientos.map(a => a.id===final.id?final:a) : [...asientos, final] });
    setAsientoModal(null); showToast(`Asiento ${numero} registrado `);
  };
  const deleteAsiento = (id) => setConfirmModal({ message:"Se eliminará el asiento contable.", onConfirm: () => { persist({ ...data, asientos: (data.asientos||[]).filter(a => a.id!==id) }); showToast("Asiento eliminado", "warn"); setConfirmModal(null); } });

  const runAutoReconcile = () => {
    const movements = autoReconcile(data.movements, data.invoices);
    const matched = movements.filter(m => m._autoMatch).length;
    const invoices = data.invoices.map(inv => { const hasMatch = movements.find(m => m.invoiceId===inv.id&&m.reconciled); return hasMatch ? {...inv, status:"riconciliata"} : inv; });
    persist({ ...data, movements: movements.map(m => { const c={...m}; delete c._autoMatch; return c; }), invoices });
    showToast(`Conciliación: ${matched} asociaciones automáticas`);
  };
  const manualReconcile = (movId, invId) => {
    const conflict = data.movements.find(m => m.id !== movId && m.invoiceId === invId && m.reconciled);
    if (conflict) { showToast(`⚠ Fattura già riconciliata con mov. ${conflict.date} (${conflict.id.slice(-6)})`, "err"); return; }
    const movements = data.movements.map(m => m.id===movId ? {...m, invoiceId:invId, reconciled:true} : m);
    const invoices = data.invoices.map(inv => inv.id===invId ? {...inv, status:"riconciliata"} : inv);
    persist({ ...data, movements, invoices }); setReconcileModal(null); showToast("Conciliación guardada");
  };

  const importPDF = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    e.target.value = "";
    showToast("Lettura PDF in corso...", "warn");
    try {
      const parsed = await parseRevolutPDF(file);
      if (!parsed.length) { showToast("Nessuna transazione trovata nel PDF", "err"); return; }
      const existing = new Set(data.movements.map(m => `${m.date}-${m.amount}-${m.description}`));
      const newMovs = parsed.filter(m => !existing.has(`${m.date}-${m.amount}-${m.description}`));
      if (!newMovs.length) { showToast("Sin nuevos movimientos (già importati)", "warn"); return; }
      persist({ ...data, movements: [...data.movements, ...newMovs] });
      showToast(`✅ Importados ${newMovs.length} movimientos del PDF (${parsed.length - newMovs.length} ya presentes)`);
    } catch (err) {
      showToast("Errore PDF: " + err.message, "err");
    }
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `iber-silos-${today()}.json`; a.click();
    showToast("Backup exportado");
  };
  const importJSON = (e) => {
    const file = e.target.files[0]; if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        // DATA-2: validazione schema minima prima di sovrascrivere
        if (!parsed || typeof parsed !== "object") { showToast("❌ File non valido: non è un oggetto JSON", "err"); return; }
        if (!Array.isArray(parsed?.invoices))  { showToast("❌ File non valido: 'invoices' mancante", "err"); return; }
        if (!Array.isArray(parsed?.movements)) { showToast("❌ File non valido: 'movements' mancante", "err"); return; }
        if (!Array.isArray(parsed?.asientos))  { showToast("❌ File non valido: 'asientos' mancante", "err"); return; }
        // Migrazione campi IVA estera
        if (parsed.invoices) parsed.invoices = parsed.invoices.map(migrateInvoice);
        // Modal conferma con riepilogo
        setImportConfirmModal({ parsed, summary: {
          invoices:  parsed.invoices?.length||0,
          movements: parsed.movements?.length||0,
          asientos:  parsed.asientos?.length||0,
          ibkr:      parsed.ibkrPositions?.length||0,
          currentInv: data.invoices?.length||0,
          currentMov: data.movements?.length||0,
          currentAsi: data.asientos?.length||0,
        }});
      } catch (err) {
        showToast("❌ Archivo no válido: " + err.message, "err");
      }
    };
    reader.readAsText(file);
  };

  const confirmImport = () => {
    if (!importConfirmModal) return;
    persist(importConfirmModal.parsed);
    const s = importConfirmModal.summary;
    setImportConfirmModal(null);
    showToast(`✓ Importados: ${s.invoices} facturas · ${s.movements} movimientos · ${s.asientos} asientos`);
  };

  const exportContabCSV = () => {
    const rows = [["Numero","Fecha","Concepto","Cuenta","Nombre Cuenta","Debe","Haber"]];
    (data.asientos||[]).forEach(a => (a.lineas||[]).forEach(l => rows.push([a.numero,a.fecha,a.concepto,l.cuenta,ACC_MAP[l.cuenta]?.name||"",l.debe||"0",l.haber||"0"])));
    const csv = rows.map(r => r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv],{type:"text/csv;charset=utf-8;"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`libro-diario-${today()}.csv`; a.click();
    showToast("Libro Diario exportado");
  };

  const exportAnnoCSV = () => {
    const ejFound = EJERCICIOS.find(e=>e.id===ejercicio&&e.id!=="todos");
    const ej = ejFound || EJERCICIOS.find(e=>e.id==="EF2") || EJERCICIOS[1];
    const label = ejFound ? ej.id : "ALL";
    const dlCSV = (rows, filename) => {
      const csv = rows.map(r=>r.map(v=>`"${String(v||"").replace(/"/g,'""')}"`).join(";")).join("\n");
      const blob = new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8;"});
      const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),400);
    };
    const invs = data.invoices.filter(i=>{ const d=i.fechaOperacion||i.date||""; return d>=ej.from&&d<=ej.to; });
    dlCSV([
      ["ID","Tipo","N°","Fecha","Vencimiento","Contraparte","Descripción","Base (€)","IVA (€)","Total (€)","Tipo IVA","Paese IVA","IVA Estera (€)","Estado"],
      ...invs.map(i=>[i.id,i.type,i.number||"",i.date||"",i.dueDate||"",
        i.type==="emessa"?i.client||"":i.supplier||"",i.description||"",
        (parseFloat(i.netAmount)||0).toFixed(2).replace(".",","),
        (parseFloat(i.ivaAmount)||0).toFixed(2).replace(".",","),
        (parseFloat(i.grossAmount)||0).toFixed(2).replace(".",","),
        i.ivaType||"",i.paisIvaOrigen||"ES",
        (parseFloat(i.ivaEsteraAmount)||0).toFixed(2).replace(".",","),i.status||""])
    ], `IberSilos_Facturas_${label}_${today()}.csv`);
    const movs = data.movements.filter(m=>{ const d=m.date||""; return d>=ej.from&&d<=ej.to; });
    setTimeout(()=>dlCSV([
      ["ID","Fecha","Tipo","Descripción","Importe (€)","Cuenta","Reconciliado","Factura ID"],
      ...movs.map(m=>[m.id,m.date||"",m.type||"",m.description||"",
        (parseFloat(m.amount)||0).toFixed(2).replace(".",","),
        m.account||"",m.reconciled?"Sí":"No",m.invoiceId||""])
    ], `IberSilos_Movimientos_${label}_${today()}.csv`), 300);
    showToast(`✓ Export ${label}: ${invs.length} fatture · ${movs.length} movimenti`);
  };

  const exportIvaEsteraCSV = (trimestre) => {
    const ejFound = EJERCICIOS.find(e=>e.id===ejercicio&&e.id!=="todos");
    const ej = ejFound || EJERCICIOS.find(e=>e.id==="EF2") || EJERCICIOS[1];
    const anno = ejFound ? ej.from.slice(0,4) : new Date().getFullYear().toString();
    const mesiMap = { T1:[1,2,3], T2:[4,5,6], T3:[7,8,9], T4:[10,11,12] };
    const mesi = mesiMap[trimestre]; if (!mesi) { showToast("Trimestre non valido: " + trimestre, "err"); return; }
    const scadenzeMap = { T1:`30/04/${anno}`, T2:`31/07/${anno}`, T3:`31/10/${anno}`, T4:`31/01/${parseInt(anno)+1}` };
    const PAESI_UE = ["IT","FR","DE","AT","BE"];
    const fatture = data.invoices.filter(inv => {
      if (inv.type !== "ricevuta") return false;
      if (!inv.paisIvaOrigen || inv.paisIvaOrigen === "ES") return false;
      if (!(parseFloat(inv.ivaEsteraAmount) > 0)) return false;
      const d = inv.fechaOperacion || inv.date || "";
      if (!d) return false;
      const mo = parseInt(d.slice(5,7));
      return mesi.includes(mo) && d >= ej.from && d <= ej.to;
    }).sort((a,b) => {
      const pa = a.paisIvaOrigen||"ZZ", pb = b.paisIvaOrigen||"ZZ";
      if (pa !== pb) return pa.localeCompare(pb);
      return (a.date||"").localeCompare(b.date||"");
    });
    if (fatture.length === 0) { showToast(`Nessuna fattura con IVA estera in ${trimestre} ${anno}`, "warn"); return; }
    const cols = ["Trimestre","N° Fattura","Data Fattura","Fornitore","P.IVA Estera","Paese","Base Imponibile (EUR)","Aliquota (%)","IVA Recuperabile (EUR)","Descrizione","Link Documento","Scadenza Richiesta"];
    const rows = [cols];
    let totaleIva = 0;
    fatture.forEach(inv => {
      const pInfo = PAESI_UE_IVA.find(p => p.code === inv.paisIvaOrigen);
      const ivaAmt = parseFloat(inv.ivaEsteraAmount) || 0;
      totaleIva += ivaAmt;
      rows.push([
        `${trimestre} ${anno}`, inv.number||"", inv.date ? new Date(inv.date).toLocaleDateString("it-IT") : "",
        inv.supplier||"", inv.vatForeignNumber||"",
        pInfo ? `${pInfo.flag} ${pInfo.label}` : inv.paisIvaOrigen,
        (parseFloat(inv.ivaEsteraBase)||0).toFixed(2).replace(".",","),
        ((parseFloat(inv.ivaEsteraRate)||0)*100).toFixed(0)+"%",
        ivaAmt.toFixed(2).replace(".",","),
        inv.description||"", inv.dropboxLink||inv.driveFileId||"", scadenzeMap[trimestre],
      ]);
    });
    rows.push([]);
    rows.push([`TOTALE ${trimestre} ${anno}`,"","","","","",
      fatture.reduce((s,i)=>s+(parseFloat(i.ivaEsteraBase)||0),0).toFixed(2).replace(".",","),"",
      totaleIva.toFixed(2).replace(".",","),`${fatture.length} fatture`,"",scadenzeMap[trimestre]]);
    const csv = rows.map(r => r.map(v=>`"${String(v||"").replace(/"/g,'""')}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `IberSilos_IVA_Estera_${ej.id}_${trimestre}_${anno}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 100);
    showToast(`✓ Export ${trimestre} ${anno} — ${fatture.length} fatture, IVA €${totaleIva.toFixed(2)}`);
  };

  const metrics = useMemo(() => {
    const ej = EJERCICIOS.find(e=>e.id===ejercicio)||EJERCICIOS[2];
    const inv = data.invoices.filter(i=>{ const d=i.fechaOperacion||i.date||""; return d>=ej.from&&d<=ej.to; });
    const emesse = inv.filter(i=>i.type==="emessa"), ricevute = inv.filter(i=>i.type==="ricevuta");
    const fatturato = emesse.reduce((s,i)=>s+(parseFloat(i.netAmount)||0),0);
    const costi = ricevute.reduce((s,i)=>s+(parseFloat(i.netAmount)||0),0);
    const creditiAperti = emesse.filter(i=>i.status==="aperta").reduce((s,i)=>s+(parseFloat(i.grossAmount)||0),0);
    const debitiAperti = ricevute.filter(i=>i.status==="aperta").reduce((s,i)=>s+(parseFloat(i.grossAmount)||0),0);
    // Liquidità = saldo reale del conto = TUTTI i movimenti cumulati (non solo periodo)
    const liquidita = data.movements.reduce((s,m)=>s+(m.type==="entrata"?1:-1)*(parseFloat(m.amount)||0),0);
    const ivaSop = ricevute.reduce((s,i)=>s+(parseFloat(i.ivaAmount)||0),0);
    const ivaRep = emesse.reduce((s,i)=>s+(parseFloat(i.ivaAmount)||0),0);
    const ivaCredito = ivaSop - ivaRep;
    const ivaDevol = data.movements.filter(m=>m.isAeatRefund===true||(m.type==="entrata"&&/AEAT.*(IVA|DEVOLUCI[OÓ]N|REDEME|303)/i.test(m.description||""))).reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
    return { fatturato, costi, margine:fatturato-costi, creditiAperti, debitiAperti, liquidita, marginePerc:fatturato>0?(fatturato-costi)/fatturato*100:0, ivaSop, ivaRep, ivaCredito, ivaDevol };
  }, [data.invoices, data.movements, ejercicio]);

  const forecastInvoices = useMemo(() => {
    const ej = EJERCICIOS.find(e => e.id === ejercicio);
    if (!ej || ej.id === "todos") return data.invoices;
    return data.invoices.filter(i => { const d = i.fechaOperacion || i.date || ""; return d >= ej.from && d <= ej.to; });
  }, [data.invoices, ejercicio]);
  const forecast = useMemo(() => buildForecast(forecastInvoices, data.movements), [forecastInvoices, data.movements]);

  const pacSummary = useMemo(() => {
    const positions = data.ibkrPositions || [];
    const byTicker = {};
    positions.forEach(p => {
      if (!byTicker[p.ticker]) byTicker[p.ticker] = { shares:0, totalInvested:0 };
      const shares = parseFloat(p.shares)||0, total = parseFloat(p.totalEur)||0;
      if (p.type==="acquisto") { byTicker[p.ticker].shares+=shares; byTicker[p.ticker].totalInvested+=total; }
      else { byTicker[p.ticker].shares-=shares; byTicker[p.ticker].totalInvested-=total; }
    });
    return {
      byTicker,
      totalInvested: Object.values(byTicker).reduce((s,t)=>s+t.totalInvested,0),
      lastOp: [...positions].reverse()[0] || null,
      pacTarget: getPacAmount(today()),
      count: positions.length,
    };
  }, [data.ibkrPositions]);

  if (!authenticated) return <LoginScreen onLogin={() => setAuthenticated(true)} />;

  if (loading) return (
    <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#F5F5F5",fontFamily:"'DM Sans','Segoe UI',sans-serif" }}>
      <div style={{ textAlign:"center" }}>
        <img src="/iber-silos-finance/logo.png" alt="Ibersilos" style={{ height:72, width:"auto", display:"block", margin:"0 auto" }} />
        <div style={{ marginTop:16,color:"#bbb",fontSize:11,fontWeight:700,letterSpacing:"2px",textTransform:"uppercase" }}>Cargando...</div>
      </div>
    </div>
  );

  const scaduteCount = data.invoices.filter(i => i.status === "aperta" && i.dueDate && i.dueDate < today()).length;

  const TABS = [
    { id:"dashboard",    label:"Dashboard",    icon: <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> },
    { id:"fatture",      label:"Facturas",     icon: <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> },
    { id:"movimenti",    label:"Movimientos",  icon: <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> },
    { id:"riconciliazione", label:"Conciliación", icon: <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> },
    { id:"forecast",     label:"Forecast",     icon: <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg> },
    { id:"ibkr",         label:"IBKR SL",      icon: <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
    { id:"contabilidad", label:"Contabilidad", icon: <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> },
    { id:"iva_estera",   label:"IVA Estera",   icon: <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> },
    { id:"accise_gasolio", label:"Accise Gasolio", icon: <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 22V8l9-6 9 6v14"/><path d="M9 22V12h6v10"/><path d="M14 6.5v2"/></svg> },
  ];

  return (
    <div style={{ fontFamily:"'DM Sans','Segoe UI',sans-serif", background:"#F5F5F5", minHeight:"100vh", color:"#1A1A1A", display:"flex", flexDirection:"column" }}>
      <style>{`
        :root { --red:#E30613; --yellow:#F5C800; --dark:#1A1A1A; --bg:#F5F5F5; --border:#E0E0E0; --green:#28a745; --blue:#3949ab; --gold:#b8860b; --white:#fff; --text-muted:#999; --shadow:0 2px 10px rgba(0,0,0,0.07); }
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:4px; } ::-webkit-scrollbar-track { background:var(--bg); } ::-webkit-scrollbar-thumb { background:#ddd; border-radius:2px; }
        body { font-family:'DM Sans','Segoe UI',sans-serif; }
        input, select, textarea { font-family:'DM Sans','Segoe UI',sans-serif; background:white; border:1.5px solid var(--border); color:var(--dark); padding:8px 12px; border-radius:8px; font-size:13px; width:100%; outline:none; transition:border-color 0.2s; }
        input:focus, select:focus, textarea:focus { border-color:var(--red); box-shadow:0 0 0 3px rgba(227,6,19,0.08); }
        select option { background:white; }
        button { font-family:'DM Sans','Segoe UI',sans-serif; cursor:pointer; border:none; border-radius:8px; transition:all 0.15s; }
        table { width:100%; border-collapse:collapse; }
        th { text-align:left; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:#bbb; padding:10px 12px; border-bottom:2px solid var(--bg); background:#FAFAFA; font-family:'DM Sans','Segoe UI',sans-serif; font-weight:700; }
        td { padding:10px 12px; font-size:13px; border-bottom:1px solid var(--bg); }
        tr:hover td { background:#FFF5F5; }
        .num { font-family:'IBM Plex Mono','Courier New',monospace; }
        .btn-red { background:var(--red); color:white; padding:8px 18px; font-weight:700; font-size:12px; letter-spacing:0.3px; box-shadow:0 2px 8px rgba(227,6,19,0.22); }
        .btn-red:hover { background:#B8050F; transform:translateY(-1px); box-shadow:0 4px 12px rgba(227,6,19,0.3); }
        .btn-ghost { background:white; color:#555; padding:7px 14px; border:1.5px solid var(--border); font-size:12px; font-weight:600; }
        .btn-ghost:hover { border-color:var(--red); color:var(--red); }
        .btn-danger { background:transparent; color:var(--red); padding:5px 10px; font-size:11px; border:1.5px solid rgba(227,6,19,0.3); }
        .btn-danger:hover { background:rgba(227,6,19,0.05); }
        .badge { display:inline-block; padding:2px 8px; border-radius:4px; font-size:10px; letter-spacing:0.08em; text-transform:uppercase; font-weight:700; }
        .badge-green { background:#e8f5e9; color:#2e7d32; border:1px solid #a5d6a7; }
        .badge-yellow { background:#fffde7; color:#b8860b; border:1px solid #ffe082; }
        .badge-red { background:#ffebee; color:var(--red); border:1px solid #ef9a9a; }
        .badge-blue { background:#e8eaf6; color:#3949ab; border:1px solid #9fa8da; }
        .badge-gray { background:var(--bg); color:#999; border:1px solid var(--border); }
        .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:100; display:flex; align-items:center; justify-content:center; padding:20px; backdrop-filter:blur(2px); }
        .modal { background:white; border-radius:14px; border-top:4px solid var(--red); padding:28px; width:100%; max-width:580px; max-height:90vh; overflow-y:auto; box-shadow:0 24px 64px rgba(0,0,0,0.18); }
        .modal-title { font-size:14px; font-weight:700; color:var(--red); letter-spacing:0.4px; text-transform:uppercase; }
        .form-row { display:grid; gap:14px; margin-bottom:14px; }
        .form-row-2 { grid-template-columns:1fr 1fr; }
        label { display:block; font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:#999; margin-bottom:5px; font-weight:700; }
        .kpi-card { background:white; border-radius:10px; padding:16px 20px; box-shadow:0 1px 6px rgba(0,0,0,0.06); border-left:3px solid var(--red); }
        .kpi-card.yellow { border-left-color:var(--yellow); }
        .kpi-card.green { border-left-color:#28a745; }
        .kpi-card.blue { border-left-color:#3949ab; }
        .kpi-card.gray { border-left-color:var(--border); }
        .kpi-value { font-size:22px; font-weight:700; margin:4px 0 2px; line-height:1; font-family:'IBM Plex Mono','Courier New',monospace; }
        .kpi-label { font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:#bbb; font-weight:700; }
        .section-title { font-size:13px; font-weight:800; display:flex; align-items:center; gap:8px; text-transform:uppercase; letter-spacing:1.5px; color:var(--dark); }
        .section-title::before { content:''; width:3px; height:18px; background:linear-gradient(to bottom, var(--red), var(--yellow)); border-radius:2px; flex-shrink:0; }
        .card { background:white; border-radius:10px; padding:18px; box-shadow:0 1px 6px rgba(0,0,0,0.06); }
        .tab-btn { padding:7px 14px; font-size:12px; font-weight:700; border-radius:6px; background:transparent; color:#999; border:none; letter-spacing:0.3px; transition:all 0.15s; }
        .tab-btn:hover { color:var(--dark); background:var(--bg); }
        .tab-btn.active { background:var(--red); color:white; }
        .nav-item { display:flex; align-items:center; gap:10px; padding:9px 16px; cursor:pointer; border-left:3px solid transparent; font-size:13px; font-weight:500; color:var(--text-muted); transition:all 0.15s; border:none; background:transparent; width:100%; text-align:left; }
        .nav-item svg { width:16px; height:16px; stroke:currentColor; fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; flex-shrink:0; }
        .nav-item:hover { background:#fff5f5; color:var(--dark); }
        .nav-item.active { background:#fff0f0; border-left:3px solid var(--red); color:var(--red); font-weight:700; }
        .nav-badge { margin-left:auto; background:var(--red); color:white; font-size:9px; font-weight:700; padding:2px 6px; border-radius:10px; font-family:'IBM Plex Mono',monospace; }
        .progress-bar { background:var(--bg); border-radius:4px; height:4px; overflow:hidden; }
        .progress-fill { height:100%; border-radius:4px; background:linear-gradient(90deg, var(--red), var(--yellow)); }
        .header-topbar { position:fixed; top:0; left:0; right:0; height:4px; background:var(--yellow); z-index:200; }
      `}</style>

      <div className="header-topbar" />
      <header style={{ background:"white", borderBottom:"3px solid var(--red)", padding:"0 20px", height:60, marginTop:4, display:"flex", alignItems:"center", gap:16, flexShrink:0, boxShadow:"0 2px 8px rgba(0,0,0,0.07)", zIndex:50, position:"sticky", top:4 }}>
        <IbersilosLogo height={44} />
        <div style={{ width:1, height:28, background:"#E8E8E8" }} />
        <div style={{ fontSize:10, fontWeight:700, letterSpacing:"2.5px", textTransform:"uppercase", color:"#bbb" }}>Gestión Financiera</div>
        <div style={{ flex:1 }} />
        <div style={{ display:"flex", gap:12, alignItems:"center" }}>
          <select value={ejercicio} onChange={e=>setEjercicio(e.target.value)} style={{ fontSize:11,padding:"5px 10px",border:"1.5px solid #E0E0E0",borderRadius:6,fontWeight:700,color:"#1A1A1A",background:"white",width:"auto",fontFamily:"'DM Sans',sans-serif" }}>
            {EJERCICIOS.map(e=><option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
          <KpiPill label="Facturado" value={fmt(metrics.fatturato)} color="#E30613" />
          <KpiPill label="Liquidez" value={fmt(metrics.liquidita)} color={metrics.liquidita>=0?"#28a745":"#E30613"} />
          <KpiPill label="Créditos" value={fmt(metrics.creditiAperti)} color="#b8860b" />
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <button className="btn-ghost" onClick={() => setFattureAperteModal(true)} style={{ fontSize:11, position:"relative" }}>
            Abiertas
            {(data.invoices.filter(i=>i.status==="aperta"&&i.type==="emessa").length + data.invoices.filter(i=>i.status==="aperta"&&i.type==="ricevuta").length) > 0 && (
              <span style={{ position:"absolute",top:-5,right:-5,background:"#E30613",color:"white",borderRadius:"50%",width:16,height:16,fontSize:9,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'IBM Plex Mono',monospace" }}>
                {data.invoices.filter(i=>i.status==="aperta").length}
              </span>
            )}
          </button>
          <button className="btn-ghost" onClick={exportAnnoCSV} style={{ fontSize:11 }}>↓ CSV</button>
          <button className="btn-ghost" onClick={exportJSON} style={{ fontSize:11 }}>↓ Backup</button>
          <button className="btn-ghost" onClick={() => fileRef.current.click()} style={{ fontSize:11 }}>↑ Importar</button>
          <input ref={fileRef} type="file" accept=".json" onChange={importJSON} style={{ display:"none" }} />
        </div>
      </header>

      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>
        <aside style={{ width:204, background:"white", borderRight:"1px solid #EBEBEB", display:"flex", flexDirection:"column", flexShrink:0, overflowY:"auto" }}>
          <div style={{ padding:"10px 0", borderBottom:"1px solid #F5F5F5" }}>
            <div style={{ fontSize:9, fontWeight:700, letterSpacing:"2px", textTransform:"uppercase", color:"#ccc", padding:"4px 16px 8px" }}>Navegación</div>
            {TABS.map(({id, icon, label}) => (
              <button key={id} className={`nav-item ${tab===id?"active":""}`} onClick={() => setTab(id)}>
                {icon}
                <span style={{ flex:1 }}>{label}</span>
                {id === "fatture" && scaduteCount > 0 && (
                  <span className="nav-badge">{scaduteCount}</span>
                )}
              </button>
            ))}
          </div>
        </aside>

        <div style={{ flex:1, overflow:"auto", padding:24, scrollBehavior:"smooth" }}>
          <TabErrorBoundary tabKey={tab}>
          {tab==="dashboard" && <DashboardTab data={data} metrics={metrics} forecast={forecast} ejercicio={ejercicio} EJERCICIOS={EJERCICIOS} setIvaModal={setIvaModal} exportIvaEsteraCSV={exportIvaEsteraCSV} />}

          {tab==="fatture" && (
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
                <div className="section-title">Registro Facturas</div>
                <div style={{ display:"flex", gap:8 }}>
                  <button className="btn-red" onClick={() => setInvoiceModal({ id:null,type:"emessa",number:"",date:today(),dueDate:"",client:"",supplier:"",description:"",netAmount:"",ivaType:"21%",ivaAmount:0,grossAmount:0,status:"aperta",dropboxLink:"",notes:"" })}>+ Emitida</button>
                  <button className="btn-ghost" onClick={() => setInvoiceModal({ id:null,type:"ricevuta",number:"",date:today(),dueDate:"",client:"",supplier:"",description:"",netAmount:"",ivaType:"RC (reverse charge)",ivaAmount:0,grossAmount:0,status:"aperta",dropboxLink:"",notes:"" })}>+ Recibida</button>
                </div>
              </div>
              <InvoiceTable invoices={data.invoices} onEdit={inv=>setInvoiceModal(inv)} onDelete={deleteInvoice} />
            </div>
          )}

          {tab==="movimenti" && (
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                <div className="section-title">Movimientos Bancarios</div>
                <div style={{ display:"flex", gap:8 }}>
                  <button className="btn-ghost" onClick={() => pdfRef.current.click()} style={{ fontSize:11 }}>↑ Import PDF Revolut</button>
                  <input ref={pdfRef} type="file" accept=".pdf" onChange={importPDF} style={{ display:"none" }} />
                  <button className="btn-red" onClick={() => setMovModal({ id:null,date:today(),description:"",amount:"",type:"entrata",account:"Revolut Business",invoiceId:null,reconciled:false,notes:"" })}>+ Movimiento</button>
                </div>
              </div>
              <MovementTable movements={data.movements} invoices={data.invoices} onEdit={m=>setMovModal(m)} onDelete={deleteMov} onReconcile={m=>setReconcileModal(m)} />
            </div>
          )}

          {tab==="riconciliazione" && (
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
                <div className="section-title">Conciliación</div>
                <button className="btn-red" onClick={runAutoReconcile}> Auto-riconcilia</button>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:20 }}>
                <div className="kpi-card green"><div className="kpi-label">Facturas conciliadas</div><div className="kpi-value">{data.invoices.filter(i=>i.status==="riconciliata").length}<span style={{ fontSize:14,color:"#bbb",marginLeft:6 }}>/ {data.invoices.length}</span></div></div>
                <div className="kpi-card blue"><div className="kpi-label">Movimientos asociados</div><div className="kpi-value">{data.movements.filter(m=>m.reconciled).length}<span style={{ fontSize:14,color:"#bbb",marginLeft:6 }}>/ {data.movements.length}</span></div></div>
              </div>
              <div className="card">
                <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:12 }}>Movimientos por asociar</div>
                {data.movements.filter(m=>!m.reconciled).length===0 ? <div style={{ color:"#bbb",fontSize:13 }}>Todos los movimientos están asociados </div> :
                  <table><thead><tr><th>Fecha</th><th>Descripción</th><th>Importe</th><th>Tipo</th><th></th></tr></thead>
                  <tbody>{data.movements.filter(m=>!m.reconciled).map(m=>(
                    <tr key={m.id}>
                      <td>{fmtDate(m.date)}</td>
                      <td style={{ maxWidth:280,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{m.description}</td>
                      <td style={{ color:m.type==="entrata"?"#28a745":"#E30613",fontWeight:600 }}>{m.type==="entrata"?"+":"-"}{fmt(m.amount)}</td>
                      <td><span className={`badge ${m.type==="entrata"?"badge-green":"badge-red"}`}>{m.type}</span></td>
                      <td><button className="btn-ghost" style={{ fontSize:11,padding:"4px 10px" }} onClick={()=>setReconcileModal(m)}>Asociar</button></td>
                    </tr>
                  ))}</tbody></table>
                }
              </div>
            </div>
          )}

          {tab==="forecast" && (
            <div>
              <div className="section-title" style={{ marginBottom:20 }}>Forecast Cash Flow — 90 días</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:20 }}>
                <div className="kpi-card blue"><div className="kpi-label">Liquidez actual</div><div className="kpi-value" style={{ color:"#3949ab" }}>{fmt(metrics.liquidita)}</div></div>
                <div className="kpi-card green"><div className="kpi-label">Cobros esperados 90d</div><div className="kpi-value" style={{ color:"#28a745" }}>{fmt(forecastInvoices.filter(i=>i.type==="emessa"&&i.status==="aperta").reduce((s,i)=>s+(parseFloat(i.grossAmount)||0),0))}</div></div>
                <div className="kpi-card"><div className="kpi-label">Pagos esperados 90d</div><div className="kpi-value" style={{ color:"#E30613" }}>{fmt(forecastInvoices.filter(i=>i.type==="ricevuta"&&i.status==="aperta").reduce((s,i)=>s+(parseFloat(i.grossAmount)||0),0))}</div></div>
              </div>
              <div className="card" style={{ marginBottom:16 }}>
                <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:14 }}>Proyección saldo</div>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={forecast}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F5F5F5" />
                    <XAxis dataKey="day" tick={{ fontSize:10,fill:"#bbb" }} interval={5} />
                    <YAxis tick={{ fontSize:10,fill:"#bbb" }} tickFormatter={v=>`${(v/1000).toFixed(0)}k€`} />
                    <Tooltip contentStyle={{ background:"white",border:"1.5px solid #E0E0E0",borderRadius:8,fontSize:12 }} formatter={(v)=>[fmt(v),"Saldo"]} />
                    <ReferenceLine y={0} stroke="rgba(227,6,19,0.4)" strokeDasharray="4 4" label={{ value:"€ 0",fill:"#E30613",fontSize:10 }} />
                    <ReferenceLine y={30000} stroke="rgba(40,167,69,0.4)" strokeDasharray="4 4" label={{ value:"Riserva €30K",fill:"#28a745",fontSize:10 }} />
                    <Line type="monotone" dataKey="balance" stroke="#E30613" strokeWidth={2.5} dot={false} activeDot={{ r:5,fill:"#E30613" }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {tab==="ibkr" && <IbkrTab data={data} setIbkrModal={setIbkrModal} deleteIbkr={deleteIbkr} ibkrLive={ibkrLive} onRefresh={fetchIbkrPrices} />}
          {tab==="contabilidad" && <ContabilidadTab data={data} persist={persist} contabView={contabView} setContabView={setContabView} mayorCuenta={mayorCuenta} setMayorCuenta={setMayorCuenta} setAsientoModal={setAsientoModal} deleteAsiento={deleteAsiento} exportContabCSV={exportContabCSV} />}
          {tab==="iva_estera" && <IvaEsteraTab data={data} persist={persist} ejercicio={ejercicio} EJERCICIOS={EJERCICIOS} exportIvaEsteraCSV={exportIvaEsteraCSV} />}
          {tab==="accise_gasolio" && <AcciseGasolioTab data={data} persist={persist} />}
          </TabErrorBoundary>
        </div>
      </div>

      {invoiceModal && <InvoiceModal inv={invoiceModal} onSave={saveInvoice} onClose={()=>setInvoiceModal(null)} />}
      {movModal && <MovModal mov={movModal} onSave={saveMov} onClose={()=>setMovModal(null)} />}
      {fattureAperteModal && <FattureAperteModal invoices={data.invoices} onClose={()=>setFattureAperteModal(false)} />}
      {ibkrModal && (
        <div className="modal-overlay" onClick={()=>setIbkrModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div style={{ display:"flex",justifyContent:"space-between",marginBottom:20 }}>
              <div className="modal-title">{ibkrModal.id?"Modificar operación":"Nueva operación"} IBKR SL</div>
              <button onClick={()=>setIbkrModal(null)} style={{ background:"none",fontSize:20,color:"#999" }}>×</button>
            </div>
            <IbkrForm pos={ibkrModal} onSave={saveIbkr} onClose={()=>setIbkrModal(null)} />
          </div>
        </div>
      )}
      {reconcileModal && (
        <div className="modal-overlay" onClick={()=>setReconcileModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div style={{ display:"flex",justifyContent:"space-between",marginBottom:18 }}>
              <div className="modal-title">Asociar movimiento</div>
              <button onClick={()=>setReconcileModal(null)} style={{ background:"none",fontSize:20,color:"#999" }}>×</button>
            </div>
            <div style={{ background:"#FFF5F5",border:"1.5px solid #ef9a9a",borderRadius:8,padding:14,marginBottom:18,fontSize:13 }}>
              <div style={{ fontSize:10,fontWeight:700,letterSpacing:"0.1em",color:"#bbb",marginBottom:6 }}>MOVIMENTO</div>
              <div style={{ fontWeight:600 }}>{fmtDate(reconcileModal.date)} — {reconcileModal.description}</div>
              <div style={{ color:reconcileModal.type==="entrata"?"#28a745":"#E30613",fontWeight:700,marginTop:4 }}>{reconcileModal.type==="entrata"?"+":"-"}{fmt(reconcileModal.amount)}</div>
            </div>
            <div style={{ fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#bbb",marginBottom:10 }}>Facturas disponibles</div>
            <div style={{ maxHeight:280,overflowY:"auto" }}>
              {data.invoices.filter(i=>i.status!=="riconciliata"&&((reconcileModal.type==="entrata"&&i.type==="emessa")||(reconcileModal.type==="uscita"&&i.type==="ricevuta"))).map(inv=>(
                <div key={inv.id} onClick={()=>manualReconcile(reconcileModal.id,inv.id)}
                  style={{ padding:"12px 14px",borderRadius:8,border:"1.5px solid #E0E0E0",marginBottom:8,cursor:"pointer",transition:"all 0.15s" }}
                  onMouseEnter={e=>e.currentTarget.style.borderColor="#E30613"}
                  onMouseLeave={e=>e.currentTarget.style.borderColor="#E0E0E0"}>
                  <div style={{ display:"flex",justifyContent:"space-between" }}>
                    <span style={{ color:"#E30613",fontSize:13,fontWeight:700 }}>{inv.number} — {inv.type==="emessa"?inv.client:inv.supplier}</span>
                    <span style={{ fontWeight:600 }}>{fmt(inv.grossAmount)}</span>
                  </div>
                  <div style={{ color:"#bbb",fontSize:11,marginTop:3 }}>Scad. {fmtDate(inv.dueDate)} · {inv.description}</div>
                </div>
              ))}
            </div>
            <button className="btn-ghost" style={{ marginTop:12,width:"100%" }} onClick={()=>setReconcileModal(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {asientoModal && <AsientoModal asiento={asientoModal} onSave={saveAsiento} onClose={()=>setAsientoModal(null)} />}

      {confirmModal && <ConfirmModal message={confirmModal.message} onConfirm={confirmModal.onConfirm} onCancel={()=>setConfirmModal(null)} />}
      {ivaModal && <IvaModal data={data} metrics={metrics} ejercicio={ejercicio} EJERCICIOS={EJERCICIOS} exportIvaEsteraCSV={exportIvaEsteraCSV} onClose={()=>setIvaModal(false)} />}

      {importConfirmModal && (
        <div className="modal-overlay" onClick={()=>setImportConfirmModal(null)}>
          <div className="modal" style={{ maxWidth:460 }} onClick={e=>e.stopPropagation()}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18 }}>
              <div className="modal-title">⚠️ Conferma Import JSON</div>
              <button onClick={()=>setImportConfirmModal(null)} style={{ background:"none",fontSize:20,color:"#999" }}>×</button>
            </div>
            <div style={{ background:"#fff8e1",border:"1.5px solid #ffe082",borderRadius:8,padding:"12px 14px",marginBottom:16,fontSize:12,color:"#b8860b",fontWeight:600 }}>
              Stai per sovrascrivere tutti i dati attuali. Questa azione non è reversibile.
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:18 }}>
              <div style={{ background:"#ffebee",border:"1.5px solid #ef9a9a",borderRadius:8,padding:"10px 14px" }}>
                <div style={{ fontSize:10,fontWeight:700,color:"#c62828",textTransform:"uppercase",marginBottom:8 }}>Dati attuali (persi)</div>
                <div style={{ fontSize:12,color:"#666" }}>📄 {importConfirmModal.summary.currentInv} fatture</div>
                <div style={{ fontSize:12,color:"#666" }}>💳 {importConfirmModal.summary.currentMov} movimenti</div>
                <div style={{ fontSize:12,color:"#666" }}>📒 {importConfirmModal.summary.currentAsi} asientos</div>
              </div>
              <div style={{ background:"#e8f5e9",border:"1.5px solid #a5d6a7",borderRadius:8,padding:"10px 14px" }}>
                <div style={{ fontSize:10,fontWeight:700,color:"#2e7d32",textTransform:"uppercase",marginBottom:8 }}>File (caricati)</div>
                <div style={{ fontSize:12,color:"#666" }}>📄 {importConfirmModal.summary.invoices} fatture</div>
                <div style={{ fontSize:12,color:"#666" }}>💳 {importConfirmModal.summary.movements} movimenti</div>
                <div style={{ fontSize:12,color:"#666" }}>📒 {importConfirmModal.summary.asientos} asientos</div>
              </div>
            </div>
            <div style={{ display:"flex",gap:8 }}>
              <button className="btn-red" style={{ flex:1 }} onClick={confirmImport}>✓ Sì, importa e sovrascrivi</button>
              <button className="btn-ghost" style={{ flex:1 }} onClick={()=>setImportConfirmModal(null)}>Annulla</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position:"fixed",bottom:24,right:24,background:toast.type==="err"?"#ffebee":toast.type==="warn"?"#fffde7":"#e8f5e9",border:`1.5px solid ${toast.type==="err"?"#ef9a9a":toast.type==="warn"?"#ffe082":"#a5d6a7"}`,color:toast.type==="err"?"#c62828":toast.type==="warn"?"#b8860b":"#2e7d32",padding:"12px 20px",borderRadius:10,fontSize:13,fontWeight:600,zIndex:200,boxShadow:"0 4px 20px rgba(0,0,0,0.1)" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}


// ── DASHBOARD TAB ────────────────────────────────────────────────────────────
// ── IVA ESTERA EXPORT BUTTON (riutilizzato nel modal) ────────────────────────
function IvaEsteraExportBtn({ exportIvaEsteraCSV, ejercicio }) {
  const [open, setOpen] = useState(false);
  const ej   = EJERCICIOS.find(e=>e.id===ejercicio)||EJERCICIOS[1];
  const anno = ej.from.slice(0,4);
  const trimestri = [
    { id:"T1", label:`T1 ${anno}`, scad:`30/04/${anno}` },
    { id:"T2", label:`T2 ${anno}`, scad:`31/07/${anno}` },
    { id:"T3", label:`T3 ${anno}`, scad:`31/10/${anno}` },
    { id:"T4", label:`T4 ${anno}`, scad:`31/01/${parseInt(anno)+1}` },
  ];
  return (
    <div style={{ position:"relative" }}>
      <button className="btn-ghost" style={{ fontSize:11,background:"#fffde7",borderColor:"#ffe082",color:"#b8860b",fontWeight:700 }} onClick={()=>setOpen(o=>!o)}>
        ↓ Export CSV Hacienda
      </button>
      {open && (
        <div style={{ position:"absolute",top:"100%",right:0,marginTop:4,background:"white",border:"1.5px solid #ffe082",borderRadius:8,boxShadow:"0 4px 20px rgba(0,0,0,0.12)",zIndex:50,minWidth:210,overflow:"hidden" }}>
          <div style={{ fontSize:9,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",padding:"8px 14px 4px" }}>Seleziona trimestre</div>
          {trimestri.map(t=>(
            <button key={t.id} onClick={()=>{exportIvaEsteraCSV(t.id);setOpen(false);}}
              style={{ display:"block",width:"100%",textAlign:"left",padding:"10px 14px",background:"white",border:"none",borderBottom:"1px solid #F5F5F5",cursor:"pointer",fontSize:12,fontWeight:600,color:"#1A1A1A" }}
              onMouseEnter={e=>e.currentTarget.style.background="#fffde7"} onMouseLeave={e=>e.currentTarget.style.background="white"}>
              <span style={{ fontWeight:800,color:"#b8860b",marginRight:8 }}>{t.id}</span>{t.label}
              <span style={{ float:"right",fontSize:10,color:"#bbb",fontWeight:400 }}>scad. {t.scad}</span>
            </button>
          ))}
          <div style={{ padding:"8px 14px",fontSize:10,color:"#bbb",borderTop:"1px solid #F5F5F5" }}>CSV ; · per La Clau Assessors</div>
        </div>
      )}
    </div>
  );
}

// ── CARD IVA RIEPILOGO (solo totali — dashboard) ──────────────────────────────
function IvaResumenCard({ metrics, data, ejercicio, EJERCICIOS, onDetail }) {
  const { ivaSop, ivaRep, ivaCredito, ivaDevol } = metrics;
  const isCredito = ivaCredito >= 0;

  // Calcola totale IVA estera recuperabile per l'esercizio corrente
  const ej = EJERCICIOS.find(e=>e.id===ejercicio)||EJERCICIOS[1];
  const PAESI = ["IT","FR","DE","AT","BE"];
  let totEstera = 0;
  data.invoices.forEach(inv => {
    if (inv.type !== "ricevuta") return;
    const d = inv.fechaOperacion||inv.date||"";
    if (!d || d<ej.from || d>ej.to) return;
    if (!inv.paisIvaOrigen || inv.paisIvaOrigen==="ES") return;
    if (!PAESI.includes(inv.paisIvaOrigen)) return;
    totEstera += parseFloat(inv.ivaEsteraAmount)||0;
  });

  return (
    <div className="card" style={{ marginBottom:16, borderLeft:"4px solid #3949ab" }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
        <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb" }}>
          🇪🇸 IVA España &amp; 🇮🇹🇫🇷 IVA Estera
        </div>
        <button className="btn-ghost" style={{ fontSize:11 }} onClick={onDetail}>📊 Detalle completo →</button>
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16 }}>
        <div style={{ textAlign:"center",padding:"10px",background:isCredito?"#f0fff4":"#fff5f5",borderRadius:8,border:`1.5px solid ${isCredito?"#a5d6a7":"#ef9a9a"}` }}>
          <div style={{ fontSize:10,color:"#bbb",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4 }}>IVA ES — Crédito neto</div>
          <div style={{ fontSize:24,fontWeight:900,color:isCredito?"#28a745":"#E30613" }}>{fmt(Math.abs(ivaCredito))}</div>
          <div style={{ fontSize:10,color:isCredito?"#28a745":"#E30613",marginTop:2,fontWeight:700 }}>{isCredito?"✓ crédito AEAT":"⚠ deuda AEAT"}</div>
        </div>
        <div style={{ textAlign:"center",padding:"10px",background:"#e8f5e9",borderRadius:8,border:"1.5px solid #a5d6a7" }}>
          <div style={{ fontSize:10,color:"#bbb",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4 }}>REDEME devuelto</div>
          <div style={{ fontSize:24,fontWeight:900,color:"#28a745" }}>{fmt(ivaDevol)}</div>
          <div style={{ fontSize:10,color:"#bbb",marginTop:2 }}>rimborso ricevuto</div>
        </div>
        <div style={{ textAlign:"center",padding:"10px",background:totEstera>=IVA_ESTERA_SOGLIA_ANNUA?"#e8f5e9":"#fffde7",borderRadius:8,border:`1.5px solid ${totEstera>=IVA_ESTERA_SOGLIA_ANNUA?"#a5d6a7":"#ffe082"}` }}>
          <div style={{ fontSize:10,color:"#bbb",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4 }}>IVA Estera recuperabile</div>
          <div style={{ fontSize:24,fontWeight:900,color:totEstera>=IVA_ESTERA_SOGLIA_ANNUA?"#28a745":"#b8860b" }}>{fmt(totEstera)}</div>
          <div style={{ fontSize:10,color:totEstera>=IVA_ESTERA_SOGLIA_ANNUA?"#28a745":"#b8860b",marginTop:2,fontWeight:700 }}>
            {totEstera>=IVA_ESTERA_SOGLIA_ANNUA?"✓ soglia annua ok":"⚠ sotto soglia €50"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── EsposizioneFornitori CARD ─────────────────────────────────────────────────────────────────
function EsposizioneFornitoriCard({ data, metrics, ejercicio, EJERCICIOS }) {
const ej = EJERCICIOS.find(e=>e.id===ejercicio)||EJERCICIOS[2];
        const ricevute = data.invoices.filter(i=>{
          const d=i.fechaOperacion||i.date||"";
          return i.type==="ricevuta" && d>=ej.from && d<=ej.to;
        });
        // Raggruppa per fornitore
        const bySupp = {};
        ricevute.forEach(i=>{
          const s = i.supplier || "Altro";
          if (!bySupp[s]) bySupp[s] = { supplier:s, totale:0, aperte:0, pagato:0 };
          const net = parseFloat(i.netAmount)||0;
          bySupp[s].totale += net;
          if (i.status==="aperta") bySupp[s].aperte += parseFloat(i.grossAmount)||0;
          else bySupp[s].pagato += net;
        });
        const rows = Object.values(bySupp).sort((a,b)=>b.totale-a.totale).slice(0,6);
        if (!rows.length) return null;
        const totale = rows.reduce((s,r)=>s+r.totale,0); if (!totale) return null;
        return (
          <div className="card">
            <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:14 }}>
              Esposizione fornitori — {EJERCICIOS.find(e=>e.id===ejercicio)?.label}
            </div>
            <table>
              <thead><tr><th>Fornitore</th><th style={{ textAlign:"right" }}>Totale costi</th><th style={{ textAlign:"right" }}>% su totale</th><th style={{ textAlign:"right" }}>Ancora aperto</th></tr></thead>
              <tbody>
                {rows.map(r=>(
                  <tr key={r.supplier}>
                    <td style={{ fontWeight:600 }}>{r.supplier}</td>
                    <td style={{ textAlign:"right" }}>{fmt(r.totale)}</td>
                    <td style={{ textAlign:"right" }}>
                      <div style={{ display:"flex",alignItems:"center",justifyContent:"flex-end",gap:8 }}>
                        <div style={{ width:60,height:4,background:"#F5F5F5",borderRadius:2 }}>
                          <div style={{ width:`${Math.min(r.totale/totale*100,100)}%`,height:"100%",background:"#3949ab",borderRadius:2 }} />
                        </div>
                        <span style={{ fontSize:11,color:"#999" }}>{(r.totale/totale*100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td style={{ textAlign:"right",fontWeight:r.aperte>0?700:400,color:r.aperte>0?"#E30613":"#bbb" }}>
                      {r.aperte>0?fmt(r.aperte):"—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
}

// ── CreditiScaduti CARD ─────────────────────────────────────────────────────────────────
function CreditiScadutiCard({ data, metrics, ejercicio, EJERCICIOS }) {
const todayStr = new Date().toISOString().split("T")[0];
        const scaduti = data.invoices
          .filter(i=>i.type==="emessa" && i.status==="aperta" && i.dueDate && i.dueDate < todayStr)
          .map(i=>({ ...i, giorniScaduto: Math.round((new Date(todayStr)-new Date(i.dueDate))/86400000) }))
          .sort((a,b)=>b.giorniScaduto-a.giorniScaduto);
        const aperteNonScadute = data.invoices.filter(i=>i.type==="emessa"&&i.status==="aperta"&&(!i.dueDate||i.dueDate>=todayStr));
        if (!scaduti.length && !aperteNonScadute.length) return null;
        return (
          <div className="card" style={{ marginBottom:16 }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
              <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb" }}>
                Crediti — Scaduto e in scadenza
              </div>
              {scaduti.length>0 && (
                <span style={{ background:"#ffebee",border:"1.5px solid #ef9a9a",borderRadius:6,padding:"4px 12px",fontSize:12,fontWeight:800,color:"#E30613" }}>
                  🔴 {fmt(scaduti.reduce((s,i)=>s+(parseFloat(i.grossAmount)||0),0))} scaduto
                </span>
              )}
            </div>
            <table>
              <thead><tr><th>N°</th><th>Cliente</th><th>Scadenza</th><th style={{ textAlign:"right" }}>Giorni</th><th style={{ textAlign:"right" }}>Importo</th><th>Stato</th></tr></thead>
              <tbody>
                {scaduti.map(inv=>(
                  <tr key={inv.id} style={{ background:"#fff5f5" }}>
                    <td style={{ fontWeight:700,color:"#E30613" }}>{inv.number||"—"}</td>
                    <td style={{ fontWeight:600 }}>{inv.client||"—"}</td>
                    <td style={{ color:"#E30613",fontWeight:700 }}>{fmtDate(inv.dueDate)}</td>
                    <td style={{ textAlign:"right",fontWeight:800,color:"#E30613" }}>+{inv.giorniScaduto}gg</td>
                    <td style={{ textAlign:"right",fontWeight:700 }}>{fmt(inv.grossAmount)}</td>
                    <td><span className="badge badge-red">scaduta</span></td>
                  </tr>
                ))}
                {aperteNonScadute.map(inv=>{
                  const gg = inv.dueDate ? Math.round((new Date(inv.dueDate)-new Date(todayStr))/86400000) : null;
                  return (
                    <tr key={inv.id}>
                      <td style={{ fontWeight:700,color:"#E30613" }}>{inv.number||"—"}</td>
                      <td style={{ fontWeight:600 }}>{inv.client||"—"}</td>
                      <td style={{ color:"#999" }}>{fmtDate(inv.dueDate)}</td>
                      <td style={{ textAlign:"right",color:gg!==null&&gg<=7?"#b8860b":"#bbb" }}>{gg!==null?`${gg}gg`:"—"}</td>
                      <td style={{ textAlign:"right",fontWeight:700 }}>{fmt(inv.grossAmount)}</td>
                      <td><span className="badge badge-yellow">aperta</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
}

// ── CashFlowMensile CARD ─────────────────────────────────────────────────────────────────
function CashFlowMensileCard({ data, metrics, ejercicio, EJERCICIOS }) {
if (!data.movements.length) return null;
        const ej = EJERCICIOS.find(e=>e.id===ejercicio)||EJERCICIOS[2];
        const byMonth = {};
        data.movements
          .filter(m=>{ const d=m.date||""; return d>=ej.from&&d<=ej.to; })
          .forEach(m=>{
            const mo = m.date.slice(0,7);
            if (!byMonth[mo]) byMonth[mo] = { month:m.date.slice(5,7)+"/"+m.date.slice(2,4), entrate:0, uscite:0 };
            if (m.type==="entrata") byMonth[mo].entrate += parseFloat(m.amount)||0;
            else                    byMonth[mo].uscite  += parseFloat(m.amount)||0;
          });
        const chartData = Object.values(byMonth)
          .sort((a,b)=>a.month.localeCompare(b.month))
          .map(d=>({ ...d, netto: d.entrate - d.uscite }));
        if (!chartData.length) return null;
        return (
          <div className="card" style={{ marginBottom:16 }}>
            <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:14 }}>
              Cash Flow Banco — Mensile reale (movimenti Revolut)
            </div>
            <div style={{ display:"flex",gap:16,marginBottom:10,fontSize:11 }}>
              <span style={{ display:"flex",alignItems:"center",gap:5 }}><span style={{ width:12,height:12,background:"#28a745",borderRadius:2,display:"inline-block" }}/> Entrate</span>
              <span style={{ display:"flex",alignItems:"center",gap:5 }}><span style={{ width:12,height:12,background:"#3949ab",borderRadius:2,display:"inline-block" }}/> Uscite</span>
              <span style={{ display:"flex",alignItems:"center",gap:5 }}><span style={{ width:12,height:12,background:"#E30613",borderRadius:2,display:"inline-block" }}/> Netto</span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} barGap={2} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="#F5F5F5" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize:11,fill:"#bbb" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize:10,fill:"#bbb" }} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:`${v}`} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background:"white",border:"1.5px solid #E0E0E0",borderRadius:8,fontSize:12 }}
                  formatter={(v,n)=>[fmt(v), n==="entrate"?"Entrate":n==="uscite"?"Uscite":"Netto"]}
                />
                <ReferenceLine y={0} stroke="rgba(227,6,19,0.3)" strokeDasharray="4 4" />
                <Bar dataKey="entrate" fill="#28a745" radius={[3,3,0,0]} />
                <Bar dataKey="uscite"  fill="#3949ab" radius={[3,3,0,0]} />
                <Bar dataKey="netto" radius={[3,3,0,0]}>
                  {chartData.map((d,i)=><Cell key={i} fill={d.netto>=0?"#E30613":"#ff6b6b"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ fontSize:10,color:"#bbb",marginTop:6,textAlign:"right" }}>
              Dati reali da estratto conto Revolut Business — non competenza contabile
            </div>
          </div>
        );
}

// ── CicloCassa CARD ─────────────────────────────────────────────────────────────────
function CicloCassaCard({ data, metrics, ejercicio, EJERCICIOS }) {
const ej = EJERCICIOS.find(e=>e.id===ejercicio)||EJERCICIOS[2];
        const todayStr = new Date().toISOString().split("T")[0];
        const inv = data.invoices.filter(i=>{ const d=i.fechaOperacion||i.date||""; return d>=ej.from&&d<=ej.to; });
        const emesse   = inv.filter(i=>i.type==="emessa");
        const ricevute = inv.filter(i=>i.type==="ricevuta");

        // DSO: media giorni tra data fattura e data incasso (solo riconciliate con movimento)
        // Mappa bidirezionale: movimientoId su fattura OPPURE invoiceId su movimento
        const movMap = {};
        data.movements.forEach(m=>{ if(m.invoiceId) movMap[m.invoiceId]=m.date; });
        // Aggiunge anche i link dal campo movimientoId sulla fattura
        data.invoices.forEach(inv=>{ if(inv.movimientoId && !movMap[inv.id]){
          const mov = data.movements.find(m=>m.id===inv.movimientoId);
          if(mov) movMap[inv.id]=mov.date;
        }});
        const dsoCalcs = emesse
          .filter(i=>i.status==="riconciliata" && movMap[i.id] && i.date)
          .map(i=>Math.max(0, Math.round((new Date(movMap[i.id])-new Date(i.date))/86400000)));
        const dso = dsoCalcs.length ? Math.round(dsoCalcs.reduce((a,b)=>a+b,0)/dsoCalcs.length) : null;

        // DPO: media giorni tra data fattura ricevuta e data pagamento
        const dpoCalcs = ricevute
          .filter(i=>i.status==="riconciliata" && movMap[i.id] && i.date)
          .map(i=>Math.max(0, Math.round((new Date(movMap[i.id])-new Date(i.date))/86400000)));
        const dpo = dpoCalcs.length ? Math.round(dpoCalcs.reduce((a,b)=>a+b,0)/dpoCalcs.length) : null;

        // Crediti scaduti: fatture emesse aperte con dueDate < oggi
        const scaduti = emesse.filter(i=>i.status==="aperta" && i.dueDate && i.dueDate < todayStr);
        const totScaduti = scaduti.reduce((s,i)=>s+(parseFloat(i.grossAmount)||0),0);
        const maxScaduto = scaduti.length
          ? Math.max(...scaduti.map(i=>Math.round((new Date(todayStr)-new Date(i.dueDate))/86400000)))
          : 0;

        // Concentrazione clienti: % Buzzatti su fatturato
        const fatTot = emesse.reduce((s,i)=>s+(parseFloat(i.netAmount)||0),0);
        const fatBuzz = emesse.filter(i=>(i.client||"").includes("Buzzatti")).reduce((s,i)=>s+(parseFloat(i.netAmount)||0),0);
        const concBuzz = fatTot > 0 ? (fatBuzz/fatTot*100) : 0;

        return (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14, marginBottom:16 }}>
            {/* DSO */}
            <div className="card" style={{ borderLeft:`4px solid ${dso>30?"#E30613":"#28a745"}` }}>
              <div className="kpi-label">DSO — Giorni incasso</div>
              <div className="kpi-value" style={{ color: dso===null?"#bbb":dso>30?"#E30613":"#28a745", fontSize:28 }}>
                {dso===null?"—":`${dso}gg`}
              </div>
              <div style={{ fontSize:11,color:"#999",marginTop:4 }}>
                {dso===null?"Sin facturas conciliadas":dso<=30?"✓ Bajo 30 días":dso<=45?"⚠ Atención":"🔴 Alto riesgo de liquidez"}
              </div>
              <div style={{ fontSize:10,color:"#bbb",marginTop:2 }}>Su {dsoCalcs.length} fatture riconciliate</div>
            </div>

            {/* DPO */}
            <div className="card" style={{ borderLeft:`4px solid ${dpo>45?"#E30613":dpo>30?"#b8860b":"#3949ab"}` }}>
              <div className="kpi-label">DPO — Giorni pagamento</div>
              <div className="kpi-value" style={{ color:"#3949ab", fontSize:28 }}>
                {dpo===null?"—":`${dpo}gg`}
              </div>
              <div style={{ fontSize:11,color:"#999",marginTop:4 }}>
                {dpo===null?"Nessun pagamento":dso!==null&&dso>dpo?"⚠ Incassi più lenti dei pagamenti":"✓ Ciclo bilanciato"}
              </div>
              <div style={{ fontSize:10,color:"#bbb",marginTop:2 }}>Su {dpoCalcs.length} fatture pagate</div>
            </div>

            {/* Concentrazione */}
            <div className="card" style={{ borderLeft:`4px solid ${concBuzz>90?"#E30613":concBuzz>70?"#b8860b":"#28a745"}` }}>
              <div className="kpi-label">Concentrazione Buzzatti</div>
              <div className="kpi-value" style={{ color:concBuzz>90?"#E30613":"#b8860b", fontSize:28 }}>
                {concBuzz.toFixed(0)}%
              </div>
              <div style={{ fontSize:11,color:"#999",marginTop:4 }}>
                {concBuzz>90?"🔴 Rischio mono-cliente elevato":concBuzz>70?"⚠ Diversificare urgente":"✓ Ok"}
              </div>
              <div style={{ fontSize:10,color:"#bbb",marginTop:2 }}>{fmt(fatBuzz)} su {fmt(fatTot)}</div>
            </div>
          </div>
        );
}

function DashboardTab({ data, metrics, forecast, ejercicio, EJERCICIOS, setIvaModal, exportIvaEsteraCSV }) {
  return (
    <div>
      <div className="section-title" style={{ marginBottom:20 }}>Panoramica</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:20 }}>
        <div className="kpi-card"><div className="kpi-label">Facturado neto</div><div className="kpi-value" style={{ color:"#E30613" }}>{fmt(metrics.fatturato)}</div></div>
        <div className="kpi-card yellow"><div className="kpi-label">Costes netos</div><div className="kpi-value" style={{ color:"#b8860b" }}>{fmt(metrics.costi)}</div></div>
        <div className="kpi-card green"><div className="kpi-label">Margen bruto</div><div className="kpi-value" style={{ color:metrics.margine>=0?"#28a745":"#E30613" }}>{fmt(metrics.margine)} <span style={{ fontSize:14, color:"#999" }}>{metrics.marginePerc.toFixed(1)}%</span></div></div>
        <div className="kpi-card yellow"><div className="kpi-label">Créditos abiertos</div><div className="kpi-value" style={{ color:"#b8860b" }}>{fmt(metrics.creditiAperti)}</div></div>
        <div className="kpi-card gray"><div className="kpi-label">Débitos abiertos</div><div className="kpi-value" style={{ color:"#666" }}>{fmt(metrics.debitiAperti)}</div></div>
        <div className="kpi-card blue"><div className="kpi-label">Liquidez estimada</div><div className="kpi-value" style={{ color:metrics.liquidita>=0?"#3949ab":"#E30613" }}>{fmt(metrics.liquidita)}</div></div>
      </div>

      <IvaResumenCard metrics={metrics} data={data} ejercicio={ejercicio} EJERCICIOS={EJERCICIOS} onDetail={()=>setIvaModal(true)} />

      <div className="card" style={{ marginBottom:16 }}>
        <div style={{ fontSize:10, fontWeight:700, letterSpacing:"1.5px", textTransform:"uppercase", color:"#bbb", marginBottom:12 }}>Forecast liquidez 90 días</div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={forecast}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F5F5F5" />
            <XAxis dataKey="day" tick={{ fontSize:10, fill:"#bbb" }} interval={4} />
            <YAxis tick={{ fontSize:10, fill:"#bbb" }} tickFormatter={v=>`${(v/1000).toFixed(0)}k`} />
            <Tooltip contentStyle={{ background:"white", border:"1.5px solid #E0E0E0", borderRadius:8, fontSize:12 }} formatter={(v)=>[fmt(v),"Liquidità"]} />
            <ReferenceLine y={0} stroke="rgba(227,6,19,0.3)" strokeDasharray="4 4" />
            <ReferenceLine y={30000} stroke="rgba(40,167,69,0.3)" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="balance" stroke="#E30613" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <CicloCassaCard data={data} metrics={metrics} ejercicio={ejercicio} EJERCICIOS={EJERCICIOS} />
      <CashFlowMensileCard data={data} metrics={metrics} ejercicio={ejercicio} EJERCICIOS={EJERCICIOS} />
      <CreditiScadutiCard data={data} metrics={metrics} ejercicio={ejercicio} EJERCICIOS={EJERCICIOS} />
      <EsposizioneFornitoriCard data={data} metrics={metrics} ejercicio={ejercicio} EJERCICIOS={EJERCICIOS} />
    </div>
  );
}

// ── IVA MODAL UNIFICATO (tabbed: IVA ES + IVA Estera) ────────────────────────
function IvaModal({ data, metrics, ejercicio, EJERCICIOS, exportIvaEsteraCSV, onClose }) {
  const [activeTab, setActiveTab] = useState("es");
  const ej = EJERCICIOS.find(e=>e.id===ejercicio)||EJERCICIOS[2];
  const anno = ej.from.slice(0,4);

  // ── Calcoli IVA ES ──
  const invES = data.invoices.filter(inv=>{
    const d=inv.fechaOperacion||inv.date||"";
    if(d<ej.from||d>ej.to) return false;
    return !(inv.paisIvaOrigen && inv.paisIvaOrigen!=="ES");
  });
  const getTrim = d => { const mo=parseInt(d.slice(5,7)); return mo<=3?"Q1":mo<=6?"Q2":mo<=9?"Q3":"Q4"; };
  const byTrimES = {};
  ["Q1","Q2","Q3","Q4"].forEach(t=>{ byTrimES[t]={ soportado:0,repercutido:0,devuelto:0 }; });
  invES.filter(i=>i.type==="ricevuta").forEach(inv=>{
    const d=inv.fechaOperacion||inv.date||""; const iva=parseFloat(inv.ivaAmount||0);
    if(iva>0) byTrimES[getTrim(d)].soportado+=iva;
  });
  invES.filter(i=>i.type==="emessa").forEach(inv=>{
    const d=inv.fechaOperacion||inv.date||""; const iva=parseFloat(inv.ivaAmount||0);
    if(iva>0) byTrimES[getTrim(d)].repercutido+=iva;
  });
  data.movements.forEach(m=>{
    if(m.type==="entrata"&&(m.description||"").toUpperCase().includes("AEAT")){
      const d=m.date||""; if(d>=ej.from&&d<=ej.to) byTrimES[getTrim(d)].devuelto+=parseFloat(m.amount||0);
    }
  });
  let saldoCumulatoES=0;
  const rowsES = ["Q1","Q2","Q3","Q4"].map(t=>{
    const {soportado,repercutido,devuelto}=byTrimES[t];
    const credito303=soportado-repercutido;
    saldoCumulatoES+=credito303-devuelto;
    return {trim:t,soportado,repercutido,credito303,devuelto,saldoCumulato:saldoCumulatoES};
  });
  const totSop=rowsES.reduce((s,r)=>s+r.soportado,0);
  const totRep=rowsES.reduce((s,r)=>s+r.repercutido,0);
  const totDevol=rowsES.reduce((s,r)=>s+r.devuelto,0);
  const saldoFinale=rowsES[3].saldoCumulato;
  const fatES=invES.filter(i=>i.type==="ricevuta"&&parseFloat(i.ivaAmount||0)>0)
    .sort((a,b)=>(a.fechaOperacion||a.date||"").localeCompare(b.fechaOperacion||b.date||""));

  // ── Calcoli IVA Estera ──
  const PAESI=["IT","FR","DE","AT","BE"];
  const trimEstera=[
    {id:"T1",mesi:[1,2,3],scad:`30/04/${anno}`},
    {id:"T2",mesi:[4,5,6],scad:`31/07/${anno}`},
    {id:"T3",mesi:[7,8,9],scad:`31/10/${anno}`},
    {id:"T4",mesi:[10,11,12],scad:`31/01/${parseInt(anno)+1}`},
  ];
  const ivaByTrim={};
  trimEstera.forEach(t=>{ivaByTrim[t.id]={...Object.fromEntries(PAESI.map(p=>[p,0])),tot:0};});
  data.invoices.forEach(inv=>{
    if(inv.type!=="ricevuta") return;
    const d=inv.fechaOperacion||inv.date||"";
    if(!d||d<ej.from||d>ej.to) return;
    if(!inv.paisIvaOrigen||inv.paisIvaOrigen==="ES") return;
    const iva=parseFloat(inv.ivaEsteraAmount)||0; if(iva<=0) return;
    const mo=parseInt(d.slice(5,7));
    const t=mo<=3?"T1":mo<=6?"T2":mo<=9?"T3":"T4";
    const p=inv.paisIvaOrigen; if(!PAESI.includes(p)) return;
    ivaByTrim[t][p]+=iva; ivaByTrim[t].tot+=iva;
  });
  const totAnnuo={tot:0,...Object.fromEntries(PAESI.map(p=>[p,0]))};
  Object.values(ivaByTrim).forEach(t=>{PAESI.forEach(p=>{totAnnuo[p]+=t[p];}); totAnnuo.tot+=t.tot;});
  const fatEstera=data.invoices.filter(inv=>{
    if(inv.type!=="ricevuta") return false;
    const d=inv.fechaOperacion||inv.date||"";
    if(!d||d<ej.from||d>ej.to) return false;
    return inv.paisIvaOrigen&&inv.paisIvaOrigen!=="ES"&&parseFloat(inv.ivaEsteraAmount||0)>0;
  }).sort((a,b)=>(a.fechaOperacion||a.date||"").localeCompare(b.fechaOperacion||b.date||""));

  const tabStyle = (id) => ({
    padding:"8px 20px", border:"none", cursor:"pointer", fontWeight:700, fontSize:13,
    borderBottom: activeTab===id?"3px solid #E30613":"3px solid transparent",
    color: activeTab===id?"#E30613":"#999", background:"transparent"
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:780,maxHeight:"90vh",overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:0 }}>
          <div className="modal-title">📊 IVA — Detalle completo</div>
          <button onClick={onClose} style={{ background:"none",fontSize:20,color:"#999" }}>×</button>
        </div>
        {/* Tabs */}
        <div style={{ display:"flex",borderBottom:"1.5px solid #F0F0F0",marginBottom:20,marginTop:12 }}>
          <button style={tabStyle("es")} onClick={()=>setActiveTab("es")}>🇪🇸 IVA España 303 / REDEME</button>
          <button style={tabStyle("estera")} onClick={()=>setActiveTab("estera")}>🇮🇹🇫🇷 IVA Estera UE</button>
        </div>

        {/* ── TAB IVA ES ── */}
        {activeTab==="es" && (
          <div>
            <div style={{ background:saldoFinale>=0?"#e8f5e9":"#ffebee",border:`2px solid ${saldoFinale>=0?"#a5d6a7":"#ef9a9a"}`,borderRadius:12,padding:"16px 20px",marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <div>
                <div style={{ fontSize:10,fontWeight:700,color:saldoFinale>=0?"#2e7d32":"#c62828",letterSpacing:"1.5px",textTransform:"uppercase" }}>
                  {saldoFinale>=0?"✓ CREDITO AEAT ACUMULADO":"⚠ DEUDA AEAT"}
                </div>
                <div style={{ fontSize:32,fontWeight:900,color:saldoFinale>=0?"#28a745":"#E30613",lineHeight:1,marginTop:4 }}>{fmt(Math.abs(saldoFinale))}</div>
                <div style={{ fontSize:11,color:"#999",marginTop:4 }}>Soportado {fmt(totSop)} − Repercutido {fmt(totRep)} − Devuelto {fmt(totDevol)}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:10,color:"#bbb",fontWeight:700 }}>REDEME ACTIVO</div>
                <div style={{ fontSize:12,color:"#3949ab",fontWeight:700,marginTop:4 }}>Rimborso mensile</div>
                <div style={{ fontSize:10,color:"#bbb",marginTop:2 }}>Scadenza 303: 20° gg mese succ.</div>
              </div>
            </div>
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:10 }}>Riepilogo trimestrale — contatore cumulato</div>
              <table>
                <thead><tr><th>Trim.</th><th style={{ textAlign:"right" }}>Soportado</th><th style={{ textAlign:"right" }}>Repercutido</th><th style={{ textAlign:"right" }}>Credito 303</th><th style={{ textAlign:"right" }}>Devuelto AEAT</th><th style={{ textAlign:"right" }}>Saldo cumulato</th></tr></thead>
                <tbody>{rowsES.map(r=>{
                  const hasData=r.soportado>0||r.repercutido>0||r.devuelto>0;
                  return (<tr key={r.trim} style={{ background:!hasData?"transparent":r.saldoCumulato>=0?"#f8fff8":"#fff8f8" }}>
                    <td style={{ fontWeight:700,color:"#E30613" }}>{r.trim}</td>
                    <td style={{ textAlign:"right",color:r.soportado?"#3949ab":"#bbb" }}>{r.soportado?fmt(r.soportado):"—"}</td>
                    <td style={{ textAlign:"right",color:r.repercutido?"#E30613":"#bbb" }}>{r.repercutido?fmt(r.repercutido):"—"}</td>
                    <td style={{ textAlign:"right",fontWeight:600,color:r.credito303>0?"#28a745":r.credito303<0?"#E30613":"#bbb" }}>{r.credito303!==0?(r.credito303>0?"+":"")+fmt(r.credito303):"—"}</td>
                    <td style={{ textAlign:"right",color:r.devuelto?"#28a745":"#bbb" }}>{r.devuelto?fmt(r.devuelto):"—"}</td>
                    <td style={{ textAlign:"right",fontWeight:800,fontSize:14,color:r.saldoCumulato>=0?"#28a745":"#E30613" }}>{fmt(r.saldoCumulato)}</td>
                  </tr>);
                })}</tbody>
                <tfoot><tr style={{ borderTop:"2px solid #E0E0E0",background:"#FAFAFA" }}>
                  <td style={{ fontWeight:700 }}>TOTAL</td>
                  <td style={{ textAlign:"right",fontWeight:700,color:"#3949ab" }}>{fmt(totSop)}</td>
                  <td style={{ textAlign:"right",fontWeight:700,color:"#E30613" }}>{fmt(totRep)}</td>
                  <td style={{ textAlign:"right",fontWeight:700,color:totSop-totRep>=0?"#28a745":"#E30613" }}>{fmt(totSop-totRep)}</td>
                  <td style={{ textAlign:"right",fontWeight:700,color:"#28a745" }}>{totDevol?fmt(totDevol):"—"}</td>
                  <td style={{ textAlign:"right",fontWeight:900,fontSize:15,color:saldoFinale>=0?"#28a745":"#E30613" }}>{fmt(saldoFinale)}</td>
                </tr></tfoot>
              </table>
            </div>
            {fatES.length>0 && (
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:10 }}>Fatture acquisti con IVA ES ({fatES.length})</div>
                <div style={{ maxHeight:220,overflowY:"auto" }}>
                  <table>
                    <thead><tr><th>N°</th><th>Fecha</th><th>Proveedor</th><th style={{ textAlign:"right" }}>Base</th><th style={{ textAlign:"right" }}>IVA</th><th>%</th><th>Stato</th></tr></thead>
                    <tbody>{fatES.map(inv=>(
                      <tr key={inv.id}>
                        <td style={{ fontSize:11,color:"#E30613",fontWeight:700 }}>{inv.number||"—"}</td>
                        <td style={{ fontSize:11,color:"#999" }}>{fmtDate(inv.fechaOperacion||inv.date)}</td>
                        <td style={{ fontSize:11,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{inv.supplier||"—"}</td>
                        <td style={{ textAlign:"right",fontSize:11 }}>{fmt(inv.netAmount)}</td>
                        <td style={{ textAlign:"right",fontWeight:600,color:"#3949ab",fontSize:11 }}>{fmt(inv.ivaAmount)}</td>
                        <td style={{ fontSize:10,color:"#bbb" }}>{inv.ivaType}</td>
                        <td><span className={`badge ${inv.status==="riconciliata"?"badge-blue":inv.status==="pagata"?"badge-green":"badge-yellow"}`}>{inv.status}</span></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            )}
            <div style={{ background:"#fffde7",border:"1.5px solid #ffe082",borderRadius:8,padding:"10px 14px",fontSize:11,color:"#b8860b" }}>
              ℹ️ IVA estera (IT/FR/DE/AT/BE) <strong>non</strong> transita nel Modelo 303 — gestita nella tab "IVA Estera UE".
            </div>
          </div>
        )}

        {/* ── TAB IVA ESTERA ── */}
        {activeTab==="estera" && (
          <div>
            <div style={{ background:"#fffde7",border:"1.5px solid #ffe082",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#b8860b" }}>
              Procedura annuale (Dir. 2008/9/CE) · Scadenza: <strong>30/09 anno successivo</strong> · Soglia: <strong>€{IVA_ESTERA_SOGLIA_ANNUA} annuo</strong> · <strong>€{IVA_ESTERA_SOGLIA_TRIM} trimestre</strong>
            </div>
            {/* Totale annuo */}
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 18px",borderRadius:10,marginBottom:16,background:totAnnuo.tot>=IVA_ESTERA_SOGLIA_ANNUA?"#e8f5e9":"#fffde7",border:`1.5px solid ${totAnnuo.tot>=IVA_ESTERA_SOGLIA_ANNUA?"#a5d6a7":"#ffe082"}` }}>
              <div>
                <div style={{ fontSize:10,fontWeight:700,color:"#999",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:2 }}>Totale recuperabile {anno}</div>
                <div style={{ fontSize:28,fontWeight:900,color:totAnnuo.tot>=IVA_ESTERA_SOGLIA_ANNUA?"#28a745":"#b8860b" }}>{fmt(totAnnuo.tot)}</div>
                {totAnnuo.tot>0 && (
                  <div style={{ display:"flex",flexWrap:"wrap",gap:4,marginTop:6 }}>
                    {PAESI.filter(p=>totAnnuo[p]>0).map(p=>(
                      <span key={p} style={{ display:"inline-flex",alignItems:"center",gap:3,background:"white",border:"1px solid #e0e0e0",borderRadius:20,padding:"2px 8px",fontSize:11,fontWeight:700 }}>
                        {IVA_FLAGS[p]} {fmt(totAnnuo[p])}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ textAlign:"right" }}>
                {totAnnuo.tot>=IVA_ESTERA_SOGLIA_ANNUA
                  ?<div style={{ fontSize:11,color:"#28a745",fontWeight:700 }}>✓ Soglia annua superata<br/>Aprire pratica Hacienda</div>
                  :<div style={{ fontSize:11,color:"#b8860b" }}>⚠ Sotto soglia €{IVA_ESTERA_SOGLIA_ANNUA}<br/>Valutare se conviene</div>}
                <div style={{ fontSize:10,color:"#bbb",marginTop:4 }}>Scad.: 30/09/{parseInt(anno)+1}</div>
                <div style={{ marginTop:8 }}><IvaEsteraExportBtn exportIvaEsteraCSV={exportIvaEsteraCSV} ejercicio={ejercicio} /></div>
              </div>
            </div>
            {/* Griglia trimestri */}
            <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16 }}>
              {trimEstera.map(t=>{
                const d=ivaByTrim[t.id]; const okTrim=d.tot>IVA_ESTERA_SOGLIA_TRIM;
                return (
                  <div key={t.id} style={{ background:d.tot>0?"#fffde7":"#FAFAFA",border:`1.5px solid ${d.tot>0?"#ffe082":"#E0E0E0"}`,borderRadius:8,padding:"10px 12px",textAlign:"center" }}>
                    <div style={{ fontSize:12,fontWeight:800,color:"#1A1A1A",marginBottom:4 }}>{t.id}</div>
                    <div style={{ fontWeight:800,fontSize:16,color:d.tot>0?"#b8860b":"#bbb" }}>{fmt(d.tot)}</div>
                    <div style={{ fontSize:9,color:"#bbb",marginTop:2 }}>scad. {t.scad}</div>
                    {d.tot>0 && (
                      <div style={{ display:"flex",flexWrap:"wrap",gap:3,marginTop:5,justifyContent:"center" }}>
                        {PAESI.filter(p=>d[p]>0).map(p=>(
                          <span key={p} style={{ fontSize:10,background:"white",border:"1px solid #e0e0e0",borderRadius:20,padding:"1px 6px",fontWeight:600 }}>{IVA_FLAGS[p]} {fmt(d[p])}</span>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop:5,fontSize:9,fontWeight:700,color:d.tot>0?(okTrim?"#2e7d32":"#E30613"):"#bbb" }}>
                      {d.tot>0?(okTrim?"✓ >€50":"✗ <€50"):"—"}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Dettaglio fatture estere */}
            {fatEstera.length>0 && (
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:10 }}>Fatture con IVA estera ({fatEstera.length})</div>
                <div style={{ maxHeight:200,overflowY:"auto" }}>
                  <table>
                    <thead><tr><th>N°</th><th>Fecha</th><th>Proveedor</th><th>Paese</th><th style={{ textAlign:"right" }}>Base</th><th style={{ textAlign:"right" }}>IVA rec.</th><th>Stato</th></tr></thead>
                    <tbody>{fatEstera.map(inv=>(
                      <tr key={inv.id}>
                        <td style={{ fontSize:11,color:"#E30613",fontWeight:700 }}>{inv.number||"—"}</td>
                        <td style={{ fontSize:11,color:"#999" }}>{fmtDate(inv.fechaOperacion||inv.date)}</td>
                        <td style={{ fontSize:11,maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{inv.supplier||"—"}</td>
                        <td style={{ fontSize:12 }}>{IVA_FLAGS[inv.paisIvaOrigen]||inv.paisIvaOrigen}</td>
                        <td style={{ textAlign:"right",fontSize:11 }}>{fmt(inv.ivaEsteraBase)}</td>
                        <td style={{ textAlign:"right",fontWeight:700,color:"#b8860b",fontSize:11 }}>{fmt(inv.ivaEsteraAmount)}</td>
                        <td><span className={`badge ${inv.status==="riconciliata"?"badge-blue":inv.status==="pagata"?"badge-green":"badge-yellow"}`}>{inv.status}</span></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            )}
            {/* Info procedura */}
            {[
              {paese:"🇮🇹 Italia",codice:"IT",aliquota:IVA_RATES.IT,note:"Pedaggi autostradali Italia via Euro Service GmbH. Targa GR516KN.",procedura:"Portale VIES + modulo Agenzia Entrate. Documenti: fatture IT + estratto conto + delega."},
              {paese:"🇫🇷 Francia",codice:"FR",aliquota:IVA_RATES.FR,note:"Pedaggi DKV incluso Tunnel Frejus.",procedura:"Portale VIES + impots.gouv.fr. Documenti: fatture FR + estratto conto."},
            ].map(p=>(
              <div key={p.codice} style={{ border:"1.5px solid #E0E0E0",borderRadius:10,padding:"14px",marginBottom:12 }}>
                <div style={{ display:"flex",justifyContent:"space-between",marginBottom:8 }}>
                  <div style={{ fontWeight:800,fontSize:14 }}>{p.paese}</div>
                  <span style={{ fontSize:10,color:"#999" }}>Dir. 2008/9/CE</span>
                </div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10 }}>
                  <div style={{ background:"#FAFAFA",borderRadius:6,padding:"6px 10px" }}>
                    <div style={{ fontSize:10,color:"#bbb",fontWeight:700 }}>ALIQUOTA</div>
                    <div style={{ fontWeight:800,fontSize:16 }}>{(p.aliquota*100).toFixed(0)}%</div>
                  </div>
                  <div style={{ background:"#FAFAFA",borderRadius:6,padding:"6px 10px" }}>
                    <div style={{ fontSize:10,color:"#bbb",fontWeight:700 }}>SOGLIA TRIM.</div>
                    <div style={{ fontWeight:800,fontSize:16,color:"#28a745" }}>€{IVA_ESTERA_SOGLIA_TRIM}</div>
                  </div>
                </div>
                <div style={{ fontSize:11,color:"#666",marginBottom:6,lineHeight:1.5 }}><strong>Note:</strong> {p.note}</div>
                <div style={{ fontSize:11,color:"#3949ab",background:"#f0f4ff",borderRadius:6,padding:"7px 10px",lineHeight:1.5 }}><strong>Procedura:</strong> {p.procedura}</div>
              </div>
            ))}
          </div>
        )}

        <button className="btn-ghost" style={{ width:"100%",marginTop:16 }} onClick={onClose}>Cerrar</button>
      </div>
    </div>
  );
}


function IbkrTab({ data, setIbkrModal, deleteIbkr, ibkrLive, onRefresh }) {
  const [nextRefresh, setNextRefresh] = React.useState(15 * 60);
  React.useEffect(() => {
    setNextRefresh(15 * 60);
    const tick = setInterval(() => setNextRefresh(s => s <= 1 ? 15 * 60 : s - 1), 1000);
    return () => clearInterval(tick);
  }, [ibkrLive]);
  const mm = String(Math.floor(nextRefresh / 60)).padStart(2,"0");
  const ss = String(nextRefresh % 60).padStart(2,"0");
  const positions = data.ibkrPositions || [];
  // Prezzi dal JSON aggiornato dalla GitHub Action
  const ibkrPrices = {};
  (data.ibkrPositions||[]).forEach(p => {
    if (!ibkrPrices[p.ticker]) ibkrPrices[p.ticker] = ibkrLive?.[p.ticker]?.price || 0;
  });
  const byTicker = {};
  positions.forEach(p => {
    if (!byTicker[p.ticker]) byTicker[p.ticker] = { ticker:p.ticker, shares:0, totalInvested:0 };
    const shares = parseFloat(p.shares)||0, total = parseFloat(p.totalEur)||0;
    if (p.type==="acquisto") { byTicker[p.ticker].shares+=shares; byTicker[p.ticker].totalInvested+=total; }
    else { byTicker[p.ticker].shares-=shares; byTicker[p.ticker].totalInvested-=total; }
  });
  const tickers = Object.values(byTicker).filter(t=>t.shares>0.0001);
  const totalInvested = tickers.reduce((s,t)=>s+t.totalInvested,0);
  const totalCurrentValue = tickers.reduce((s,t)=>s+t.shares*(ibkrPrices[t.ticker]||0),0);
  const hasPrices = tickers.some(t=>ibkrPrices[t.ticker]>0);
  const totalPL = hasPrices ? totalCurrentValue - totalInvested : null;
  const totalPLperc = totalInvested>0 && totalPL!==null ? totalPL/totalInvested*100 : null;

  const pacByMonth = {};
  positions.filter(p=>p.type==="acquisto"&&p.date).forEach(p => { const m=p.date.slice(0,7); if(!pacByMonth[m]) pacByMonth[m]=0; pacByMonth[m]+=parseFloat(p.totalEur)||0; });
  const pacChart = Object.entries(pacByMonth).sort().map(([m,v])=>({ month:m.slice(5)+"/"+m.slice(2,4), investito:parseFloat(v.toFixed(2)), target:getPacAmount(m+"-15") }));

  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
        <div>
          <div className="section-title">IBKR SL — Portfolio Iber-Silos SLU</div>
          {ibkrLive?._updated
            ? <div style={{ fontSize:10,color:"#28a745",marginTop:2 }}>✓ Prezzi aggiornati: {new Date(ibkrLive._updated).toLocaleString("it-IT",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})} · prossimo refresh {mm}:{ss}</div>
            : <div style={{ fontSize:10,color:"#bbb",marginTop:2 }}>Prezzi manuali — aggiornamento automatico 18:30 lun-ven</div>}
          <button onClick={onRefresh} style={{ marginTop:4, fontSize:10, background:"none", border:"1px solid #ddd", borderRadius:4, padding:"2px 8px", cursor:"pointer", color:"#555" }}>↻ Refresh ora</button>
        </div>
        <button className="btn-ghost" style={{ fontSize:12 }} onClick={() => {
          const rows = [["Data","Tipo","Ticker","Shares","Prezzo (€)","Commissioni (€)","Totale (€)","Note"]];
          [...positions].sort((a,b)=>(a.date||"").localeCompare(b.date||"")).forEach(p => {
            rows.push([p.date, p.type==="acquisto"?"Acquisto":"Vendita", p.ticker,
              parseFloat(p.shares||0).toFixed(4), parseFloat(p.priceEur||0).toFixed(2),
              parseFloat(p.fees||0).toFixed(2), parseFloat(p.totalEur||0).toFixed(2), p.notes||""]);
          });
          const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(";")).join("\n");
          const blob = new Blob(["﻿"+csv], { type:"text/csv;charset=utf-8;" });
          const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
          a.download = `IBKR_diario_trading_${today()}.csv`; a.click();
        }}>↓ Export CSV</button>
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:20 }}>
        <div className="kpi-card"><div className="kpi-label">Totale investito</div><div className="kpi-value" style={{ color:"#E30613" }}>{fmt(totalInvested)}</div></div>
        <div className="kpi-card blue"><div className="kpi-label">Valore corrente</div><div className="kpi-value" style={{ color:"#3949ab" }}>{hasPrices ? fmt(totalCurrentValue) : "—"}</div></div>
        <div className="kpi-card" style={{ background:totalPL===null?"#FAFAFA":totalPL>=0?"#f0fff4":"#fff5f5" }}>
          <div className="kpi-label">P/L non realizzato</div>
          <div className="kpi-value" style={{ color:totalPL===null?"#bbb":totalPL>=0?"#28a745":"#E30613" }}>
            {totalPL===null ? "—" : `${totalPL>=0?"+":""}${fmt(totalPL)}`}
          </div>
          {totalPLperc!==null && <div style={{ fontSize:11,color:totalPL>=0?"#28a745":"#E30613",marginTop:2 }}>{totalPL>=0?"+":""}{totalPLperc.toFixed(2)}%</div>}
        </div>
      </div>
      <div className="card" style={{ marginBottom:16 }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
          <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb" }}>Posiciones abiertas</div>
          <div style={{ fontSize:10,color:"#bbb" }}>Aggiornamento automatico ore 18:30 lun-ven</div>
        </div>
        {tickers.length===0 ? <div style={{ color:"#bbb",fontSize:13 }}>Sin posiciones.</div> :
          <table><thead><tr>
            <th>Ticker</th>
            <th style={{ textAlign:"right" }}>Shares</th>
            <th style={{ textAlign:"right" }}>PMC</th>
            <th style={{ textAlign:"right" }}>Prezzo att. (€)</th>
            <th style={{ textAlign:"right" }}>Var. giorno</th>
            <th style={{ textAlign:"right" }}>Valore att.</th>
            <th style={{ textAlign:"right" }}>P/L €</th>
            <th style={{ textAlign:"right" }}>P/L %</th>
            <th style={{ textAlign:"right" }}>% portafoglio</th>
          </tr></thead>
          <tbody>{tickers.map(t => {
            const pmc = t.shares>0 ? t.totalInvested/t.shares : 0;
            const perc = totalInvested>0 ? t.totalInvested/totalInvested*100 : 0;
            const currentPrice = ibkrPrices[t.ticker] || 0;
            const currentValue = currentPrice ? t.shares * currentPrice : null;
            const pl = currentValue !== null ? currentValue - t.totalInvested : null;
            const plPerc = pl !== null && t.totalInvested > 0 ? pl/t.totalInvested*100 : null;
            return (
              <tr key={t.ticker}>
                <td style={{ fontWeight:800,color:"#E30613",fontSize:15 }}>{t.ticker}</td>
                <td style={{ textAlign:"right" }}>{t.shares.toFixed(4)}</td>
                <td style={{ textAlign:"right",color:"#999" }}>{fmt(pmc)}</td>
                <td style={{ textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,fontSize:13 }}>
                  {currentPrice ? fmt(currentPrice) : <span style={{color:"#bbb"}}>—</span>}
                </td>
                <td style={{ textAlign:"right",fontSize:12 }}>
                  {(() => { const c = ibkrLive?.[t.ticker]?.change_pct; if (c==null) return <span style={{color:"#bbb"}}>—</span>;
                    return <span style={{color:c>=0?"#28a745":"#E30613",fontWeight:700}}>{c>=0?"+":""}{c.toFixed(2)}%</span>; })()}
                </td>
                <td style={{ textAlign:"right",fontWeight:600 }}>{currentValue ? fmt(currentValue) : <span style={{ color:"#bbb" }}>—</span>}</td>
                <td style={{ textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,color:pl===null?"#bbb":pl>=0?"#28a745":"#E30613" }}>
                  {pl===null ? "—" : `${pl>=0?"+":""}${fmt(pl)}`}
                </td>
                <td style={{ textAlign:"right",fontSize:12,color:plPerc===null?"#bbb":plPerc>=0?"#28a745":"#E30613" }}>
                  {plPerc===null ? "—" : `${plPerc>=0?"+":""}${plPerc.toFixed(2)}%`}
                </td>
                <td style={{ textAlign:"right" }}>
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"flex-end",gap:8 }}>
                    <div style={{ width:60,height:4,background:"#F5F5F5",borderRadius:2 }}><div style={{ width:`${Math.min(perc,100)}%`,height:"100%",background:"#E30613",borderRadius:2 }}/></div>
                    <span style={{ fontSize:11,color:"#999" }}>{perc.toFixed(1)}%</span>
                  </div>
                </td>
              </tr>
            );
          })}</tbody></table>
        }
      </div>
      {pacChart.length>0 && (
        <div className="card" style={{ marginBottom:16 }}>
          <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:12 }}>PAC mensile — investito vs target</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={pacChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F5F5F5" />
              <XAxis dataKey="month" tick={{ fontSize:10,fill:"#bbb" }} />
              <YAxis tick={{ fontSize:10,fill:"#bbb" }} tickFormatter={v=>`${v}€`} />
              <Tooltip contentStyle={{ background:"white",border:"1.5px solid #E0E0E0",borderRadius:8,fontSize:12 }} formatter={(v,n)=>[fmt(v),n==="investito"?"Invertido":"Objetivo"]} />
              <Bar dataKey="investito" fill="#E30613" radius={[4,4,0,0]} />
              <Bar dataKey="target" fill="#F5F5F5" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="card">
        <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:12 }}>Registro operaciones</div>
        {positions.length===0 ? <div style={{ color:"#bbb",fontSize:13 }}>Sin operaciones.</div> :
          <table><thead><tr><th>Fecha</th><th>Tipo</th><th>Ticker</th><th style={{ textAlign:"right" }}>Shares</th><th style={{ textAlign:"right" }}>Prezzo</th><th style={{ textAlign:"right" }}>Commissioni</th><th style={{ textAlign:"right" }}>Totale</th><th></th></tr></thead>
          <tbody>{[...positions].reverse().map((p)=>(
            <tr key={p.id}>
              <td>{fmtDate(p.date)}</td>
              <td><span className={`badge ${p.type==="acquisto"?"badge-green":"badge-red"}`}>{p.type}</span></td>
              <td style={{ fontWeight:800,color:"#E30613" }}>{p.ticker}</td>
              <td style={{ textAlign:"right" }}>{parseFloat(p.shares||0).toFixed(4)}</td>
              <td style={{ textAlign:"right" }}>{fmt(p.priceEur)}</td>
              <td style={{ textAlign:"right",color:"#999",fontSize:11 }}>{fmt(p.fees)}</td>
              <td style={{ textAlign:"right",fontWeight:600 }}>{fmt(p.totalEur)}</td>
              <td>
                <button className="btn-ghost" style={{ fontSize:11,padding:"4px 8px",marginRight:4 }} onClick={()=>setIbkrModal(p)}>✏️</button>
                <button className="btn-danger" onClick={()=>deleteIbkr(p.id)}>🗑</button>
              </td>
            </tr>
          ))}</tbody></table>
        }
      </div>
    </div>
  );
}

// ── CONTABILIDAD TAB ─────────────────────────────────────────────────────────
function ContabilidadTab({ data, persist, contabView, setContabView, mayorCuenta, setMayorCuenta, setAsientoModal, deleteAsiento, exportContabCSV }) {
  const asientos = data.asientos || [];
  const fixedAssets = data.fixedAssets || DEFAULT_ASSETS;
  const currentYear = new Date().getFullYear();
  const mayorSaldos = {};
  PGC_ACCOUNTS.forEach(a => { mayorSaldos[a.code]={ debe:0, haber:0, movs:[] }; });
  asientos.forEach(asi => (asi.lineas||[]).forEach(l => {
    if (!mayorSaldos[l.cuenta]) mayorSaldos[l.cuenta]={ debe:0, haber:0, movs:[] };
    mayorSaldos[l.cuenta].debe += parseFloat(l.debe)||0;
    mayorSaldos[l.cuenta].haber += parseFloat(l.haber)||0;
    mayorSaldos[l.cuenta].movs.push({ fecha:asi.fecha, concepto:asi.concepto, debe:parseFloat(l.debe)||0, haber:parseFloat(l.haber)||0, num:asi.numero });
  }));
  const cuentasUsadas = PGC_ACCOUNTS.filter(a=>(mayorSaldos[a.code]?.debe||0)+(mayorSaldos[a.code]?.haber||0)>0);
  const totalDebe = cuentasUsadas.reduce((s,a)=>s+(mayorSaldos[a.code]?.debe||0),0);
  const totalHaber = cuentasUsadas.reduce((s,a)=>s+(mayorSaldos[a.code]?.haber||0),0);
  const cuadra = Math.abs(totalDebe-totalHaber)<0.01;
  const amortRows = fixedAssets.map(asset => {
    const quotaYear = calcAmortYear(asset, currentYear);
    const accumulated = calcAmortAccumulated(asset, currentYear);
    return { ...asset, quotaYear, accumulated, netValue: asset.costEur-accumulated };
  });
  const mayorData = mayorSaldos[mayorCuenta]||{ debe:0, haber:0, movs:[] };
  // BUG-1 fix: saldo calcolato inline nel map

  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
        <div className="section-title">Contabilidad PGC — Iber-Silos SLU</div>
        <div style={{ display:"flex",gap:8 }}>
          <button className="btn-ghost" style={{ fontSize:11 }} onClick={exportContabCSV}>↓ Libro Diario CSV</button>
          <button className="btn-red" onClick={()=>setAsientoModal({ id:null,fecha:today(),numero:String((asientos.length+1)).padStart(4,"0"),concepto:"",lineas:[{cuenta:"",debe:"",haber:"",descripcion:""},{cuenta:"",debe:"",haber:"",descripcion:""}],notas:"" })}>+ Asiento</button>
        </div>
      </div>
      <div style={{ display:"flex",gap:6,marginBottom:20 }}>
        {[["diario","Libro Diario"],["mayor","Libro Mayor"],["comprobacion","Bal. Comprobación"],["amortizacion","Amortizaciones"]].map(([v,l])=>(
          <button key={v} className={`tab-btn ${contabView===v?"active":""}`} style={{ fontSize:11,padding:"6px 14px" }} onClick={()=>setContabView(v)}>{l}</button>
        ))}
      </div>

      {contabView==="diario" && (
        <div className="card">
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
            <span style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb" }}>{asientos.length} asientos</span>
            {asientos.length>0 && <span className={`badge ${cuadra?"badge-green":"badge-red"}`}>{cuadra?"✓ Cuadra":"✗ No cuadra"}</span>}
          </div>
          {asientos.length===0 ? <div style={{ color:"#bbb",fontSize:13 }}>Sin asientos.</div> :
            <div style={{ overflowX:"auto" }}>
              <table>
                <thead><tr><th>N°</th><th>Fecha</th><th>Concepto</th><th>Cuenta</th><th>Nombre</th><th style={{ textAlign:"right" }}>Debe</th><th style={{ textAlign:"right" }}>Haber</th><th></th></tr></thead>
                <tbody>{[...asientos].reverse().map(asi => {
                  const tD=asi.lineas.reduce((s,l)=>s+(parseFloat(l.debe)||0),0);
                  const tH=asi.lineas.reduce((s,l)=>s+(parseFloat(l.haber)||0),0);
                  const ok=Math.abs(tD-tH)<0.01;
                  return asi.lineas.map((l,li)=>(
                    <tr key={`${asi.id}-${li}`} style={{ borderBottom:li===asi.lineas.length-1?"2px solid #F5F5F5":"none" }}>
                      {li===0 && <td rowSpan={asi.lineas.length} style={{ verticalAlign:"top",fontWeight:700,color:"#E30613",paddingTop:12 }}>{asi.numero}</td>}
                      {li===0 && <td rowSpan={asi.lineas.length} style={{ verticalAlign:"top",whiteSpace:"nowrap",paddingTop:12,color:"#999" }}>{fmtDate(asi.fecha)}</td>}
                      {li===0 && <td rowSpan={asi.lineas.length} style={{ verticalAlign:"top",paddingTop:12,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:600 }}>{asi.concepto}</td>}
                      <td style={{ fontWeight:700,fontSize:13,color:l.debe?"#3949ab":"#b8860b" }}>{l.cuenta}</td>
                      <td style={{ fontSize:11,color:"#999",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{ACC_MAP[l.cuenta]?.name||l.descripcion||"—"}</td>
                      <td style={{ textAlign:"right",color:l.debe?"#28a745":"#F5F5F5",fontWeight:l.debe?600:400 }}>{l.debe?fmt(l.debe):""}</td>
                      <td style={{ textAlign:"right",color:l.haber?"#E30613":"#F5F5F5",fontWeight:l.haber?600:400 }}>{l.haber?fmt(l.haber):""}</td>
                      {li===0 && <td rowSpan={asi.lineas.length} style={{ verticalAlign:"top",paddingTop:10,whiteSpace:"nowrap" }}>
                        {!ok && <span className="badge badge-red" style={{ marginRight:4 }}>!</span>}
                        <button className="btn-ghost" style={{ fontSize:11,padding:"4px 8px",marginRight:4 }} onClick={()=>setAsientoModal(asi)}>✏️</button>
                        <button className="btn-danger" onClick={()=>deleteAsiento(asi.id)}>🗑</button>
                      </td>}
                    </tr>
                  ));
                })}</tbody>
              </table>
            </div>
          }
        </div>
      )}

      {contabView==="mayor" && (
        <div>
          <div style={{ marginBottom:16 }}>
            <select value={mayorCuenta} onChange={e=>setMayorCuenta(e.target.value)} style={{ maxWidth:400 }}>
              {PGC_ACCOUNTS.map(a=><option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div className="card">
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
              <div><div style={{ fontWeight:800,fontSize:15 }}>{mayorCuenta} — {ACC_MAP[mayorCuenta]?.name}</div><div style={{ fontSize:11,color:"#999",marginTop:3 }}>Tipo: {ACC_MAP[mayorCuenta]?.tipo} · Grupo {ACC_MAP[mayorCuenta]?.group}</div></div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:10,color:"#bbb",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.5px" }}>Saldo</div>
                <div style={{ fontWeight:800,fontSize:20,color:mayorData.debe>=mayorData.haber?"#3949ab":"#E30613" }}>{fmt(Math.abs(mayorData.debe-mayorData.haber))} <span style={{ fontSize:11,color:"#bbb" }}>{mayorData.debe>=mayorData.haber?"D":"H"}</span></div>
              </div>
            </div>
            {mayorData.movs.length===0 ? <div style={{ color:"#bbb",fontSize:13 }}>Sin movimiento.</div> :
              <table>
                <thead><tr><th>N°</th><th>Fecha</th><th>Concepto</th><th style={{ textAlign:"right" }}>Debe</th><th style={{ textAlign:"right" }}>Haber</th><th style={{ textAlign:"right" }}>Saldo progr.</th></tr></thead>
                <tbody>{(() => {
                  const movsOrd = [...mayorData.movs].sort((a,b)=>a.fecha.localeCompare(b.fecha));
                  let saldo = 0;
                  return movsOrd.map((m,i) => {
                    saldo += m.debe - m.haber;
                    return (
                      <tr key={i}>
                        <td style={{ color:"#E30613",fontWeight:700 }}>{m.num}</td>
                        <td style={{ color:"#999" }}>{fmtDate(m.fecha)}</td>
                        <td style={{ maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{m.concepto}</td>
                        <td style={{ textAlign:"right",color:m.debe?"#28a745":"#F5F5F5" }}>{m.debe?fmt(m.debe):""}</td>
                        <td style={{ textAlign:"right",color:m.haber?"#E30613":"#F5F5F5" }}>{m.haber?fmt(m.haber):""}</td>
                        <td style={{ textAlign:"right",fontWeight:600,color:saldo>=0?"#3949ab":"#E30613" }}>{fmt(Math.abs(saldo))} {saldo>=0?"D":"H"}</td>
                      </tr>
                    );
                  });
                })()}</tbody>
                <tfoot><tr>
                  <td colSpan={3} style={{ fontWeight:700,fontSize:11,color:"#999" }}>TOTALES</td>
                  <td style={{ textAlign:"right",fontWeight:700,color:"#28a745",borderTop:"2px solid #F5F5F5" }}>{fmt(mayorData.debe)}</td>
                  <td style={{ textAlign:"right",fontWeight:700,color:"#E30613",borderTop:"2px solid #F5F5F5" }}>{fmt(mayorData.haber)}</td>
                  <td style={{ borderTop:"2px solid #F5F5F5" }} />
                </tr></tfoot>
              </table>
            }
          </div>
        </div>
      )}

      {contabView==="comprobacion" && (
        <div className="card">
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
            <div style={{ fontWeight:800,fontSize:15 }}>Balance de Sumas y Saldos</div>
            <span className={`badge ${cuadra?"badge-green":"badge-red"}`}>{cuadra?"✓ CUADRA":"✗ NO CUADRA"}</span>
          </div>
          {cuentasUsadas.length===0 ? <div style={{ color:"#bbb",fontSize:13 }}>Registra asientos para ver el balance.</div> :
            <table>
              <thead><tr><th>Cuenta</th><th>Nombre</th><th style={{ textAlign:"right" }}>Sumas Debe</th><th style={{ textAlign:"right" }}>Sumas Haber</th><th style={{ textAlign:"right" }}>Saldo D</th><th style={{ textAlign:"right" }}>Saldo H</th></tr></thead>
              <tbody>{cuentasUsadas.map((a)=>{
                const d=mayorSaldos[a.code]?.debe||0, h=mayorSaldos[a.code]?.haber||0;
                const sd=d>h?d-h:0, sa=h>d?h-d:0;
                return (
                  <tr key={a.code}>
                    <td style={{ fontWeight:700,color:"#E30613" }}>{a.code}</td>
                    <td style={{ fontSize:12,color:"#999" }}>{a.name}</td>
                    <td style={{ textAlign:"right",color:"#28a745" }}>{fmt(d)}</td>
                    <td style={{ textAlign:"right",color:"#E30613" }}>{fmt(h)}</td>
                    <td style={{ textAlign:"right",fontWeight:sd>0?600:400,color:sd>0?"#1A1A1A":"#F5F5F5" }}>{sd>0?fmt(sd):""}</td>
                    <td style={{ textAlign:"right",fontWeight:sa>0?600:400,color:sa>0?"#1A1A1A":"#F5F5F5" }}>{sa>0?fmt(sa):""}</td>
                  </tr>
                );
              })}</tbody>
              <tfoot><tr style={{ background:"#F5F5F5" }}>
                <td colSpan={2} style={{ fontWeight:700 }}>TOTALES</td>
                <td style={{ textAlign:"right",fontWeight:700,color:"#28a745",borderTop:"2px solid #E0E0E0" }}>{fmt(totalDebe)}</td>
                <td style={{ textAlign:"right",fontWeight:700,color:"#E30613",borderTop:"2px solid #E0E0E0" }}>{fmt(totalHaber)}</td>
                <td colSpan={2} style={{ borderTop:"2px solid #E0E0E0" }} />
              </tr></tfoot>
            </table>
          }
        </div>
      )}

      {contabView==="amortizacion" && (
        <div>
          <div style={{ background:"#fff8e1",border:"1.5px solid #ffe082",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#b8860b" }}>
            ⚠️ <strong>Date placeholder</strong> — 20/01/2025. Aggiorna con export ContaSimple. Aliquota AEAT maquinaria: <strong>12% lineare</strong>.
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:20 }}>
            {amortRows.map(a=>(
              <div key={a.id} className="kpi-card yellow">
                <div style={{ display:"flex",justifyContent:"space-between" }}>
                  <div><div className="kpi-label">{a.name} — Conto 224</div></div>
                  <button className="btn-ghost" style={{ fontSize:10,padding:"3px 8px" }} onClick={()=>{ const nd=prompt("Data acquisto (YYYY-MM-DD):",a.dateAcq); if(nd){ const fa=(data.fixedAssets||DEFAULT_ASSETS).map(x=>x.id===a.id?{...x,dateAcq:nd}:x); persist({...data,fixedAssets:fa}); } }}>📅 data</button>
                </div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:10 }}>
                  <div><div style={{ fontSize:10,color:"#bbb" }}>Costo storico</div><div style={{ fontWeight:700 }}>{fmt(a.costEur)}</div></div>
                  <div><div style={{ fontSize:10,color:"#bbb" }}>Quota {currentYear}</div><div style={{ fontWeight:700,color:"#b8860b" }}>{fmt(a.quotaYear)}</div></div>
                  <div><div style={{ fontSize:10,color:"#bbb" }}>Ammort. accum.</div><div style={{ fontWeight:700,color:"#E30613" }}>{fmt(a.accumulated)}</div></div>
                  <div><div style={{ fontSize:10,color:"#bbb" }}>Valore netto</div><div style={{ fontWeight:700,color:"#28a745" }}>{fmt(a.netValue)}</div></div>
                </div>
                <div style={{ marginTop:10,background:"#F5F5F5",borderRadius:4,height:5,overflow:"hidden" }}>
                  <div style={{ height:"100%",background:"linear-gradient(90deg,#E30613,#F5C800)",width:`${Math.min(a.accumulated/a.costEur*100,100)}%`,borderRadius:4 }} />
                </div>
                <div style={{ fontSize:10,color:"#bbb",marginTop:3,textAlign:"right" }}>{(a.accumulated/a.costEur*100).toFixed(1)}% ammortizzato</div>
              </div>
            ))}
          </div>
          <div className="card">
            <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:12 }}>Piano di ammortamento completo</div>
            <table>
              <thead><tr><th>Anno</th>{amortRows.map(a=><th key={a.id} style={{ textAlign:"right" }}>{a.name}</th>)}<th style={{ textAlign:"right" }}>Totale 681</th><th style={{ textAlign:"right" }}>Valore netto 224</th></tr></thead>
              <tbody>{Array.from({length:10},(_,i)=>currentYear-1+i).map(yr=>{
                const quotas = amortRows.map(a=>calcAmortYear(a,yr));
                const totQ = quotas.reduce((s,v)=>s+v,0);
                const totNet = amortRows.reduce((s,a)=>s+Math.max(0,a.costEur-calcAmortAccumulated(a,yr)),0);
                const isCurrent = yr===currentYear;
                return (
                  <tr key={yr} style={{ background:isCurrent?"#FFF5F5":"transparent" }}>
                    <td style={{ fontWeight:isCurrent?700:400,color:isCurrent?"#E30613":"inherit" }}>{yr}{isCurrent?" ◀":""}</td>
                    {quotas.map((q,i)=><td key={i} style={{ textAlign:"right",color:q>0?"#1A1A1A":"#bbb" }}>{q>0?fmt(q):"—"}</td>)}
                    <td style={{ textAlign:"right",fontWeight:600,color:"#b8860b" }}>{totQ>0?fmt(totQ):"—"}</td>
                    <td style={{ textAlign:"right",color:"#28a745" }}>{fmt(totNet)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── SUB-COMPONENTS ────────────────────────────────────────────────────────────
function KpiPill({ label, value, color }) {
  return (
    <div style={{ textAlign:"center" }}>
      <div style={{ fontSize:18,fontWeight:800,color,lineHeight:1 }}>{value}</div>
      <div style={{ fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"1px",color:"#bbb",marginTop:2 }}>{label}</div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = { aperta:"badge-yellow", pagata:"badge-green", riconciliata:"badge-blue", scaduta:"badge-red", annullata:"badge-gray" };
  return <span className={`badge ${map[status]||"badge-gray"}`}>{status}</span>;
}

function InvoiceTable({ invoices, onEdit, onDelete }) {
  const [filter, setFilter] = useState("tutte");
  const filtered = filter==="tutte" ? invoices : invoices.filter(i=>i.type===filter);
  return (
    <div className="card">
      <div style={{ display:"flex",gap:6,marginBottom:16,alignItems:"center" }}>
        {["tutte","emessa","ricevuta"].map(f=>(
          <button key={f} className={`tab-btn ${filter===f?"active":""}`} style={{ fontSize:11,padding:"6px 14px" }} onClick={()=>setFilter(f)}>{f}</button>
        ))}
        <span style={{ marginLeft:"auto",color:"#bbb",fontSize:11,fontWeight:600 }}>{filtered.length} fatture</span>
      </div>
      {filtered.length===0 ? <div style={{ color:"#bbb",fontSize:13 }}>Sin facturas.</div> :
        <div style={{ overflowX:"auto", width:"100%" }}>
          <table style={{ tableLayout:"fixed", width:"100%", minWidth:680 }}>
            <colgroup>
              <col style={{ width:100 }}/>  {/* N° */}
              <col style={{ width:76 }}/>  {/* Fecha */}
              <col style={{ width:76 }}/>  {/* Venc. */}
              <col style={{ width:72 }}/>  {/* Tipo */}
              <col style={{ width:"20%" }}/> {/* Contraparte */}
              <col style={{ width:100 }}/>  {/* Base */}
              <col style={{ width:"16%" }}/> {/* IVA */}
              <col style={{ width:100 }}/>  {/* Total */}
              <col style={{ width:90 }}/>  {/* Stato */}
              <col style={{ width:72 }}/>  {/* Azioni */}
            </colgroup>
            <thead><tr>
              <th>N°</th><th>Fecha</th><th>Venc.</th><th>Tipo</th>
              <th>Contraparte</th>
              <th style={{ textAlign:"right" }}>Base imp.</th>
              <th>IVA</th>
              <th style={{ textAlign:"right" }}>Total</th>
              <th>Stato</th><th></th>
            </tr></thead>
            <tbody>{[...filtered].reverse().map(inv=>{
              const needsIvaClassification =
                inv.type === "ricevuta" &&
                (parseFloat(inv.ivaAmount) > 0) &&
                (!inv.paisIvaOrigen || inv.paisIvaOrigen === "ES") &&
                !(inv.supplier||"").match(/La Clau|Gestrams|Poligon|Brochette|Ruta|Reconquista|Vegallana|Lacamart|Doyouspain/i);
              const ivaEsteraIncomplete =
                inv.type === "ricevuta" &&
                inv.paisIvaOrigen && inv.paisIvaOrigen !== "ES" &&
                (parseFloat(inv.ivaEsteraBase) || 0) > 0 &&
                !(parseFloat(inv.ivaEsteraAmount) > 0);
              const ivaEsteraOk =
                inv.type === "ricevuta" &&
                inv.paisIvaOrigen && inv.paisIvaOrigen !== "ES" &&
                (parseFloat(inv.ivaEsteraAmount) || 0) > 0;
              const rowBg = needsIvaClassification ? "#fffde7" : ivaEsteraIncomplete ? "#fff3e0" : undefined;
              return (
              <tr key={inv.id} style={{ background: rowBg }}>
                <td style={{ color:"#E30613",fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                  {inv.number||"—"}
                  {needsIvaClassification && <span title="IVA estera da classificare" style={{ marginLeft:4,fontSize:11,cursor:"help" }}>⚠️</span>}
                </td>
                <td style={{ whiteSpace:"nowrap",color:"#999",fontSize:12 }}>{fmtDate(inv.date)}</td>
                <td style={{ whiteSpace:"nowrap",fontSize:12,color:inv.dueDate<new Date().toISOString().split("T")[0]&&inv.status==="aperta"?"#E30613":"#999" }}>{fmtDate(inv.dueDate)}</td>
                <td><span className={`badge ${inv.type==="emessa"?"badge-green":"badge-yellow"}`}>{inv.type}</span></td>
                <td style={{ overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:600,fontSize:12 }}>{inv.type==="emessa"?inv.client:inv.supplier}</td>
                <td style={{ textAlign:"right",fontWeight:600,fontFamily:"'IBM Plex Mono',monospace",fontSize:12 }}>{fmt(inv.netAmount)}</td>
                <td style={{ fontSize:11,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                  <span style={{ color:"#bbb" }}>{inv.ivaType}</span>
                  {ivaEsteraOk && (
                    <span title={`IVA ${inv.paisIvaOrigen} recuperabile: ${fmt(inv.ivaEsteraAmount)}`} style={{ marginLeft:4,fontWeight:700,color:"#b8860b",cursor:"help" }}>
                      {IVA_FLAGS[inv.paisIvaOrigen]} {fmt(inv.ivaEsteraAmount)}
                    </span>
                  )}
                  {ivaEsteraIncomplete && (
                    <span title="IVA estera: base inserita ma importo recuperabile = 0. Apri e correggi." style={{ marginLeft:4,color:"#E30613",fontWeight:700,cursor:"help" }}>
                      {IVA_FLAGS[inv.paisIvaOrigen]||"🌍"} ⚠ importo mancante
                    </span>
                  )}
                  {needsIvaClassification && !ivaEsteraOk && (
                    <span style={{ marginLeft:4,color:"#b8860b",fontSize:10 }}>classifica paese</span>
                  )}
                </td>
                <td style={{ textAlign:"right",fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",fontSize:12 }}>{fmt(inv.grossAmount)}</td>
                <td><StatusBadge status={inv.status}/></td>
                <td style={{ whiteSpace:"nowrap" }}>
                  <button className="btn-ghost" style={{ fontSize:11,marginRight:4,padding:"4px 8px" }} onClick={()=>onEdit(inv)}>✏️</button>
                  <button className="btn-danger" onClick={()=>onDelete(inv.id)}>🗑</button>
                </td>
              </tr>
              );
            })}</tbody>
          </table>
        </div>
      }
    </div>
  );
}

function MovementTable({ movements, invoices, onEdit, onDelete, onReconcile }) {
  const invMap = {};
  invoices.forEach(i=>{ invMap[i.id]=i; });
  return (
    <div className="card">
      <span style={{ color:"#bbb",fontSize:11,fontWeight:600,display:"block",marginBottom:12 }}>{movements.length} movimientos · {movements.filter(m=>m.reconciled).length} conciliados</span>
      {movements.length===0 ? <div style={{ color:"#bbb",fontSize:13 }}>Sin movimientos.</div> :
        <div style={{ overflowX:"auto" }}>
          <table>
            <thead><tr><th>Fecha</th><th>Descripción</th><th>Importe</th><th>Cuenta</th><th>Factura asociada</th><th>Stato</th><th></th></tr></thead>
            <tbody>{[...movements].reverse().map(m=>{
              const linked = m.invoiceId ? invMap[m.invoiceId] : null;
              return (
                <tr key={m.id}>
                  <td style={{ whiteSpace:"nowrap",color:"#999" }}>{fmtDate(m.date)}</td>
                  <td style={{ maxWidth:240,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{m.description}</td>
                  <td style={{ color:m.type==="entrata"?"#28a745":"#E30613",fontWeight:700,whiteSpace:"nowrap" }}>{m.type==="entrata"?"+":"-"}{fmt(m.amount)}</td>
                  <td style={{ color:"#bbb",fontSize:11 }}>{m.account}</td>
                  <td style={{ fontSize:11 }}>{linked?<span style={{ color:"#3949ab",fontWeight:600 }}>{linked.number} — {linked.type==="emessa"?linked.client:linked.supplier}</span>:<span style={{ color:"#E0E0E0" }}>—</span>}</td>
                  <td>{m.reconciled?<span className="badge badge-green">asociado</span>:<span className="badge badge-gray">libre</span>}</td>
                  <td style={{ whiteSpace:"nowrap" }}>
                    {!m.reconciled && <button className="btn-ghost" style={{ fontSize:11,marginRight:4,padding:"4px 8px" }} onClick={()=>onReconcile(m)}>🔗</button>}
                    <button className="btn-ghost" style={{ fontSize:11,marginRight:4,padding:"4px 8px" }} onClick={()=>onEdit(m)}>✏️</button>
                    <button className="btn-danger" onClick={()=>onDelete(m.id)}>🗑</button>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      }
    </div>
  );
}

function InvoiceModal({ inv, onSave, onClose }) {
  const [form, setForm] = useState({ ...inv });

  const set = (k, v) => setForm(f => {
    const updated = { ...f, [k]: v };

    // Ricalcolo IVA ES (ordinaria, conto 472)
    if (k==="netAmount" || k==="ivaType") {
      const net  = parseFloat(k==="netAmount" ? v : f.netAmount) || 0;
      const ivaTypeKey = k==="ivaType" ? v : f.ivaType;
      const rate = (ivaTypeKey in IVA_TYPES) ? IVA_TYPES[ivaTypeKey] : 0.21;
      updated.ivaAmount   = parseFloat((net * rate).toFixed(2));
      updated.grossAmount = parseFloat((net + updated.ivaAmount).toFixed(2));
    }

    // Ricalcolo automatico IVA estera quando cambia base o paese
    if (k==="ivaEsteraBase" || k==="paisIvaOrigen") {
      const base    = parseFloat(k==="ivaEsteraBase" ? v : f.ivaEsteraBase) || 0;
      const paese   = k==="paisIvaOrigen" ? v : (f.paisIvaOrigen || "ES");
      const paeseInfo = PAESI_UE_IVA.find(p => p.code === paese);
      const rate    = paeseInfo ? paeseInfo.rate : 0;
      // Solo paesi esteri (non ES) generano IVA recuperabile con procedura UE
      updated.ivaEsteraRate   = paese !== "ES" ? rate : 0;
      updated.ivaEsteraAmount = paese !== "ES" ? parseFloat((base * rate).toFixed(2)) : 0;
    }

    // Se si cambia ivaEsteraRate manualmente, ricalcola l'amount
    if (k==="ivaEsteraRate") {
      const base = parseFloat(f.ivaEsteraBase) || 0;
      updated.ivaEsteraAmount = parseFloat((base * (parseFloat(v)||0)).toFixed(2));
    }
    // Se si cambia ivaEsteraAmount manualmente, ricalcola il rate
    if (k==="ivaEsteraAmount") {
      const base = parseFloat(f.ivaEsteraBase) || 0;
      updated.ivaEsteraRate = base > 0 ? parseFloat(((parseFloat(v)||0) / base).toFixed(4)) : 0;
    }

    return updated;
  });

  const isRicevuta = form.type === "ricevuta";
  const paeseInfo  = PAESI_UE_IVA.find(p => p.code === (form.paisIvaOrigen || "ES"));
  const hasIvaEstera = isRicevuta && form.paisIvaOrigen && form.paisIvaOrigen !== "ES" && (parseFloat(form.ivaEsteraAmount)||0) > 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
          <div className="modal-title">
            {form.id ? "Modifica fattura" : "Nuova fattura"} —{" "}
            <span style={{ color:form.type==="emessa"?"#28a745":"#b8860b" }}>{form.type}</span>
          </div>
          <button onClick={onClose} style={{ background:"none",fontSize:20,color:"#999" }}>×</button>
        </div>

        {/* Tipo fattura */}
        <div className="form-row"><div style={{ display:"flex",gap:8 }}>
          <button className={`tab-btn ${form.type==="emessa"?"active":""}`}   onClick={()=>set("type","emessa")}   style={{ flex:1 }}>Emessa</button>
          <button className={`tab-btn ${form.type==="ricevuta"?"active":""}`} onClick={()=>set("type","ricevuta")} style={{ flex:1 }}>Ricevuta</button>
        </div></div>

        {/* Numero + data */}
        <div className="form-row form-row-2">
          <div><label>N° Factura</label><input value={form.number||""} onChange={e=>set("number",e.target.value)} /></div>
          <div><label>Fecha</label><input type="date" value={form.date} onChange={e=>set("date",e.target.value)} /></div>
        </div>

        {/* Scadenza + stato */}
        <div className="form-row form-row-2">
          <div><label>Scadenza</label><input type="date" value={form.dueDate||""} onChange={e=>set("dueDate",e.target.value)} /></div>
          <div><label>Stato</label><select value={form.status} onChange={e=>set("status",e.target.value)}>{["aperta","pagata","riconciliata","annullata"].map(s=><option key={s}>{s}</option>)}</select></div>
        </div>

        {/* Cliente / Fornitore */}
        {form.type==="emessa"
          ? <div className="form-row"><label>Cliente</label><select value={form.client||""} onChange={e=>set("client",e.target.value)}><option value="">Seleziona...</option>{CLIENTS.map(c=><option key={c}>{c}</option>)}</select></div>
          : <div className="form-row"><label>Proveedor</label><select value={form.supplier||""} onChange={e=>set("supplier",e.target.value)}><option value="">Seleziona...</option>{SUPPLIERS.map(s=><option key={s}>{s}</option>)}</select></div>
        }

        <div className="form-row"><label>Descripción</label><input value={form.description||""} onChange={e=>set("description",e.target.value)} /></div>

        {/* IVA ordinaria ES */}
        <div className="form-row form-row-2">
          <div><label>Base imponible (€)</label><input type="number" step="0.01" value={form.netAmount||""} onChange={e=>set("netAmount",e.target.value)} /></div>
          <div><label>Tipo IVA (ES)</label><select value={form.ivaType||"21%"} onChange={e=>set("ivaType",e.target.value)}>{Object.keys(IVA_TYPES).map(k=><option key={k}>{k}</option>)}</select></div>
        </div>
        <div className="form-row form-row-2">
          <div><label>IVA ES (€)</label><input readOnly value={form.ivaAmount||0} style={{ color:"#bbb" }} /></div>
          <div><label>Totale lordo (€)</label><input readOnly value={form.grossAmount||0} style={{ color:"#E30613",fontWeight:700 }} /></div>
        </div>

        {/* ── SEZIONE IVA ESTERA — solo su fatture ricevute ── */}
        {isRicevuta && (
          <div style={{ background:"#fffde7", border:"1.5px solid #ffe082", borderRadius:10, padding:"14px 16px", marginBottom:14, marginTop:4 }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:"1.5px", textTransform:"uppercase", color:"#b8860b", marginBottom:12, display:"flex", alignItems:"center", gap:6 }}>
              <span>💶</span> IVA Estera — Recupero Direttiva 2008/9/CE
            </div>

            {/* Paese origine IVA */}
            <div className="form-row form-row-2">
              <div>
                <label>Paese IVA origine</label>
                <select value={form.paisIvaOrigen||"ES"} onChange={e=>set("paisIvaOrigen",e.target.value)}>
                  {PAESI_UE_IVA.map(p=>(
                    <option key={p.code} value={p.code}>{p.flag} {p.label} ({(p.rate*100).toFixed(0)}%)</option>
                  ))}
                </select>
              </div>
              <div>
                <label>P.IVA / VAT estera fornitore</label>
                <input
                  value={form.vatForeignNumber||""}
                  onChange={e=>set("vatForeignNumber",e.target.value)}
                  placeholder={paeseInfo?.code==="IT"?"IT12345678901":"es. FR12345678901"}
                />
              </div>
            </div>

            {/* Base + aliquota + IVA estera */}
            <div className="form-row form-row-2">
              <div>
                <label>Base imponibile estera (€)</label>
                <input
                  type="number" step="0.01"
                  value={form.ivaEsteraBase||""}
                  onChange={e=>set("ivaEsteraBase",e.target.value)}
                  placeholder="Imponibile su cui è calcolata l'IVA estera"
                />
              </div>
              <div>
                <label>Aliquota applicata</label>
                <select value={form.ivaEsteraRate||0} onChange={e=>set("ivaEsteraRate", parseFloat(e.target.value))}>
                  <option value={0}>—</option>
                  {PAESI_UE_IVA.filter(p=>p.code!=="ES").map(p=>(
                    <option key={p.code} value={p.rate}>{p.flag} {(p.rate*100).toFixed(0)}% ({p.label})</option>
                  ))}
                  <option value={0.10}>10% (ridotta)</option>
                  <option value={0.05}>5% (super-ridotta)</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div>
                <label>IVA estera recuperabile (€)</label>
                <input
                  type="number" step="0.01"
                  value={form.ivaEsteraAmount||""}
                  onChange={e=>set("ivaEsteraAmount",e.target.value)}
                  style={{ fontWeight:700, color: hasIvaEstera ? "#b8860b" : "#1A1A1A", borderColor: hasIvaEstera ? "#ffe082" : "#E0E0E0" }}
                  placeholder="Calcolato automaticamente o inserisci manualmente"
                />
              </div>
            </div>

            {/* Badge stato recupero */}
            {form.paisIvaOrigen && form.paisIvaOrigen !== "ES" && (
              <div style={{ marginTop:8, fontSize:11, color:"#b8860b", display:"flex", alignItems:"center", gap:6 }}>
                {paeseInfo?.flag}
                {hasIvaEstera
                  ? <span>IVA recuperabile via <strong>Hacienda → portale UE</strong> · scadenza <strong>30/09 anno successivo</strong></span>
                  : <span style={{ color:"#bbb" }}>Inserisci base e aliquota per calcolare il recupero</span>
                }
              </div>
            )}
            {/* Warning IVA estera incompleta: base inserita ma importo = 0 */}
            {form.paisIvaOrigen && form.paisIvaOrigen !== "ES" &&
             (parseFloat(form.ivaEsteraBase)||0) > 0 &&
             !(parseFloat(form.ivaEsteraAmount) > 0) && (
              <div style={{ marginTop:8, background:"#ffebee", border:"1px solid #ef9a9a", borderRadius:6, padding:"8px 12px", fontSize:11, color:"#c62828", display:"flex", alignItems:"center", gap:6 }}>
                ⚠ <strong>IVA estera incompleta:</strong> base inserita (€{form.ivaEsteraBase}) ma importo recuperabile = 0. Seleziona l'aliquota o inserisci l'importo manualmente.
              </div>
            )}
            {form.paisIvaOrigen === "ES" && (
              <div style={{ fontSize:11, color:"#999", marginTop:4 }}>
                IVA spagnola → recupero ordinario via <strong>Modelo 303 / REDEME</strong>. Nessuna procedura UE necessaria.
              </div>
            )}
          </div>
        )}

        <div className="form-row"><label>Link documento</label><input value={form.dropboxLink||""} onChange={e=>set("dropboxLink",e.target.value)} placeholder="https://..." /></div>
        <div className="form-row"><label>Notas</label><textarea rows={2} value={form.notes||""} onChange={e=>set("notes",e.target.value)} /></div>
        <div style={{ display:"flex",gap:8,marginTop:8 }}>
          <button className="btn-red" style={{ flex:1 }} onClick={()=>onSave(form)}>Guardar</button>
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function MovModal({ mov, onSave, onClose }) {
  const [form, setForm] = useState({ ...mov });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
          <div className="modal-title">{form.id?"Editar movimiento":"Nuevo movimiento"}</div>
          <button onClick={onClose} style={{ background:"none",fontSize:20,color:"#999" }}>×</button>
        </div>
        <div className="form-row form-row-2">
          <div><label>Fecha</label><input type="date" value={form.date||""} onChange={e=>set("date",e.target.value)} /></div>
          <div><label>Cuenta</label><select value={form.account||"Revolut Business"} onChange={e=>set("account",e.target.value)}>{["Revolut Business","BBVA","Contanti"].map(a=><option key={a}>{a}</option>)}</select></div>
        </div>
        <div className="form-row"><label>Descripción</label><input value={form.description||""} onChange={e=>set("description",e.target.value)} /></div>
        <div className="form-row form-row-2">
          <div><label>Importo (€)</label><input type="number" step="0.01" value={form.amount||""} onChange={e=>set("amount",e.target.value)} /></div>
          <div><label>Tipo</label><select value={form.type||"entrata"} onChange={e=>set("type",e.target.value)}><option>entrata</option><option>uscita</option></select></div>
        </div>
        <div className="form-row"><label>Notas</label><textarea rows={2} value={form.notes||""} onChange={e=>set("notes",e.target.value)} /></div>
        <div style={{ display:"flex",gap:8,marginTop:8 }}>
          <button className="btn-red" style={{ flex:1 }} onClick={()=>onSave(form)}>Guardar</button>
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function IbkrForm({ pos, onSave, onClose }) {
  const [form, setForm] = useState({ ...pos });
  const set = (k,v) => setForm(f => {
    const updated={...f,[k]:v};
    const s=parseFloat(k==="shares"?v:f.shares)||0, p=parseFloat(k==="priceEur"?v:f.priceEur)||0, fe=parseFloat(k==="fees"?v:f.fees)||0;
    updated.totalEur=parseFloat((s*p+fe).toFixed(2));
    return updated;
  });
  return (
    <>
      <div className="form-row form-row-2">
        <div><label>Fecha</label><input type="date" value={form.date||""} onChange={e=>set("date",e.target.value)} /></div>
        <div><label>Tipo</label><select value={form.type||"acquisto"} onChange={e=>set("type",e.target.value)}><option value="acquisto">Acquisto</option><option value="vendita">Vendita</option></select></div>
      </div>
      <div className="form-row form-row-2">
        <div><label>Ticker ETF</label><select value={form.ticker||"VWCE"} onChange={e=>set("ticker",e.target.value)}>{IBKR_ETFS.map(t=><option key={t}>{t}</option>)}</select></div>
        <div><label>Shares</label><input type="number" step="0.0001" value={form.shares||""} onChange={e=>set("shares",e.target.value)} /></div>
      </div>
      <div className="form-row form-row-2">
        <div><label>Prezzo/share (€)</label><input type="number" step="0.01" value={form.priceEur||""} onChange={e=>set("priceEur",e.target.value)} /></div>
        <div><label>Commissioni (€)</label><input type="number" step="0.01" value={form.fees||""} onChange={e=>set("fees",e.target.value)} /></div>
      </div>
      <div className="form-row"><label>Totale (€)</label><input readOnly value={form.totalEur||0} style={{ color:"#E30613",fontWeight:700 }} /></div>
      <div className="form-row"><label>Notas</label><textarea rows={2} value={form.notes||""} onChange={e=>set("notes",e.target.value)} /></div>
      <div style={{ display:"flex",gap:8,marginTop:8 }}>
        <button className="btn-red" style={{ flex:1 }} onClick={()=>onSave(form)}>Guardar</button>
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
      </div>
    </>
  );
}

function AsientoModal({ asiento, onSave, onClose }) {
  const [form, setForm] = useState({ ...asiento, lineas: (asiento.lineas||[{cuenta:"",debe:"",haber:"",descripcion:""},{cuenta:"",debe:"",haber:"",descripcion:""}]).map(l=>({...l})) });
  const setField = (k,v) => setForm(f=>({...f,[k]:v}));
  const setLinea = (i,k,v) => setForm(f=>({ ...f, lineas: f.lineas.map((l,li)=>li===i?{...l,[k]:v}:l) }));
  const addLinea = () => setForm(f=>({...f,lineas:[...f.lineas,{cuenta:"",debe:"",haber:"",descripcion:""}]}));
  const removeLinea = (i) => setForm(f=>({...f,lineas:f.lineas.filter((_,li)=>li!==i)}));
  const totalDebe = form.lineas.reduce((s,l)=>s+(parseFloat(l.debe)||0),0);
  const totalHaber = form.lineas.reduce((s,l)=>s+(parseFloat(l.haber)||0),0);
  const cuadra = Math.abs(totalDebe-totalHaber)<0.01;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:700 }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
          <div style={{ display:"flex",alignItems:"center",gap:12 }}>
            <div className="modal-title">{form.id?"Editar asiento":"Nuevo asiento"}</div>
            <span className={`badge ${cuadra?"badge-green":"badge-red"}`}>{cuadra?"✓ Cuadra":`Diff: ${fmt(Math.abs(totalDebe-totalHaber))}`}</span>
          </div>
          <button onClick={onClose} style={{ background:"none",fontSize:20,color:"#999" }}>×</button>
        </div>
        <div className="form-row form-row-2" style={{ marginBottom:14 }}>
          <div><label>N° Asiento</label><input value={form.numero||""} onChange={e=>setField("numero",e.target.value)} /></div>
          <div><label>Fecha</label><input type="date" value={form.fecha||""} onChange={e=>setField("fecha",e.target.value)} /></div>
        </div>
        <div className="form-row" style={{ marginBottom:18 }}><label>Concepto</label><input value={form.concepto||""} onChange={e=>setField("concepto",e.target.value)} /></div>
        <div style={{ fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#bbb",marginBottom:8 }}>Partidas</div>
        <div style={{ background:"#FAFAFA",borderRadius:8,padding:12,marginBottom:14 }}>
          <div style={{ display:"grid",gridTemplateColumns:"110px 1fr 90px 90px 24px",gap:8,marginBottom:6 }}>
            <div style={{ fontSize:10,color:"#bbb",fontWeight:700 }}>Cuenta</div>
            <div style={{ fontSize:10,color:"#bbb",fontWeight:700 }}>Descripción</div>
            <div style={{ fontSize:10,color:"#28a745",fontWeight:700,textAlign:"right" }}>Debe</div>
            <div style={{ fontSize:10,color:"#E30613",fontWeight:700,textAlign:"right" }}>Haber</div>
            <div />
          </div>
          {form.lineas.map((l,i)=>(
            <div key={i} style={{ display:"grid",gridTemplateColumns:"110px 1fr 90px 90px 24px",gap:8,marginBottom:8,alignItems:"center" }}>
              <div>
                <select value={l.cuenta||""} onChange={e=>{ setLinea(i,"cuenta",e.target.value); if(!l.descripcion) setLinea(i,"descripcion",ACC_MAP[e.target.value]?.name||""); }} style={{ fontSize:12,padding:"6px 8px" }}>
                  <option value="">—</option>
                  {PGC_ACCOUNTS.map(a=><option key={a.code} value={a.code}>{a.code}</option>)}
                </select>
                {l.cuenta && <div style={{ fontSize:9,color:"#bbb",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{ACC_MAP[l.cuenta]?.name}</div>}
              </div>
              <input value={l.descripcion||""} onChange={e=>setLinea(i,"descripcion",e.target.value)} style={{ fontSize:12 }} />
              <input type="number" step="0.01" value={l.debe||""} onChange={e=>{ setLinea(i,"debe",e.target.value); if(e.target.value) setLinea(i,"haber",""); }} style={{ fontSize:12,textAlign:"right",borderColor:l.debe?"#a5d6a7":"#E0E0E0" }} />
              <input type="number" step="0.01" value={l.haber||""} onChange={e=>{ setLinea(i,"haber",e.target.value); if(e.target.value) setLinea(i,"debe",""); }} style={{ fontSize:12,textAlign:"right",borderColor:l.haber?"#ef9a9a":"#E0E0E0" }} />
              {form.lineas.length>2 ? <button onClick={()=>removeLinea(i)} style={{ background:"transparent",color:"#E30613",border:"none",cursor:"pointer",fontSize:16,padding:0 }}>×</button> : <div />}
            </div>
          ))}
          <button className="btn-ghost" style={{ fontSize:11,marginTop:4,width:"100%" }} onClick={addLinea}>+ Añadir línea</button>
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:18 }}>
          <div style={{ background:"#e8f5e9",border:"1.5px solid #a5d6a7",borderRadius:8,padding:"10px 14px",textAlign:"center" }}>
            <div style={{ fontSize:10,color:"#28a745",fontWeight:700 }}>DEBE</div>
            <div style={{ fontWeight:800,color:"#28a745",fontSize:16 }}>{fmt(totalDebe)}</div>
          </div>
          <div style={{ background:"#ffebee",border:"1.5px solid #ef9a9a",borderRadius:8,padding:"10px 14px",textAlign:"center" }}>
            <div style={{ fontSize:10,color:"#E30613",fontWeight:700 }}>HABER</div>
            <div style={{ fontWeight:800,color:"#E30613",fontSize:16 }}>{fmt(totalHaber)}</div>
          </div>
          <div style={{ background:cuadra?"#e8f5e9":"#ffebee",border:`1.5px solid ${cuadra?"#a5d6a7":"#ef9a9a"}`,borderRadius:8,padding:"10px 14px",textAlign:"center" }}>
            <div style={{ fontSize:10,color:cuadra?"#28a745":"#E30613",fontWeight:700 }}>DIFERENCIA</div>
            <div style={{ fontWeight:800,color:cuadra?"#28a745":"#E30613",fontSize:16 }}>{cuadra?"✓":fmt(Math.abs(totalDebe-totalHaber))}</div>
          </div>
        </div>
        <div className="form-row" style={{ marginBottom:16 }}><label>Notas</label><textarea rows={2} value={form.notas||""} onChange={e=>setField("notas",e.target.value)} /></div>
        <div style={{ display:"flex",gap:8 }}>
          <button className="btn-red" style={{ flex:1, opacity:cuadra?1:0.5 }} onClick={()=>onSave(form)} disabled={!cuadra}>{cuadra?"Registra asiento":"✗ Non cuadra"}</button>
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
