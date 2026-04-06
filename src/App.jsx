import { useState, useEffect, useCallback, useRef } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, onValue } from "firebase/database";

// ── FIREBASE CONFIG ────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDbLEYKeJw0667KPnMKLnwdALK_UB71XtM",
  authDomain: "ibersilos-c6053.firebaseapp.com",
  databaseURL: "https://ibersilos-c6053-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "ibersilos-c6053",
  storageBucket: "ibersilos-c6053.firebasestorage.app",
  messagingSenderId: "1073852027153",
  appId: "1:1073852027153:web:4a9421ddbb2b72143bbcb0"
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
const DATA_REF = "finance/AC001/data";

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const CLIENTS = ["Buzzatti", "Coder SA (Svizzera — art.21)", "Molino dalla Giovanna", "Altro"];
const SUPPLIERS = ["CCI Italia SRLS", "BMB Trasporti", "T-Way (renting)", "La Clau Assessors", "Gestrams", "Alma Bianca 2018 SL", "DKV", "E100", "MTO Logistics", "Truck Service Srl", "Altro"];
const IVA_TYPES = { "21%": 0.21, "10%": 0.10, "7%": 0.07, "RC (reverse charge)": 0, "Esente": 0, "0%": 0 };
const IBKR_ETFS = ["VWCE", "VUAA", "SEC0", "C50", "Altro"];
const STORAGE_KEY = "iber-silos-v2";

const fmt = (n) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("it-IT") : "—";
const today = () => new Date().toISOString().split("T")[0];
const addDays = (d, n) => { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().split("T")[0]; };
const getPacAmount = (ds) => { const d = new Date(ds); return (d.getFullYear() > 2026 || (d.getFullYear() === 2026 && d.getMonth() >= 6)) ? 500 : 300; };

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
  { id:"comp1", name:"Compresor 1", account:"224", costEur:4000, dateAcq:"2025-01-20", rateAnnual:0.12 },
  { id:"comp2", name:"Compresor 2", account:"224", costEur:3000, dateAcq:"2025-01-20", rateAnnual:0.12 },
];

function calcAmortYear(asset, year) {
  const acqDate = new Date(asset.dateAcq);
  const acqYear = acqDate.getFullYear();
  if (year < acqYear) return 0;
  const annualAmt = asset.costEur * asset.rateAnnual;
  if (year === acqYear) {
    const daysInYear = 365;
    const startDay = Math.floor((acqDate - new Date(acqYear, 0, 1)) / 86400000);
    return parseFloat(((annualAmt * (daysInYear - startDay)) / daysInYear).toFixed(2));
  }
  let totalPrev = 0;
  for (let y = acqYear; y < year; y++) totalPrev += calcAmortYear(asset, y);
  return Math.min(annualAmt, Math.max(0, asset.costEur - totalPrev));
}

function calcAmortAccumulated(asset, upToYear) {
  let total = 0;
  for (let y = new Date(asset.dateAcq).getFullYear(); y <= upToYear; y++) total += calcAmortYear(asset, y);
  return Math.min(total, asset.costEur);
}

// ── STORAGE — Firebase Realtime Database ──────────────────────────────────────
const toArray = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return Object.values(val);
};

async function loadData() {
  try {
    const snapshot = await get(ref(db, DATA_REF));
    if (snapshot.exists()) {
      const d = snapshot.val();
      d.invoices = toArray(d.invoices);
      d.movements = toArray(d.movements);
      d.ibkrPositions = toArray(d.ibkrPositions);
      d.asientos = toArray(d.asientos);
      d.fixedAssets = toArray(d.fixedAssets).length ? toArray(d.fixedAssets) : DEFAULT_ASSETS;
      return d;
    }
  } catch (e) { console.error("Firebase load error:", e); }
  return { invoices: [], movements: [], ibkrPositions: [], asientos: [], fixedAssets: DEFAULT_ASSETS };
}
async function saveData(data) {
  try {
    await set(ref(db, DATA_REF), data);
  } catch (e) { console.error("Firebase save error:", e); }
}

// ── RECONCILIATION ────────────────────────────────────────────────────────────
function autoReconcile(movements, invoices) {
  const updated = movements.map(m => ({ ...m }));
  updated.forEach(mov => {
    if (mov.reconciled || mov.invoiceId) return;
    const amt = Math.abs(parseFloat(mov.amount) || 0);
    const movDate = new Date(mov.date);
    const candidates = invoices.filter(inv => {
      if (mov.type === "entrata" && inv.type !== "emitida") return false;
      if (mov.type === "uscita" && inv.type !== "recibida") return false;
      if (inv.status === "riconciliata") return false;
      if (Math.abs((parseFloat(inv.grossAmount) || 0) - amt) > 0.05) return false;
      return Math.abs((new Date(inv.dueDate || inv.date) - movDate) / 86400000) <= 30;
    });
    if (candidates.length === 1) { mov.invoiceId = candidates[0].id; mov.reconciled = true; mov._autoMatch = true; }
  });
  return updated;
}

// ── FORECAST ──────────────────────────────────────────────────────────────────
function buildForecast(invoices, movements) {
  const baseDate = new Date();
  const lastBalance = movements.reduce((acc, m) => acc + (m.type === "entrata" ? 1 : -1) * (parseFloat(m.amount) || 0), 0);
  const events = [];
  invoices.forEach(inv => {
    if (inv.status === "riconciliata" || inv.status === "annullata") return;
    const due = new Date(inv.dueDate || addDays(inv.date, 30));
    const diff = Math.ceil((due - baseDate) / 86400000);
    if (diff < -5 || diff > 90) return;
    events.push({ day: Math.max(0, diff), amount: inv.type === "emessa" || inv.type === "emitida" ? (parseFloat(inv.grossAmount)||0) : -(parseFloat(inv.grossAmount)||0) });
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

// ── PARSE REVOLUT CSV ─────────────────────────────────────────────────────────
function parseRevolutCSV(text) {
  const lines = text.trim().split("\n");
  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.replace(/^"|"$/g, "").trim());
    if (cols.length < 5) continue;
    const amount = parseFloat(cols[3]);
    if (isNaN(amount)) continue;
    results.push({ id: `imp-${Date.now()}-${i}`, date: cols[0].split(" ")[0], description: cols[1], amount: Math.abs(amount), type: amount >= 0 ? "entrata" : "uscita", account: "Revolut Business", invoiceId: null, reconciled: false, notes: "" });
  }
  return results;
}

// ── DSP LOGO SVG ──────────────────────────────────────────────────────────────
const IbersilosLogo = ({ height = 42 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 78" style={{ height, width: "auto", display: "block" }}>
    <text x="2" y="38" fontFamily="'Arial Black','Arial Bold',Arial,sans-serif" fontWeight="900" fontSize="40" fill="white" stroke="black" strokeWidth="4" strokeLinejoin="round" paintOrder="stroke fill" letterSpacing="-1">IBER</text>
    <text x="2" y="74" fontFamily="'Arial Black','Arial Bold',Arial,sans-serif" fontWeight="900" fontSize="40" fill="white" stroke="black" strokeWidth="4" strokeLinejoin="round" paintOrder="stroke fill" letterSpacing="-1">SILOS</text>
    <rect x="86" y="44" width="34" height="9" rx="4.5" fill="#E30613" transform="rotate(-28 86 44)" />
    <rect x="88" y="30" width="30" height="8" rx="4" fill="#F5C800" transform="rotate(-28 88 30)" />
    <rect x="90" y="17" width="26" height="8" rx="4" fill="#E30613" transform="rotate(-28 90 17)" />
  </svg>
);

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
// ── AUTH ──────────────────────────────────────────────────────────────────────
const USERS = { 'AC001': '1974' };

function LoginScreen({ onLogin }) {
  const [userId, setUserId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [errFields, setErrFields] = useState(false);

  const doLogin = () => {
    const expected = USERS[userId.trim().toUpperCase()];
    if (!expected || expected !== pw.trim()) {
      setErr('Credenciales incorrectas. Inténtalo de nuevo.');
      setErrFields(true);
      setPw('');
      setTimeout(() => { setErr(''); setErrFields(false); }, 3000);
      return;
    }
    sessionStorage.setItem('ibs_auth', userId.trim().toUpperCase());
    onLogin();
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'white', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', fontFamily:"'Segoe UI',Roboto,Arial,sans-serif", zIndex:9999 }}>
      {/* Strisce top */}
      <div style={{ position:'fixed', top:0, left:0, right:0, height:4, background:'#F5C800' }} />
      <div style={{ position:'fixed', top:4, left:0, right:0, height:4, background:'#E30613' }} />

      <div style={{ width:360, maxWidth:'96vw', background:'white', borderRadius:12, boxShadow:'0 4px 32px rgba(0,0,0,0.10)', border:'1px solid #ebebeb', overflow:'hidden' }}>
        {/* Header */}
        <div style={{ background:'white', padding:'36px 32px 24px', textAlign:'center', borderBottom:'1px solid #f0f0f0' }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 90" style={{ height:80, width:'auto', display:'block', margin:'0 auto 12px' }}>
            <text x="2" y="44" fontFamily="'Arial Black','Arial Bold',Arial,sans-serif" fontWeight="900" fontSize="46" fill="white" stroke="black" strokeWidth="5" strokeLinejoin="round" paintOrder="stroke fill" letterSpacing="-1">IBER</text>
            <text x="2" y="86" fontFamily="'Arial Black','Arial Bold',Arial,sans-serif" fontWeight="900" fontSize="46" fill="white" stroke="black" strokeWidth="5" strokeLinejoin="round" paintOrder="stroke fill" letterSpacing="-1">SILOS</text>
            <rect x="98" y="50" width="40" height="11" rx="5.5" fill="#E30613" transform="rotate(-28 98 50)" />
            <rect x="101" y="33" width="35" height="10" rx="5" fill="#F5C800" transform="rotate(-28 101 33)" />
            <rect x="104" y="18" width="30" height="9" rx="4.5" fill="#E30613" transform="rotate(-28 104 18)" />
          </svg>
          <p style={{ color:'#aaa', fontSize:11, margin:0, letterSpacing:'0.8px', textTransform:'uppercase' }}>Gestión Financiera · Reus, Tarragona</p>
        </div>

        {/* Body */}
        <div style={{ padding:'28px 32px' }}>
          <div style={{ marginBottom:16 }}>
            <label style={{ display:'block', fontSize:10, fontWeight:700, color:'#999', textTransform:'uppercase', letterSpacing:'0.8px', marginBottom:6 }}>ID Usuario</label>
            <input
              type="text" value={userId} placeholder="es. AC001"
              onChange={e => setUserId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && document.getElementById('ibs-pw').focus()}
              style={{ width:'100%', padding:'11px 13px', border:`1.5px solid ${errFields?'#E30613':'#e0e0e0'}`, borderRadius:8, fontSize:15, fontFamily:'inherit', outline:'none', boxSizing:'border-box', background:errFields?'#fff5f5':'#fafafa', color:'#1a1a1a' }}
            />
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={{ display:'block', fontSize:10, fontWeight:700, color:'#999', textTransform:'uppercase', letterSpacing:'0.8px', marginBottom:6 }}>Password</label>
            <input
              id="ibs-pw" type="password" value={pw} placeholder="••••"
              onChange={e => setPw(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doLogin()}
              style={{ width:'100%', padding:'11px 13px', border:`1.5px solid ${errFields?'#E30613':'#e0e0e0'}`, borderRadius:8, fontSize:15, fontFamily:'inherit', outline:'none', boxSizing:'border-box', background:errFields?'#fff5f5':'#fafafa', color:'#1a1a1a' }}
            />
          </div>
          <div style={{ color:'#E30613', fontSize:12, fontWeight:700, textAlign:'center', marginBottom:14, minHeight:18 }}>{err}</div>
          <button onClick={doLogin} style={{ width:'100%', padding:13, background:'#E30613', color:'white', border:'none', borderRadius:8, fontSize:14, fontWeight:800, cursor:'pointer', letterSpacing:'0.3px', boxShadow:'0 2px 8px rgba(227,6,19,0.25)' }}>
            Accedi
          </button>
        </div>
      </div>
    </div>
  );
}

export default function IberSilosApp() {
  const [authenticated, setAuthenticated] = useState(() => !!sessionStorage.getItem('ibs_auth'));
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState({ invoices: [], movements: [], ibkrPositions: [], asientos: [], fixedAssets: DEFAULT_ASSETS });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [invoiceModal, setInvoiceModal] = useState(null);
  const [movModal, setMovModal] = useState(null);
  const [reconcileModal, setReconcileModal] = useState(null);
  const [ibkrModal, setIbkrModal] = useState(null);
  const [asientoModal, setAsientoModal] = useState(null);
  const [contabView, setContabView] = useState("diario");
  const [mayorCuenta, setMayorCuenta] = useState("572");
  const fileRef = useRef();
  const csvRef = useRef();

  useEffect(() => { loadData().then(d => { setData(d); setLoading(false); }); }, []);

  const persist = useCallback(async (newData) => { setData(newData); await saveData(newData); }, []);

  const showToast = (msg, type = "ok") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  // ── INVOICE CRUD ──
  const saveInvoice = (inv) => {
    const net = parseFloat(inv.netAmount) || 0;
    const rate = IVA_TYPES[inv.ivaType] ?? 0.21;
    const ivaAmount = parseFloat((net * rate).toFixed(2));
    const grossAmount = parseFloat((net + ivaAmount).toFixed(2));
    const final = { ...inv, ivaAmount, grossAmount, id: inv.id || `inv-${Date.now()}` };
    if (!final.dueDate) final.dueDate = addDays(final.date, 30);
    const exists = data.invoices.find(i => i.id === final.id);
    const invoices = exists ? data.invoices.map(i => i.id === final.id ? final : i) : [...data.invoices, final];
    persist({ ...data, invoices });
    setInvoiceModal(null);
    showToast(exists ? "Factura actualizada" : "Factura añadida");
  };
  const deleteInvoice = (id) => { if (!confirm("¿Eliminar?")) return; persist({ ...data, invoices: data.invoices.filter(i => i.id !== id) }); showToast("Eliminada", "warn"); };

  // ── MOVEMENT CRUD ──
  const saveMov = (mov) => {
    const final = { ...mov, id: mov.id || `mov-${Date.now()}` };
    const exists = data.movements.find(m => m.id === final.id);
    const movements = exists ? data.movements.map(m => m.id === final.id ? final : m) : [...data.movements, final];
    persist({ ...data, movements }); setMovModal(null); showToast(exists ? "Actualizado" : "Añadido");
  };
  const deleteMov = (id) => { if (!confirm("¿Eliminar?")) return; persist({ ...data, movements: data.movements.filter(m => m.id !== id) }); showToast("Eliminado", "warn"); };

  // ── IBKR CRUD ──
  const saveIbkr = (pos) => {
    const shares = parseFloat(pos.shares) || 0, price = parseFloat(pos.priceEur) || 0, fees = parseFloat(pos.fees) || 0;
    const final = { ...pos, totalEur: parseFloat((shares * price + fees).toFixed(2)), id: pos.id || `ibkr-${Date.now()}` };
    const exists = data.ibkrPositions?.find(p => p.id === final.id);
    const ibkrPositions = exists ? (data.ibkrPositions||[]).map(p => p.id===final.id?final:p) : [...(data.ibkrPositions||[]), final];
    persist({ ...data, ibkrPositions }); setIbkrModal(null); showToast(exists ? "Actualizado" : "Añadido");
  };
  const deleteIbkr = (id) => { if (!confirm("¿Eliminar?")) return; persist({ ...data, ibkrPositions: (data.ibkrPositions||[]).filter(p => p.id!==id) }); showToast("Eliminado", "warn"); };

  // ── ASIENTO CRUD ──
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
  const deleteAsiento = (id) => { if (!confirm("Eliminar?")) return; persist({ ...data, asientos: (data.asientos||[]).filter(a => a.id!==id) }); showToast("Eliminado", "warn"); };

  // ── RECONCILE ──
  const runAutoReconcile = () => {
    const movements = autoReconcile(data.movements, data.invoices);
    const matched = movements.filter(m => m._autoMatch).length;
    const invoices = data.invoices.map(inv => { const hasMatch = movements.find(m => m.invoiceId===inv.id&&m.reconciled); return hasMatch ? {...inv, status:"riconciliata"} : inv; });
    persist({ ...data, movements: movements.map(m => { const c={...m}; delete c._autoMatch; return c; }), invoices });
    showToast(`Conciliación: ${matched} coincidencias automáticas`);
  };
  const manualReconcile = (movId, invId) => {
    const movements = data.movements.map(m => m.id===movId ? {...m, invoiceId:invId, reconciled:true} : m);
    const invoices = data.invoices.map(inv => inv.id===invId ? {...inv, status:"riconciliata"} : inv);
    persist({ ...data, movements, invoices }); setReconcileModal(null); showToast("Conciliación guardada");
  };

  // ── CSV IMPORT ──
  const importCSV = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseRevolutCSV(ev.target.result);
      const existing = new Set(data.movements.map(m => `${m.date}-${m.amount}-${m.description}`));
      const newMovs = parsed.filter(m => !existing.has(`${m.date}-${m.amount}-${m.description}`));
      if (!newMovs.length) { showToast("Sin movimientos nuevos", "warn"); return; }
      persist({ ...data, movements: [...data.movements, ...newMovs] });
      showToast(`Importados ${newMovs.length} movimientos`);
    };
    reader.readAsText(file); e.target.value = "";
  };

  // ── EXPORT / IMPORT JSON ──
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `iber-silos-${today()}.json`; a.click();
    showToast("Backup exportado");
  };
  const importJSON = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { try { persist(JSON.parse(ev.target.result)); showToast("Datos importados"); } catch { showToast("Archivo no válido", "err"); } };
    reader.readAsText(file); e.target.value = "";
  };

  const exportContabCSV = () => {
    const rows = [["Numero","Fecha","Concepto","Cuenta","Nombre Cuenta","Debe","Haber"]];
    (data.asientos||[]).forEach(a => a.lineas.forEach(l => rows.push([a.numero,a.fecha,a.concepto,l.cuenta,ACC_MAP[l.cuenta]?.name||"",l.debe||"0",l.haber||"0"])));
    const csv = rows.map(r => r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv],{type:"text/csv;charset=utf-8;"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`libro-diario-${today()}.csv`; a.click();
    showToast("Libro Diario exportado");
  };

  // ── DERIVED METRICS ──
  const metrics = (() => {
    const inv = data.invoices, mov = data.movements;
    const emesse = inv.filter(i=>i.type==="emessa"||i.type==="emitida");
    const ricevute = inv.filter(i=>i.type==="ricevuta"||i.type==="recibida");
    const fatturato = emesse.reduce((s,i)=>s+(parseFloat(i.netAmount)||0),0);
    const costi = ricevute.reduce((s,i)=>s+(parseFloat(i.netAmount)||0),0);
    const creditiAperti = emesse.filter(i=>i.status==="aperta").reduce((s,i)=>s+(parseFloat(i.grossAmount)||0),0);
    const debitiAperti = ricevute.filter(i=>i.status==="aperta").reduce((s,i)=>s+(parseFloat(i.grossAmount)||0),0);
    const liquidita = mov.reduce((s,m)=>s+(m.type==="entrata"?1:-1)*(parseFloat(m.amount)||0),0);
    return { fatturato, costi, margine:fatturato-costi, creditiAperti, debitiAperti, liquidita, marginePerc: fatturato>0?(fatturato-costi)/fatturato*100:0 };
  })();

  const forecast = buildForecast(data.invoices, data.movements);

  if (!authenticated) return <LoginScreen onLogin={() => setAuthenticated(true)} />;

  if (loading) return (
    <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#F5F5F5",fontFamily:"'Segoe UI',Roboto,Arial,sans-serif" }}>
      <div style={{ textAlign:"center" }}>
        <IbersilosLogo height={60} />
        <div style={{ marginTop:16,color:"#888",fontSize:13 }}>Cargando...</div>
      </div>
    </div>
  );

  const TABS = [
    ["dashboard","","Dashboard"],
    ["fatture","","Facturas"],
    ["movimenti","","Movimientos"],
    ["riconciliazione","","Conciliación"],
    ["forecast","","Previsión"],
    ["ibkr","","IBKR SL"],
    ["contabilidad","","Contabilidad"],
  ];

  return (
    <div style={{ fontFamily:"'Segoe UI',Roboto,Helvetica,Arial,sans-serif", background:"#F5F5F5", minHeight:"100vh", color:"#1A1A1A", display:"flex", flexDirection:"column" }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-track { background: #F5F5F5; } ::-webkit-scrollbar-thumb { background: #ddd; border-radius: 3px; }
        input, select, textarea { font-family: 'Segoe UI',Roboto,Arial,sans-serif; background: white; border: 1.5px solid #E0E0E0; color: #1A1A1A; padding: 8px 12px; border-radius: 8px; font-size: 13px; width: 100%; outline: none; transition: border-color 0.2s; }
        input:focus, select:focus, textarea:focus { border-color: #E30613; box-shadow: 0 0 0 3px rgba(227,6,19,0.08); }
        select option { background: white; }
        button { font-family: 'Segoe UI',Roboto,Arial,sans-serif; cursor: pointer; border: none; border-radius: 8px; transition: all 0.15s; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: #bbb; padding: 10px 12px; border-bottom: 2px solid #F5F5F5; background: #FAFAFA; }
        td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #F5F5F5; }
        tr:hover td { background: #FFF5F5; }
        .btn-red { background: #E30613; color: white; padding: 9px 20px; font-weight: 700; font-size: 13px; letter-spacing: 0.3px; box-shadow: 0 3px 10px rgba(227,6,19,0.25); }
        .btn-red:hover { background: #B8050F; }
        .btn-ghost { background: white; color: #666; padding: 8px 16px; border: 1.5px solid #E0E0E0; font-size: 12px; font-weight: 600; }
        .btn-ghost:hover { border-color: #E30613; color: #E30613; }
        .btn-danger { background: transparent; color: #E30613; padding: 5px 10px; font-size: 11px; border: 1.5px solid rgba(227,6,19,0.3); }
        .btn-danger:hover { background: rgba(227,6,19,0.05); }
        .badge { display:inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; }
        .badge-green { background: #e8f5e9; color: #2e7d32; border: 1px solid #a5d6a7; }
        .badge-yellow { background: #fffde7; color: #b8860b; border: 1px solid #ffe082; }
        .badge-red { background: #ffebee; color: #E30613; border: 1px solid #ef9a9a; }
        .badge-blue { background: #e8eaf6; color: #3949ab; border: 1px solid #9fa8da; }
        .badge-gray { background: #F5F5F5; color: #999; border: 1px solid #E0E0E0; }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .modal { background: white; border-radius: 16px; border-top: 4px solid #E30613; padding: 28px; width: 100%; max-width: 580px; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
        .modal-title { font-size: 15px; font-weight: 700; color: #E30613; letter-spacing: 0.3px; }
        .form-row { display: grid; gap: 14px; margin-bottom: 14px; }
        .form-row-2 { grid-template-columns: 1fr 1fr; }
        label { display: block; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: #999; margin-bottom: 5px; font-weight: 700; }
        .kpi-card { background: white; border-radius: 12px; padding: 18px 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.07); border-left: 4px solid #E30613; }
        .kpi-card.yellow { border-left-color: #F5C800; }
        .kpi-card.green { border-left-color: #28a745; }
        .kpi-card.blue { border-left-color: #3949ab; }
        .kpi-card.gray { border-left-color: #E0E0E0; }
        .kpi-value { font-size: 24px; font-weight: 800; margin: 4px 0 2px; line-height: 1; }
        .kpi-label { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: #bbb; font-weight: 700; }
        .section-title { font-size: 16px; font-weight: 800; display: flex; align-items: center; gap: 8px; text-transform: uppercase; letter-spacing: 1px; color: #1A1A1A; }
        .section-title::before { content: ''; width: 4px; height: 20px; background: linear-gradient(to bottom, #E30613, #F5C800); border-radius: 2px; flex-shrink: 0; }
        .card { background: white; border-radius: 12px; padding: 18px; box-shadow: 0 2px 10px rgba(0,0,0,0.07); }
        .tab-btn { padding: 8px 16px; font-size: 12px; font-weight: 700; border-radius: 6px; background: transparent; color: #999; border: none; letter-spacing: 0.3px; transition: all 0.15s; }
        .tab-btn:hover { color: #1A1A1A; background: #F5F5F5; }
        .tab-btn.active { background: #E30613; color: white; }
        .nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 16px; cursor: pointer; border-left: 3px solid transparent; font-size: 13px; font-weight: 600; color: #666; transition: all 0.15s; border: none; background: transparent; width: 100%; text-align: left; }
        .nav-item:hover { background: #FFF5F5; color: #1A1A1A; }
        .nav-item.active { background: #FFF0F0; border-left: 3px solid #E30613; color: #E30613; font-weight: 700; }
        .status-bar { position: fixed; bottom: 20px; right: 20px; z-index: 200; }
        .progress-bar { background: #F5F5F5; border-radius: 4px; height: 5px; overflow: hidden; }
        .progress-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, #E30613, #F5C800); }
      `}</style>

      {/* ── HEADER ── */}
      <header style={{ background:"white", borderTop:"4px solid #F5C800", borderBottom:"4px solid #E30613", padding:"0 20px", height:60, display:"flex", alignItems:"center", gap:16, flexShrink:0, boxShadow:"0 2px 10px rgba(0,0,0,0.07)", zIndex:50 }}>
        <IbersilosLogo height={40} />
        <div style={{ width:1, height:28, background:"#E0E0E0" }} />
        <div style={{ fontSize:10, fontWeight:700, letterSpacing:"2px", textTransform:"uppercase", color:"#bbb" }}>Gestión Financiera</div>
        <div style={{ flex:1 }} />
        <div style={{ display:"flex", gap:14, alignItems:"center" }}>
          <KpiPill label="Facturación" value={fmt(metrics.fatturato)} color="#E30613" />
          <KpiPill label="Liquidez" value={fmt(metrics.liquidita)} color={metrics.liquidita>=0?"#28a745":"#E30613"} />
          <KpiPill label="Créditos" value={fmt(metrics.creditiAperti)} color="#b8860b" />
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <button className="btn-ghost" onClick={exportJSON} style={{ fontSize:11 }}>↓ Backup</button>
          <button className="btn-ghost" onClick={() => fileRef.current.click()} style={{ fontSize:11 }}>↑ Importa</button>
          <input ref={fileRef} type="file" accept=".json" onChange={importJSON} style={{ display:"none" }} />
        </div>
      </header>

      {/* ── BODY ── */}
      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

        {/* ── SIDEBAR NAV ── */}
        <aside style={{ width:200, background:"white", borderRight:"1px solid #E0E0E0", display:"flex", flexDirection:"column", flexShrink:0, overflowY:"auto" }}>
          <div style={{ padding:"10px 0", borderBottom:"1px solid #F5F5F5" }}>
            <div style={{ fontSize:9, fontWeight:700, letterSpacing:"2px", textTransform:"uppercase", color:"#bbb", padding:"4px 16px 8px" }}>Navegación</div>
            {TABS.map(([id, icon, label]) => (
              <button key={id} className={`nav-item ${tab===id?"active":""}`} onClick={() => setTab(id)}>
                <span style={{ fontSize:15 }}>{icon}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* ── CONTENT ── */}
        <div style={{ flex:1, overflowY:"auto", padding:24 }}>

          {/* DASHBOARD */}
          {tab==="dashboard" && (
            <div>
              <div className="section-title" style={{ marginBottom:20 }}>Resumen</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:20 }}>
                <div className="kpi-card"><div className="kpi-label">Facturación neta</div><div className="kpi-value" style={{ color:"#E30613" }}>{fmt(metrics.fatturato)}</div></div>
                <div className="kpi-card yellow"><div className="kpi-label">Costes netos</div><div className="kpi-value" style={{ color:"#b8860b" }}>{fmt(metrics.costi)}</div></div>
                <div className="kpi-card green"><div className="kpi-label">Margen bruto</div><div className="kpi-value" style={{ color:metrics.margine>=0?"#28a745":"#E30613" }}>{fmt(metrics.margine)} <span style={{ fontSize:14, color:"#999" }}>{metrics.marginePerc.toFixed(1)}%</span></div></div>
                <div className="kpi-card yellow"><div className="kpi-label">Créditos abiertos</div><div className="kpi-value" style={{ color:"#b8860b" }}>{fmt(metrics.creditiAperti)}</div></div>
                <div className="kpi-card gray"><div className="kpi-label">Deudas abiertas</div><div className="kpi-value" style={{ color:"#666" }}>{fmt(metrics.debitiAperti)}</div></div>
                <div className="kpi-card blue"><div className="kpi-label">Liquidez estimada</div><div className="kpi-value" style={{ color:metrics.liquidita>=0?"#3949ab":"#E30613" }}>{fmt(metrics.liquidita)}</div></div>
              </div>
              <div className="card" style={{ marginBottom:16 }}>
                <div style={{ fontSize:10, fontWeight:700, letterSpacing:"1.5px", textTransform:"uppercase", color:"#bbb", marginBottom:12 }}>Previsión liquidez 90 días</div>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={forecast}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F5F5F5" />
                    <XAxis dataKey="day" tick={{ fontSize:10, fill:"#bbb" }} interval={4} />
                    <YAxis tick={{ fontSize:10, fill:"#bbb" }} tickFormatter={v=>`${(v/1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={{ background:"white", border:"1.5px solid #E0E0E0", borderRadius:8, fontSize:12 }} formatter={(v)=>[fmt(v),"Liquidez"]} />
                    <ReferenceLine y={0} stroke="rgba(227,6,19,0.3)" strokeDasharray="4 4" />
                    <ReferenceLine y={30000} stroke="rgba(40,167,69,0.3)" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="balance" stroke="#E30613" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="card">
                <div style={{ fontSize:10, fontWeight:700, letterSpacing:"1.5px", textTransform:"uppercase", color:"#bbb", marginBottom:12 }}>Últimas facturas</div>
                {data.invoices.length===0 ? <div style={{ color:"#bbb", fontSize:13 }}>Sin facturas aún.</div> :
                  <table><thead><tr><th>N°</th><th>Data</th><th>Tipo</th><th>Controparte</th><th>Imponibile</th><th>Stato</th></tr></thead>
                  <tbody>{data.invoices.slice(-8).reverse().map(inv=>(
                    <tr key={inv.id}>
                      <td style={{ fontWeight:700, color:"#E30613" }}>{inv.number||"—"}</td>
                      <td>{fmtDate(inv.date)}</td>
                      <td><span className={`badge ${(inv.type==="emessa"||inv.type==="emitida")?"badge-green":"badge-yellow"}`}>{inv.type}</span></td>
                      <td>{(inv.type==="emessa"||inv.type==="emitida")?inv.client:inv.supplier}</td>
                      <td style={{ fontWeight:600 }}>{fmt(inv.netAmount)}</td>
                      <td><StatusBadge status={inv.status}/></td>
                    </tr>
                  ))}</tbody></table>
                }
              </div>
            </div>
          )}

          {/* FATTURE */}
          {tab==="fatture" && (
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
                <div className="section-title">Registro de Facturas</div>
                <div style={{ display:"flex", gap:8 }}>
                  <button className="btn-red" onClick={() => setInvoiceModal({ id:null,type:"emitida",number:"",date:today(),dueDate:"",client:"",supplier:"",description:"",netAmount:"",ivaType:"21%",ivaAmount:0,grossAmount:0,status:"aperta",dropboxLink:"",notes:"" })}>+ Emitida</button>
                  <button className="btn-ghost" onClick={() => setInvoiceModal({ id:null,type:"recibida",number:"",date:today(),dueDate:"",client:"",supplier:"",description:"",netAmount:"",ivaType:"RC (reverse charge)",ivaAmount:0,grossAmount:0,status:"aperta",dropboxLink:"",notes:"" })}>+ Recibida</button>
                </div>
              </div>
              <InvoiceTable invoices={data.invoices} onEdit={inv=>setInvoiceModal(inv)} onDelete={deleteInvoice} />
            </div>
          )}

          {/* MOVIMENTI */}
          {tab==="movimenti" && (
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                <div className="section-title">Movimientos Bancarios</div>
                <div style={{ display:"flex", gap:8 }}>
                  <button className="btn-ghost" onClick={() => csvRef.current.click()} style={{ fontSize:11 }}>↑ Importar CSV Revolut</button>
                  <input ref={csvRef} type="file" accept=".csv" onChange={importCSV} style={{ display:"none" }} />
                  <button className="btn-red" onClick={() => setMovModal({ id:null,date:today(),description:"",amount:"",type:"entrata",account:"Revolut Business",invoiceId:null,reconciled:false,notes:"" })}>+ Movimiento</button>
                </div>
              </div>
              <MovementTable movements={data.movements} invoices={data.invoices} onEdit={m=>setMovModal(m)} onDelete={deleteMov} onReconcile={m=>setReconcileModal(m)} />
            </div>
          )}

          {/* RICONCILIAZIONE */}
          {tab==="riconciliazione" && (
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
                <div className="section-title">Conciliación</div>
                <button className="btn-red" onClick={runAutoReconcile}> Auto-conciliar</button>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:20 }}>
                <div className="kpi-card green"><div className="kpi-label">Facturas conciliadas</div><div className="kpi-value">{data.invoices.filter(i=>i.status==="riconciliata").length}<span style={{ fontSize:14,color:"#bbb",marginLeft:6 }}>/ {data.invoices.length}</span></div></div>
                <div className="kpi-card blue"><div className="kpi-label">Movimientos conciliados</div><div className="kpi-value">{data.movements.filter(m=>m.reconciled).length}<span style={{ fontSize:14,color:"#bbb",marginLeft:6 }}>/ {data.movements.length}</span></div></div>
              </div>
              <div className="card">
                <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:12 }}>Movimientos por conciliar</div>
                {data.movements.filter(m=>!m.reconciled).length===0 ? <div style={{ color:"#bbb",fontSize:13 }}>Todos los movimientos conciliados </div> :
                  <table><thead><tr><th>Data</th><th>Descrizione</th><th>Importo</th><th>Tipo</th><th></th></tr></thead>
                  <tbody>{data.movements.filter(m=>!m.reconciled).map(m=>(
                    <tr key={m.id}>
                      <td>{fmtDate(m.date)}</td>
                      <td style={{ maxWidth:280,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{m.description}</td>
                      <td style={{ color:m.type==="entrata"?"#28a745":"#E30613",fontWeight:600 }}>{m.type==="entrata"?"+":"-"}{fmt(m.amount)}</td>
                      <td><span className={`badge ${m.type==="entrata"?"badge-green":"badge-red"}`}>{m.type}</span></td>
                      <td><button className="btn-ghost" style={{ fontSize:11,padding:"4px 10px" }} onClick={()=>setReconcileModal(m)}>Abbina</button></td>
                    </tr>
                  ))}</tbody></table>
                }
              </div>
            </div>
          )}

          {/* FORECAST */}
          {tab==="forecast" && (
            <div>
              <div className="section-title" style={{ marginBottom:20 }}>Previsión Cash Flow — 90 giorni</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:20 }}>
                <div className="kpi-card blue"><div className="kpi-label">Liquidez attuale</div><div className="kpi-value" style={{ color:"#3949ab" }}>{fmt(metrics.liquidita)}</div></div>
                <div className="kpi-card green"><div className="kpi-label">Cobros previstos 90 días</div><div className="kpi-value" style={{ color:"#28a745" }}>{fmt(data.invoices.filter(i=>(i.type==="emessa"||i.type==="emitida")&&i.status==="aperta").reduce((s,i)=>s+(parseFloat(i.grossAmount)||0),0))}</div></div>
                <div className="kpi-card"><div className="kpi-label">Pagos previstos 90 días</div><div className="kpi-value" style={{ color:"#E30613" }}>{fmt(data.invoices.filter(i=>(i.type==="ricevuta"||i.type==="recibida")&&i.status==="aperta").reduce((s,i)=>s+(parseFloat(i.grossAmount)||0),0))}</div></div>
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

          {/* IBKR SL */}
          {tab==="ibkr" && (() => {
            const positions = data.ibkrPositions || [];
            const byTicker = {};
            positions.forEach(p => {
              if (!byTicker[p.ticker]) byTicker[p.ticker] = { ticker:p.ticker, shares:0, totalInvested:0 };
              const shares = parseFloat(p.shares)||0, total = parseFloat(p.totalEur)||0;
              if (p.type==="acquisto") { byTicker[p.ticker].shares+=shares; byTicker[p.ticker].totalInvested+=total; }
              else { byTicker[p.ticker].shares-=shares; byTicker[p.ticker].totalInvested-=total; }
            });
            const tickers = Object.values(byTicker).filter(t=>t.shares>0.0001);
            const totalInvested = tickers.reduce((s,t)=>s+t.totalInvested,0);
            const pacByMonth = {};
            positions.filter(p=>p.type==="acquisto").forEach(p => { const m=p.date.slice(0,7); if(!pacByMonth[m]) pacByMonth[m]=0; pacByMonth[m]+=parseFloat(p.totalEur)||0; });
            const pacChart = Object.entries(pacByMonth).sort().map(([m,v])=>({ month:m.slice(5)+"/"+m.slice(2,4), investito:parseFloat(v.toFixed(2)), target:getPacAmount(m+"-15") }));
            return (
              <div>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
                  <div className="section-title">IBKR SL — Portfolio Iber-Silos SLU</div>
                  <button className="btn-red" onClick={()=>setIbkrModal({ id:null,ticker:"VWCE",date:today(),type:"acquisto",shares:"",priceEur:"",totalEur:"",fees:"0",notes:"" })}>+ Operación</button>
                </div>
                <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:20 }}>
                  <div className="kpi-card"><div className="kpi-label">Total invertido</div><div className="kpi-value" style={{ color:"#E30613" }}>{fmt(totalInvested)}</div></div>
                  <div className="kpi-card gray"><div className="kpi-label">Ticker</div><div className="kpi-value">{tickers.length}</div></div>
                  <div className="kpi-card gray"><div className="kpi-label">Operazioni</div><div className="kpi-value">{positions.length}</div></div>
                  <div className="kpi-card yellow"><div className="kpi-label">PAC objetivo/mes</div><div className="kpi-value" style={{ color:"#b8860b" }}>{fmt(getPacAmount(today()))}</div><div style={{ fontSize:10,color:"#bbb",marginTop:2 }}>→ €500 desde jul 2026</div></div>
                </div>
                <div className="card" style={{ marginBottom:16 }}>
                  <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:12 }}>Posiciones abiertas</div>
                  {tickers.length===0 ? <div style={{ color:"#bbb",fontSize:13 }}>Nessuna posizione. Añade la primera operación.</div> :
                    <table><thead><tr><th>Ticker</th><th style={{ textAlign:"right" }}>Shares</th><th style={{ textAlign:"right" }}>PMC</th><th style={{ textAlign:"right" }}>Valore PMC</th><th style={{ textAlign:"right" }}>% cartera</th></tr></thead>
                    <tbody>{tickers.map(t => {
                      const pmc = t.shares>0 ? t.totalInvested/t.shares : 0;
                      const perc = totalInvested>0 ? t.totalInvested/totalInvested*100 : 0;
                      return (
                        <tr key={t.ticker}>
                          <td style={{ fontWeight:800,color:"#E30613",fontSize:15 }}>{t.ticker}</td>
                          <td style={{ textAlign:"right" }}>{t.shares.toFixed(4)}</td>
                          <td style={{ textAlign:"right" }}>{fmt(pmc)}</td>
                          <td style={{ textAlign:"right",fontWeight:600 }}>{fmt(t.shares*pmc)}</td>
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
                    <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:12 }}>PAC mensual — investito vs target</div>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={pacChart}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F5F5F5" />
                        <XAxis dataKey="month" tick={{ fontSize:10,fill:"#bbb" }} />
                        <YAxis tick={{ fontSize:10,fill:"#bbb" }} tickFormatter={v=>`${v}€`} />
                        <Tooltip contentStyle={{ background:"white",border:"1.5px solid #E0E0E0",borderRadius:8,fontSize:12 }} formatter={(v,n)=>[fmt(v),n==="investito"?"Investito":"Target"]} />
                        <Bar dataKey="investito" fill="#E30613" radius={[4,4,0,0]} />
                        <Bar dataKey="target" fill="#F5F5F5" radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="card">
                  <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:12 }}>Registro operaciones</div>
                  {positions.length===0 ? <div style={{ color:"#bbb",fontSize:13 }}>Sin operaciones.</div> :
                    <table><thead><tr><th>Data</th><th>Tipo</th><th>Ticker</th><th style={{ textAlign:"right" }}>Shares</th><th style={{ textAlign:"right" }}>Prezzo</th><th style={{ textAlign:"right" }}>Commissioni</th><th style={{ textAlign:"right" }}>Totale</th><th></th></tr></thead>
                    <tbody>{[...positions].reverse().map(p=>(
                      <tr key={p.id}>
                        <td>{fmtDate(p.date)}</td>
                        <td><span className={`badge ${p.type==="acquisto"?"badge-green":"badge-red"}`}>{p.type}</span></td>
                        <td style={{ fontWeight:800,color:"#E30613" }}>{p.ticker}</td>
                        <td style={{ textAlign:"right" }}>{parseFloat(p.shares||0).toFixed(4)}</td>
                        <td style={{ textAlign:"right" }}>{fmt(p.priceEur)}</td>
                        <td style={{ textAlign:"right",color:"#999",fontSize:11 }}>{fmt(p.fees)}</td>
                        <td style={{ textAlign:"right",fontWeight:600 }}>{fmt(p.totalEur)}</td>
                        <td>
                          <button className="btn-ghost" style={{ fontSize:11,padding:"4px 8px",marginRight:4 }} onClick={()=>setIbkrModal(p)}></button>
                          <button className="btn-danger" onClick={()=>deleteIbkr(p.id)}></button>
                        </td>
                      </tr>
                    ))}</tbody></table>
                  }
                </div>
              </div>
            );
          })()}

          {/* CONTABILIDAD */}
          {tab==="contabilidad" && (() => {
            const asientos = data.asientos || [];
            const fixedAssets = data.fixedAssets || DEFAULT_ASSETS;
            const currentYear = new Date().getFullYear();
            const mayorSaldos = {};
            PGC_ACCOUNTS.forEach(a => { mayorSaldos[a.code]={ debe:0, haber:0, movs:[] }; });
            asientos.forEach(asi => asi.lineas.forEach(l => {
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
            let saldoProgr = 0;
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
                  {[["diario","Libro Diario"],["mayor","Libro Mayor"],["comprobacion","Bal. Comprobación"],["pyg","PyG"],["bancos","Bancos"],["amortizacion","Amortizaciones"]].map(([v,l])=>(
                    <button key={v} className={`tab-btn ${contabView===v?"active":""}`} style={{ fontSize:11,padding:"6px 14px" }} onClick={()=>setContabView(v)}>{l}</button>
                  ))}
                </div>

                {contabView==="diario" && (
                  <div className="card">
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
                      <span style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb" }}>{asientos.length} asientos</span>
                      {asientos.length>0 && <span className={`badge ${cuadra?"badge-green":"badge-red"}`}>{cuadra?" Cuadra":" No cuadra"}</span>}
                    </div>
                    {asientos.length===0 ? <div style={{ color:"#bbb",fontSize:13 }}>Sin asientos. Ogni asiento deve bilanciare: ∑Debe = ∑Haber</div> :
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
                                  <button className="btn-ghost" style={{ fontSize:11,padding:"4px 8px",marginRight:4 }} onClick={()=>setAsientoModal(asi)}></button>
                                  <button className="btn-danger" onClick={()=>deleteAsiento(asi.id)}></button>
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
                      {mayorData.movs.length===0 ? <div style={{ color:"#bbb",fontSize:13 }}>Sin movimientos.</div> :
                        <table>
                          <thead><tr><th>N°</th><th>Fecha</th><th>Concepto</th><th style={{ textAlign:"right" }}>Debe</th><th style={{ textAlign:"right" }}>Haber</th><th style={{ textAlign:"right" }}>Saldo progr.</th></tr></thead>
                          <tbody>{mayorData.movs.sort((a,b)=>a.fecha.localeCompare(b.fecha)).map((m,i)=>{
                            saldoProgr+=m.debe-m.haber;
                            return (
                              <tr key={i}>
                                <td style={{ color:"#E30613",fontWeight:700 }}>{m.num}</td>
                                <td style={{ color:"#999" }}>{fmtDate(m.fecha)}</td>
                                <td style={{ maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{m.concepto}</td>
                                <td style={{ textAlign:"right",color:m.debe?"#28a745":"#F5F5F5" }}>{m.debe?fmt(m.debe):""}</td>
                                <td style={{ textAlign:"right",color:m.haber?"#E30613":"#F5F5F5" }}>{m.haber?fmt(m.haber):""}</td>
                                <td style={{ textAlign:"right",fontWeight:600,color:saldoProgr>=0?"#3949ab":"#E30613" }}>{fmt(Math.abs(saldoProgr))} {saldoProgr>=0?"D":"H"}</td>
                              </tr>
                            );
                          })}</tbody>
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
                      <span className={`badge ${cuadra?"badge-green":"badge-red"}`}>{cuadra?" CUADRA":" NO CUADRA"}</span>
                    </div>
                    {cuentasUsadas.length===0 ? <div style={{ color:"#bbb",fontSize:13 }}>Registra asientos para ver el balance.</div> :
                      <table>
                        <thead><tr><th>Cuenta</th><th>Nombre</th><th style={{ textAlign:"right" }}>Sumas Debe</th><th style={{ textAlign:"right" }}>Sumas Haber</th><th style={{ textAlign:"right" }}>Saldo D</th><th style={{ textAlign:"right" }}>Saldo H</th></tr></thead>
                        <tbody>{cuentasUsadas.map(a=>{
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

                {contabView==="pyg" && (() => {
                  const inv = data.invoices || [];
                  const mov = data.movements || [];
                  const amort = (data.fixedAssets||DEFAULT_ASSETS).reduce((s,a) => s + calcAmortYear(a, new Date().getFullYear()), 0);

                  // INGRESOS grupo 7
                  const ingTransporte = inv.filter(i=>(i.type==="emessa"||i.type==="emitida")&&!["annullata"].includes(i.status)&&!i.number?.startsWith("R-")).reduce((s,i)=>s+(parseFloat(i.netAmount)||0),0);
                  const ingRettifiche = inv.filter(i=>i.number?.startsWith("R-")).reduce((s,i)=>s+(parseFloat(i.netAmount)||0),0);
                  const ingNetto = ingTransporte + ingRettifiche;

                  // GASTOS grupo 6 — da movimenti categorizzati
                  const gastoSubCCI = mov.filter(m=>m.type==="uscita"&&m.description?.includes("C.C.I")).reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
                  const gastoBMB = mov.filter(m=>m.type==="uscita"&&m.description?.includes("BMB")).reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
                  const gastoLaClau = mov.filter(m=>m.type==="uscita"&&m.description?.includes("La Clau")).reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
                  const gastoIBKR = mov.filter(m=>m.type==="uscita"&&m.description?.includes("Interactive Brokers")).reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
                  const gastoRevolut = mov.filter(m=>m.type==="uscita"&&m.notes?.includes("Comisión mensual")).reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
                  const gastoAEAT = mov.filter(m=>m.type==="uscita"&&m.description?.includes("AEAT")).reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
                  const gastoNomina = mov.filter(m=>m.type==="uscita"&&m.notes?.includes("administrador")).reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
                  const gastoMTO = mov.filter(m=>m.type==="uscita"&&m.description?.includes("MTO")).reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
                  const gastoCar = mov.filter(m=>m.type==="uscita"&&m.notes?.startsWith("CAR")||m.notes?.startsWith("Gasto")).reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
                  const gastoOtros = mov.filter(m=>m.type==="uscita"&&m.description?.includes("Truck Service")).reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
                  const totalGastos = gastoSubCCI + gastoBMB + gastoLaClau + gastoRevolut + gastoAEAT + gastoNomina + gastoMTO + gastoCar + gastoOtros;
                  const ebitda = ingNetto - totalGastos;
                  const ebit = ebitda - amort;
                  const is = ebit > 0 ? ebit * 0.15 : 0;
                  const beneficioNeto = ebit - is;

                  const Row = ({label, amount, bold, indent, color, separator}) => (
                    <tr style={{ borderBottom: separator?"2px solid #E0E0E0":"1px solid #F5F5F5" }}>
                      <td style={{ padding:"8px 12px", fontSize:13, paddingLeft: indent?32:12, fontWeight:bold?700:400, color:color||"#1A1A1A" }}>{label}</td>
                      <td style={{ padding:"8px 12px", textAlign:"right", fontWeight:bold?700:400, color: amount<0?"#E30613": amount>0&&bold?"#28a745":"#1A1A1A", fontSize:13 }}>{fmt(amount)}</td>
                    </tr>
                  );

                  return (
                    <div>
                      <div style={{ background:"#fff8e1",border:"1.5px solid #ffe082",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#b8860b" }}>
                        Cuenta de Pérdidas y Ganancias — datos extraídos de movimientos Revolut + facturas. Verificar con La Clau para cierre fiscal oficial.
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14, marginBottom:20 }}>
                        <div className="kpi-card green"><div className="kpi-label">Ingresos netos</div><div className="kpi-value" style={{ color:"#28a745" }}>{fmt(ingNetto)}</div></div>
                        <div className="kpi-card yellow"><div className="kpi-label">EBITDA</div><div className="kpi-value" style={{ color: ebitda>=0?"#b8860b":"#E30613" }}>{fmt(ebitda)}</div></div>
                        <div className="kpi-card"><div className="kpi-label">Resultado neto (IS 15%)</div><div className="kpi-value" style={{ color: beneficioNeto>=0?"#28a745":"#E30613" }}>{fmt(beneficioNeto)}</div></div>
                      </div>
                      <div className="card">
                        <table>
                          <thead><tr><th>Concepto</th><th style={{ textAlign:"right" }}>Importe</th></tr></thead>
                          <tbody>
                            <Row label="INGRESOS DE EXPLOTACIÓN" amount={ingNetto} bold color="#28a745" separator/>
                            <Row label="Prestaciones de servicios (705/706)" amount={ingTransporte} indent/>
                            <Row label="Rectificativas (R-)" amount={ingRettifiche} indent/>
                            <Row label="" amount={0} separator/>
                            <Row label="GASTOS DE EXPLOTACIÓN" amount={-totalGastos} bold color="#E30613" separator/>
                            <Row label="Subcontratistas CCI Italia (624)" amount={-gastoSubCCI} indent/>
                            <Row label="Subcontratistas BMB (624)" amount={-gastoBMB} indent/>
                            <Row label="Asesor fiscal La Clau (623)" amount={-gastoLaClau} indent/>
                            <Row label="Retribución administrador (640)" amount={-gastoNomina} indent/>
                            <Row label="Compra maquinaria/MTO (224)" amount={-gastoMTO} indent/>
                            <Row label="PAC IBKR SL (5722)" amount={-gastoIBKR} indent/>
                            <Row label="Comisiones Revolut (626)" amount={-gastoRevolut} indent/>
                            <Row label="AEAT pagos (475)" amount={-gastoAEAT} indent/>
                            <Row label="Otros gastos (629)" amount={-(gastoCar+gastoOtros)} indent separator/>
                            <Row label="EBITDA" amount={ebitda} bold color={ebitda>=0?"#b8860b":"#E30613"} separator/>
                            <Row label="Amortizaciones (681)" amount={-amort} indent separator/>
                            <Row label="EBIT (Resultado explotación)" amount={ebit} bold color={ebit>=0?"#3949ab":"#E30613"} separator/>
                            <Row label="Impuesto sobre Sociedades 15%" amount={-is} indent separator/>
                            <Row label="RESULTADO NETO" amount={beneficioNeto} bold color={beneficioNeto>=0?"#28a745":"#E30613"} separator/>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {contabView==="bancos" && (() => {
                  const mov = data.movements || [];
                  const revolut = mov.filter(m=>m.account==="Revolut Business");
                  const saldoRevolut = revolut.reduce((s,m)=>s+(m.type==="entrata"?1:-1)*(parseFloat(m.amount)||0),0);
                  const ibkrNav = (data.ibkrPositions||[]).reduce((s,p)=>s+(parseFloat(p.totalEur)||0),0);
                  const totalBancario = saldoRevolut + ibkrNav;

                  const byMonth = {};
                  revolut.forEach(m => {
                    const mes = m.date?.slice(0,7);
                    if (!byMonth[mes]) byMonth[mes]={ entrate:0, uscite:0 };
                    if (m.type==="entrata") byMonth[mes].entrate += parseFloat(m.amount)||0;
                    else byMonth[mes].uscite += parseFloat(m.amount)||0;
                  });
                  const monthData = Object.entries(byMonth).sort().map(([m,v])=>({
                    mes: m.slice(5)+"/"+m.slice(2,4),
                    entrate: v.entrate,
                    uscite: v.uscite,
                    neto: v.entrate - v.uscite
                  }));

                  return (
                    <div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:20 }}>
                        <div className="kpi-card blue">
                          <div className="kpi-label">Revolut Business (572)</div>
                          <div className="kpi-value" style={{ color: saldoRevolut>=0?"#3949ab":"#E30613" }}>{fmt(saldoRevolut)}</div>
                          <div style={{ fontSize:10,color:"#bbb",marginTop:4 }}>IBAN ES32 1583 0001 1893 9775 2739</div>
                        </div>
                        <div className="kpi-card green">
                          <div className="kpi-label">IBKR SL — Inversiones (5722)</div>
                          <div className="kpi-value" style={{ color:"#28a745" }}>{fmt(ibkrNav)}</div>
                          <div style={{ fontSize:10,color:"#bbb",marginTop:4 }}>Coste histórico — sin mark-to-market</div>
                        </div>
                        <div className="kpi-card">
                          <div className="kpi-label">Total posición bancaria</div>
                          <div className="kpi-value" style={{ color:"#E30613" }}>{fmt(totalBancario)}</div>
                          <div style={{ fontSize:10,color:"#bbb",marginTop:4 }}>Revolut + IBKR SL</div>
                        </div>
                      </div>
                      <div className="card" style={{ marginBottom:16 }}>
                        <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:12 }}>Flujo mensual — Revolut Business</div>
                        <div style={{ overflowX:"auto" }}>
                          <table>
                            <thead><tr><th>Mes</th><th style={{ textAlign:"right" }}>Entradas</th><th style={{ textAlign:"right" }}>Salidas</th><th style={{ textAlign:"right" }}>Neto</th></tr></thead>
                            <tbody>{monthData.map(m=>(
                              <tr key={m.mes}>
                                <td style={{ fontWeight:600 }}>{m.mes}</td>
                                <td style={{ textAlign:"right",color:"#28a745",fontWeight:600 }}>{fmt(m.entrate)}</td>
                                <td style={{ textAlign:"right",color:"#E30613",fontWeight:600 }}>{fmt(m.uscite)}</td>
                                <td style={{ textAlign:"right",fontWeight:700,color:m.neto>=0?"#3949ab":"#E30613" }}>{fmt(m.neto)}</td>
                              </tr>
                            ))}</tbody>
                            <tfoot><tr style={{ background:"#F5F5F5" }}>
                              <td style={{ fontWeight:700,padding:"10px 12px" }}>TOTAL</td>
                              <td style={{ textAlign:"right",fontWeight:700,color:"#28a745",padding:"10px 12px" }}>{fmt(monthData.reduce((s,m)=>s+m.entrate,0))}</td>
                              <td style={{ textAlign:"right",fontWeight:700,color:"#E30613",padding:"10px 12px" }}>{fmt(monthData.reduce((s,m)=>s+m.uscite,0))}</td>
                              <td style={{ textAlign:"right",fontWeight:700,color:saldoRevolut>=0?"#3949ab":"#E30613",padding:"10px 12px" }}>{fmt(saldoRevolut)}</td>
                            </tr></tfoot>
                          </table>
                        </div>
                      </div>
                      <div className="card">
                        <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:12 }}>Posición IBKR SL — Cartera ETF</div>
                        {(data.ibkrPositions||[]).length===0 ? <div style={{ color:"#bbb",fontSize:13 }}>Sin operaciones IBKR registradas.</div> : (() => {
                          const byTicker = {};
                          (data.ibkrPositions||[]).forEach(p => {
                            if (!byTicker[p.ticker]) byTicker[p.ticker]={ shares:0, invested:0 };
                            byTicker[p.ticker].shares += parseFloat(p.shares)||0;
                            byTicker[p.ticker].invested += parseFloat(p.totalEur)||0;
                          });
                          return (
                            <table>
                              <thead><tr><th>Ticker</th><th style={{ textAlign:"right" }}>Participaciones</th><th style={{ textAlign:"right" }}>PMC</th><th style={{ textAlign:"right" }}>Coste total</th><th style={{ textAlign:"right" }}>% cartera</th></tr></thead>
                              <tbody>{Object.entries(byTicker).map(([t,v])=>{
                                const pmc = v.shares>0?v.invested/v.shares:0;
                                const perc = ibkrNav>0?v.invested/ibkrNav*100:0;
                                return (
                                  <tr key={t}>
                                    <td style={{ fontWeight:800,color:"#E30613",fontSize:15 }}>{t}</td>
                                    <td style={{ textAlign:"right" }}>{v.shares.toFixed(4)}</td>
                                    <td style={{ textAlign:"right" }}>{fmt(pmc)}</td>
                                    <td style={{ textAlign:"right",fontWeight:600 }}>{fmt(v.invested)}</td>
                                    <td style={{ textAlign:"right",color:"#999",fontSize:11 }}>{perc.toFixed(1)}%</td>
                                  </tr>
                                );
                              })}</tbody>
                              <tfoot><tr style={{ background:"#F5F5F5" }}>
                                <td colSpan={3} style={{ fontWeight:700,padding:"10px 12px" }}>TOTAL (coste histórico)</td>
                                <td style={{ textAlign:"right",fontWeight:700,color:"#E30613",padding:"10px 12px" }}>{fmt(ibkrNav)}</td>
                                <td style={{ padding:"10px 12px" }}/>
                              </tr></tfoot>
                            </table>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })()}

                {contabView==="amortizacion" && (
                  <div>
                    <div style={{ background:"#fff8e1",border:"1.5px solid #ffe082",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#b8860b" }}>
                      <strong>Fechas provisionales</strong> — 20/01/2025. Actualiza con export ContaSimple. Tasa AEAT maquinaria: <strong>12% lineare</strong> (máximo tabla oficial).
                    </div>
                    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:20 }}>
                      {amortRows.map(a=>(
                        <div key={a.id} className="kpi-card yellow">
                          <div style={{ display:"flex",justifyContent:"space-between" }}>
                            <div><div className="kpi-label">{a.name} — Conto 224</div></div>
                            <button className="btn-ghost" style={{ fontSize:10,padding:"3px 8px" }} onClick={()=>{ const nd=prompt("Data acquisto (YYYY-MM-DD):",a.dateAcq); if(nd){ const fa=(data.fixedAssets||DEFAULT_ASSETS).map(x=>x.id===a.id?{...x,dateAcq:nd}:x); persist({...data,fixedAssets:fa}); } }}> fecha</button>
                          </div>
                          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:10 }}>
                            <div><div style={{ fontSize:10,color:"#bbb" }}>Coste histórico</div><div style={{ fontWeight:700 }}>{fmt(a.costEur)}</div></div>
                            <div><div style={{ fontSize:10,color:"#bbb" }}>Quota {currentYear}</div><div style={{ fontWeight:700,color:"#b8860b" }}>{fmt(a.quotaYear)}</div></div>
                            <div><div style={{ fontSize:10,color:"#bbb" }}>Ammort. accum.</div><div style={{ fontWeight:700,color:"#E30613" }}>{fmt(a.accumulated)}</div></div>
                            <div><div style={{ fontSize:10,color:"#bbb" }}>Valor neto</div><div style={{ fontWeight:700,color:"#28a745" }}>{fmt(a.netValue)}</div></div>
                          </div>
                          <div style={{ marginTop:10,background:"#F5F5F5",borderRadius:4,height:5,overflow:"hidden" }}>
                            <div style={{ height:"100%",background:"linear-gradient(90deg,#E30613,#F5C800)",width:`${Math.min(a.accumulated/a.costEur*100,100)}%`,borderRadius:4 }} />
                          </div>
                          <div style={{ fontSize:10,color:"#bbb",marginTop:3,textAlign:"right" }}>{(a.accumulated/a.costEur*100).toFixed(1)}% amortizado</div>
                        </div>
                      ))}
                    </div>
                    <div className="card">
                      <div style={{ fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#bbb",marginBottom:12 }}>Tabla de amortización completa</div>
                      <table>
                        <thead><tr><th>Anno</th>{amortRows.map(a=><th key={a.id} style={{ textAlign:"right" }}>{a.name}</th>)}<th style={{ textAlign:"right" }}>Totale 681</th><th style={{ textAlign:"right" }}>Valor neto 224</th></tr></thead>
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
                      <div style={{ marginTop:12,padding:"10px 14px",background:"#F5F5F5",borderRadius:8,fontSize:11,color:"#999" }}>
                         Asiento anual: <span style={{ color:"#3949ab",fontWeight:600 }}>681 Ammortamento ∑quota</span> (Debe) → <span style={{ color:"#b8860b",fontWeight:600 }}>281 Amort. acumulada ∑quota</span> (Haber)
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

        </div>
      </div>

      {/* ── MODALS ── */}
      {invoiceModal && <InvoiceModal inv={invoiceModal} onSave={saveInvoice} onClose={()=>setInvoiceModal(null)} />}
      {movModal && <MovModal mov={movModal} onSave={saveMov} onClose={()=>setMovModal(null)} />}
      {ibkrModal && (
        <div className="modal-overlay" onClick={()=>setIbkrModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div style={{ display:"flex",justifyContent:"space-between",marginBottom:20 }}>
              <div className="modal-title">{ibkrModal.id?"Editar operación":"Nueva operación"} IBKR SL</div>
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
              <div className="modal-title">Conciliar movimiento</div>
              <button onClick={()=>setReconcileModal(null)} style={{ background:"none",fontSize:20,color:"#999" }}>×</button>
            </div>
            <div style={{ background:"#FFF5F5",border:"1.5px solid #ef9a9a",borderRadius:8,padding:14,marginBottom:18,fontSize:13 }}>
              <div style={{ fontSize:10,fontWeight:700,letterSpacing:"0.1em",color:"#bbb",marginBottom:6 }}>MOVIMENTO</div>
              <div style={{ fontWeight:600 }}>{fmtDate(reconcileModal.date)} — {reconcileModal.description}</div>
              <div style={{ color:reconcileModal.type==="entrata"?"#28a745":"#E30613",fontWeight:700,marginTop:4 }}>{reconcileModal.type==="entrata"?"+":"-"}{fmt(reconcileModal.amount)}</div>
            </div>
            <div style={{ fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#bbb",marginBottom:10 }}>Facturas disponibles</div>
            <div style={{ maxHeight:280,overflowY:"auto" }}>
              {data.invoices.filter(i=>i.status!=="riconciliata"&&((reconcileModal.type==="entrata"&&i.type==="emitida")||(reconcileModal.type==="uscita"&&i.type==="recibida"))).map(inv=>(
                <div key={inv.id} onClick={()=>manualReconcile(reconcileModal.id,inv.id)}
                  style={{ padding:"12px 14px",borderRadius:8,border:"1.5px solid #E0E0E0",marginBottom:8,cursor:"pointer",transition:"all 0.15s" }}
                  onMouseEnter={e=>e.currentTarget.style.borderColor="#E30613"}
                  onMouseLeave={e=>e.currentTarget.style.borderColor="#E0E0E0"}>
                  <div style={{ display:"flex",justifyContent:"space-between" }}>
                    <span style={{ color:"#E30613",fontSize:13,fontWeight:700 }}>{inv.number} — {(inv.type==="emessa"||inv.type==="emitida")?inv.client:inv.supplier}</span>
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

      {toast && (
        <div style={{ position:"fixed",bottom:24,right:24,background:toast.type==="err"?"#ffebee":toast.type==="warn"?"#fffde7":"#e8f5e9",border:`1.5px solid ${toast.type==="err"?"#ef9a9a":toast.type==="warn"?"#ffe082":"#a5d6a7"}`,color:toast.type==="err"?"#c62828":toast.type==="warn"?"#b8860b":"#2e7d32",padding:"12px 20px",borderRadius:10,fontSize:13,fontWeight:600,zIndex:200,boxShadow:"0 4px 20px rgba(0,0,0,0.1)" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── SUB-COMPONENTS ─────────────────────────────────────────────────────────────

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
  const [filter, setFilter] = useState("todas");
  const filtered = filter==="todas" ? invoices : invoices.filter(i=>i.type===filter||i.type===(filter==="emitida"?"emessa":filter==="recibida"?"ricevuta":filter));
  return (
    <div className="card">
      <div style={{ display:"flex",gap:6,marginBottom:16,alignItems:"center" }}>
        {["todas","emitida","recibida"].map(f=>(
          <button key={f} className={`tab-btn ${filter===f?"active":""}`} style={{ fontSize:11,padding:"6px 14px" }} onClick={()=>setFilter(f)}>{f}</button>
        ))}
        <span style={{ marginLeft:"auto",color:"#bbb",fontSize:11,fontWeight:600 }}>{filtered.length} fatture</span>
      </div>
      {filtered.length===0 ? <div style={{ color:"#bbb",fontSize:13 }}>Nessuna fattura.</div> :
        <div style={{ overflowX:"auto" }}>
          <table>
            <thead><tr><th>N°</th><th>Data</th><th>Scad.</th><th>Tipo</th><th>Controparte</th><th>Descrizione</th><th style={{ textAlign:"right" }}>Imponibile</th><th>IVA</th><th style={{ textAlign:"right" }}>Lordo</th><th>Stato</th><th></th></tr></thead>
            <tbody>{[...filtered].reverse().map(inv=>(
              <tr key={inv.id}>
                <td style={{ color:"#E30613",fontWeight:700,whiteSpace:"nowrap" }}>{inv.number||"—"}</td>
                <td style={{ whiteSpace:"nowrap",color:"#999" }}>{fmtDate(inv.date)}</td>
                <td style={{ whiteSpace:"nowrap",color:inv.dueDate<new Date().toISOString().split("T")[0]&&inv.status==="aperta"?"#E30613":"#999" }}>{fmtDate(inv.dueDate)}</td>
                <td><span className={`badge ${(inv.type==="emessa"||inv.type==="emitida")?"badge-green":"badge-yellow"}`}>{inv.type}</span></td>
                <td style={{ maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{(inv.type==="emessa"||inv.type==="emitida")?inv.client:inv.supplier}</td>
                <td style={{ maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"#999",fontSize:12 }}>{inv.description}</td>
                <td style={{ textAlign:"right",fontWeight:600 }}>{fmt(inv.netAmount)}</td>
                <td style={{ color:"#bbb",fontSize:11 }}>{inv.ivaType}</td>
                <td style={{ textAlign:"right",fontWeight:600 }}>{fmt(inv.grossAmount)}</td>
                <td><StatusBadge status={inv.status}/></td>
                <td style={{ whiteSpace:"nowrap" }}>
                  <button className="btn-ghost" style={{ fontSize:11,marginRight:4,padding:"4px 8px" }} onClick={()=>onEdit(inv)}></button>
                  <button className="btn-danger" onClick={()=>onDelete(inv.id)}></button>
                </td>
              </tr>
            ))}</tbody>
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
      <span style={{ color:"#bbb",fontSize:11,fontWeight:600,display:"block",marginBottom:12 }}>{movements.length} movimenti · {movements.filter(m=>m.reconciled).length} riconciliati</span>
      {movements.length===0 ? <div style={{ color:"#bbb",fontSize:13 }}>Sin movimientos. Importa CSV Revolut o aggiungi manualmente.</div> :
        <div style={{ overflowX:"auto" }}>
          <table>
            <thead><tr><th>Data</th><th>Descrizione</th><th>Importo</th><th>Conto</th><th>Factura enlazada</th><th>Stato</th><th></th></tr></thead>
            <tbody>{[...movements].reverse().map(m=>{
              const linked = m.invoiceId ? invMap[m.invoiceId] : null;
              return (
                <tr key={m.id}>
                  <td style={{ whiteSpace:"nowrap",color:"#999" }}>{fmtDate(m.date)}</td>
                  <td style={{ maxWidth:240,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{m.description}</td>
                  <td style={{ color:m.type==="entrata"?"#28a745":"#E30613",fontWeight:700,whiteSpace:"nowrap" }}>{m.type==="entrata"?"+":"-"}{fmt(m.amount)}</td>
                  <td style={{ color:"#bbb",fontSize:11 }}>{m.account}</td>
                  <td style={{ fontSize:11 }}>{linked?<span style={{ color:"#3949ab",fontWeight:600 }}>{linked.number} — {(linked.type==="emessa"||linked.type==="emitida")?linked.client:linked.supplier}</span>:<span style={{ color:"#E0E0E0" }}>—</span>}</td>
                  <td>{m.reconciled?<span className="badge badge-green">abbinato</span>:<span className="badge badge-gray">libero</span>}</td>
                  <td style={{ whiteSpace:"nowrap" }}>
                    {!m.reconciled && <button className="btn-ghost" style={{ fontSize:11,marginRight:4,padding:"4px 8px" }} onClick={()=>onReconcile(m)}></button>}
                    <button className="btn-ghost" style={{ fontSize:11,marginRight:4,padding:"4px 8px" }} onClick={()=>onEdit(m)}></button>
                    <button className="btn-danger" onClick={()=>onDelete(m.id)}></button>
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
  const IVA_TYPES_KEYS = { "21%": 0.21, "10%": 0.10, "7%": 0.07, "RC (reverse charge)": 0, "Esente": 0, "0%": 0 };
  const [form, setForm] = useState({ ...inv });
  const set = (k, v) => setForm(f => {
    const updated = { ...f, [k]: v };
    if (k==="netAmount"||k==="ivaType") {
      const net = parseFloat(k==="netAmount"?v:f.netAmount)||0;
      const rate = IVA_TYPES_KEYS[k==="ivaType"?v:f.ivaType]??0.21;
      updated.ivaAmount = parseFloat((net*rate).toFixed(2));
      updated.grossAmount = parseFloat((net+updated.ivaAmount).toFixed(2));
    }
    return updated;
  });
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
          <div className="modal-title">{form.id?"Editar factura":"Nueva factura"} — <span style={{ color:(form.type==="emessa"||form.type==="emitida")?"#28a745":"#b8860b" }}>{form.type}</span></div>
          <button onClick={onClose} style={{ background:"none",fontSize:20,color:"#999" }}>×</button>
        </div>
        <div className="form-row"><div style={{ display:"flex",gap:8 }}>
          <button className={`tab-btn ${(form.type==="emessa"||form.type==="emitida")?"active":""}`} onClick={()=>set("type","emessa")} style={{ flex:1 }}>Emessa</button>
          <button className={`tab-btn ${(form.type==="ricevuta"||form.type==="recibida")?"active":""}`} onClick={()=>set("type","ricevuta")} style={{ flex:1 }}>Ricevuta</button>
        </div></div>
        <div className="form-row form-row-2">
          <div><label>N° Factura</label><input value={form.number} onChange={e=>set("number",e.target.value)} placeholder="IBS-5816/2026/SE" /></div>
          <div><label>Data</label><input type="date" value={form.date} onChange={e=>set("date",e.target.value)} /></div>
        </div>
        <div className="form-row form-row-2">
          <div><label>Vencimiento</label><input type="date" value={form.dueDate} onChange={e=>set("dueDate",e.target.value)} /></div>
          <div><label>Stato</label><select value={form.status} onChange={e=>set("status",e.target.value)}>{["aperta","pagata","riconciliata","annullata"].map(s=><option key={s}>{s}</option>)}</select></div>
        </div>
        {form.type==="emitida"
          ? <div className="form-row"><label>Cliente</label><select value={form.client} onChange={e=>set("client",e.target.value)}><option value="">Seleziona...</option>{CLIENTS.map(c=><option key={c}>{c}</option>)}</select></div>
          : <div className="form-row"><label>Fornitore</label><select value={form.supplier} onChange={e=>set("supplier",e.target.value)}><option value="">Seleziona...</option>{SUPPLIERS.map(s=><option key={s}>{s}</option>)}</select></div>
        }
        <div className="form-row"><label>Descrizione</label><input value={form.description} onChange={e=>set("description",e.target.value)} placeholder="Servizi di trasporto — ordine..." /></div>
        <div className="form-row form-row-2">
          <div><label>Imponibile (€)</label><input type="number" step="0.01" value={form.netAmount} onChange={e=>set("netAmount",e.target.value)} /></div>
          <div><label>Tipo IVA</label><select value={form.ivaType} onChange={e=>set("ivaType",e.target.value)}>{Object.keys(IVA_TYPES_KEYS).map(k=><option key={k}>{k}</option>)}</select></div>
        </div>
        <div className="form-row form-row-2">
          <div><label>IVA (€)</label><input readOnly value={form.ivaAmount||0} style={{ color:"#bbb" }} /></div>
          <div><label>Total bruto (€)</label><input readOnly value={form.grossAmount||0} style={{ color:"#E30613",fontWeight:700 }} /></div>
        </div>
        <div className="form-row"><label>Enlace Dropbox documento</label><input value={form.dropboxLink} onChange={e=>set("dropboxLink",e.target.value)} placeholder="https://www.dropbox.com/..." /></div>
        <div className="form-row"><label>Note</label><textarea rows={2} value={form.notes} onChange={e=>set("notes",e.target.value)} /></div>
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
          <div><label>Data</label><input type="date" value={form.date} onChange={e=>set("date",e.target.value)} /></div>
          <div><label>Conto</label><select value={form.account} onChange={e=>set("account",e.target.value)}>{["Revolut Business","BBVA","Contanti"].map(a=><option key={a}>{a}</option>)}</select></div>
        </div>
        <div className="form-row"><label>Descrizione</label><input value={form.description} onChange={e=>set("description",e.target.value)} /></div>
        <div className="form-row form-row-2">
          <div><label>Importo (€)</label><input type="number" step="0.01" value={form.amount} onChange={e=>set("amount",e.target.value)} /></div>
          <div><label>Tipo</label><select value={form.type} onChange={e=>set("type",e.target.value)}><option>entrata</option><option>uscita</option></select></div>
        </div>
        <div className="form-row"><label>Note</label><textarea rows={2} value={form.notes} onChange={e=>set("notes",e.target.value)} /></div>
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
        <div><label>Data</label><input type="date" value={form.date} onChange={e=>set("date",e.target.value)} /></div>
        <div><label>Tipo</label><select value={form.type} onChange={e=>set("type",e.target.value)}><option value="acquisto">Acquisto</option><option value="vendita">Vendita</option></select></div>
      </div>
      <div className="form-row form-row-2">
        <div><label>Ticker ETF</label><select value={form.ticker} onChange={e=>set("ticker",e.target.value)}>{IBKR_ETFS.map(t=><option key={t}>{t}</option>)}</select></div>
        <div><label>Participaciones</label><input type="number" step="0.0001" value={form.shares} onChange={e=>set("shares",e.target.value)} placeholder="es. 3.4567" /></div>
      </div>
      <div className="form-row form-row-2">
        <div><label>Prezzo per share (€)</label><input type="number" step="0.01" value={form.priceEur} onChange={e=>set("priceEur",e.target.value)} placeholder="es. 118.45" /></div>
        <div><label>Commissioni IBKR (€)</label><input type="number" step="0.01" value={form.fees} onChange={e=>set("fees",e.target.value)} placeholder="es. 1.25" /></div>
      </div>
      <div className="form-row"><label>Totale operazione (€) — calcolato</label><input readOnly value={form.totalEur||0} style={{ color:"#E30613",fontWeight:700 }} /></div>
      <div style={{ background:"#FFF5F5",border:"1.5px solid #ef9a9a",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:11,color:"#E30613" }}>
         PAC target: <span style={{ fontWeight:700 }}>{getPacAmount(form.date)}/mese</span> · Classificazione: <span style={{ color:"#666" }}>Inversiones financieras a largo plazo</span>
      </div>
      <div className="form-row"><label>Note</label><textarea rows={2} value={form.notes} onChange={e=>set("notes",e.target.value)} placeholder="Es: PAC aprile 2026 — VWCE" /></div>
      <div style={{ display:"flex",gap:8,marginTop:8 }}>
        <button className="btn-red" style={{ flex:1 }} onClick={()=>onSave(form)}>Guardar</button>
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
      </div>
    </>
  );
}

function AsientoModal({ asiento, onSave, onClose }) {
  const [form, setForm] = useState({ ...asiento, lineas: asiento.lineas.map(l=>({...l})) });
  const setField = (k,v) => setForm(f=>({...f,[k]:v}));
  const setLinea = (i,k,v) => setForm(f=>({ ...f, lineas: f.lineas.map((l,li)=>li===i?{...l,[k]:v}:l) }));
  const addLinea = () => setForm(f=>({...f,lineas:[...f.lineas,{cuenta:"",debe:"",haber:"",descripcion:""}]}));
  const removeLinea = (i) => setForm(f=>({...f,lineas:f.lineas.filter((_,li)=>li!==i)}));
  const totalDebe = form.lineas.reduce((s,l)=>s+(parseFloat(l.debe)||0),0);
  const totalHaber = form.lineas.reduce((s,l)=>s+(parseFloat(l.haber)||0),0);
  const cuadra = Math.abs(totalDebe-totalHaber)<0.01;
  const fmt2 = (n) => new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR",minimumFractionDigits:2}).format(n||0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:700 }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
          <div style={{ display:"flex",alignItems:"center",gap:12 }}>
            <div className="modal-title">{form.id?"Editar asiento":"Nuevo asiento"}</div>
            <span className={`badge ${cuadra?"badge-green":"badge-red"}`}>{cuadra?" Cuadra":`Diff: ${fmt2(Math.abs(totalDebe-totalHaber))}`}</span>
          </div>
          <button onClick={onClose} style={{ background:"none",fontSize:20,color:"#999" }}>×</button>
        </div>
        <div className="form-row form-row-2" style={{ marginBottom:14 }}>
          <div><label>N° Asiento</label><input value={form.numero} onChange={e=>setField("numero",e.target.value)} /></div>
          <div><label>Fecha</label><input type="date" value={form.fecha} onChange={e=>setField("fecha",e.target.value)} /></div>
        </div>
        <div className="form-row" style={{ marginBottom:18 }}><label>Concepto</label><input value={form.concepto} onChange={e=>setField("concepto",e.target.value)} placeholder="Es: Compra compresores / Nómina / Factura..." /></div>

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
                <select value={l.cuenta} onChange={e=>{ setLinea(i,"cuenta",e.target.value); if(!l.descripcion) setLinea(i,"descripcion",ACC_MAP[e.target.value]?.name||""); }} style={{ fontSize:12,padding:"6px 8px" }}>
                  <option value="">—</option>
                  {PGC_ACCOUNTS.map(a=><option key={a.code} value={a.code}>{a.code}</option>)}
                </select>
                {l.cuenta && <div style={{ fontSize:9,color:"#bbb",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{ACC_MAP[l.cuenta]?.name}</div>}
              </div>
              <input value={l.descripcion} onChange={e=>setLinea(i,"descripcion",e.target.value)} style={{ fontSize:12 }} placeholder="Detalle..." />
              <input type="number" step="0.01" value={l.debe} onChange={e=>{ setLinea(i,"debe",e.target.value); if(e.target.value) setLinea(i,"haber",""); }} style={{ fontSize:12,textAlign:"right",borderColor:l.debe?"#a5d6a7":"#E0E0E0" }} placeholder="0.00" />
              <input type="number" step="0.01" value={l.haber} onChange={e=>{ setLinea(i,"haber",e.target.value); if(e.target.value) setLinea(i,"debe",""); }} style={{ fontSize:12,textAlign:"right",borderColor:l.haber?"#ef9a9a":"#E0E0E0" }} placeholder="0.00" />
              {form.lineas.length>2 ? <button onClick={()=>removeLinea(i)} style={{ background:"transparent",color:"#E30613",border:"none",cursor:"pointer",fontSize:16,padding:0 }}></button> : <div />}
            </div>
          ))}
          <button className="btn-ghost" style={{ fontSize:11,marginTop:4,width:"100%" }} onClick={addLinea}>+ Añadir línea</button>
        </div>

        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:18 }}>
          <div style={{ background:"#e8f5e9",border:"1.5px solid #a5d6a7",borderRadius:8,padding:"10px 14px",textAlign:"center" }}>
            <div style={{ fontSize:10,color:"#28a745",fontWeight:700,letterSpacing:"0.08em" }}>DEBE</div>
            <div style={{ fontWeight:800,color:"#28a745",fontSize:16 }}>{fmt2(totalDebe)}</div>
          </div>
          <div style={{ background:"#ffebee",border:"1.5px solid #ef9a9a",borderRadius:8,padding:"10px 14px",textAlign:"center" }}>
            <div style={{ fontSize:10,color:"#E30613",fontWeight:700,letterSpacing:"0.08em" }}>HABER</div>
            <div style={{ fontWeight:800,color:"#E30613",fontSize:16 }}>{fmt2(totalHaber)}</div>
          </div>
          <div style={{ background:cuadra?"#e8f5e9":"#ffebee",border:`1.5px solid ${cuadra?"#a5d6a7":"#ef9a9a"}`,borderRadius:8,padding:"10px 14px",textAlign:"center" }}>
            <div style={{ fontSize:10,color:cuadra?"#28a745":"#E30613",fontWeight:700,letterSpacing:"0.08em" }}>DIFERENCIA</div>
            <div style={{ fontWeight:800,color:cuadra?"#28a745":"#E30613",fontSize:16 }}>{cuadra?"":fmt2(Math.abs(totalDebe-totalHaber))}</div>
          </div>
        </div>

        <div className="form-row" style={{ marginBottom:16 }}><label>Notas</label><textarea rows={2} value={form.notas} onChange={e=>setField("notas",e.target.value)} placeholder="Referencia factura, notas..." /></div>
        <div style={{ display:"flex",gap:8 }}>
          <button className="btn-red" style={{ flex:1, opacity:cuadra?1:0.5 }} onClick={()=>onSave(form)} disabled={!cuadra}>{cuadra?"Registrar asiento":" Non cuadra"}</button>
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
