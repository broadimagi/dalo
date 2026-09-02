import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserQRCodeReader } from "@zxing/browser";
import {
  Check,
  ArrowRight,
  BarChart3,
  ChevronLeft,
  Download,
  FileUp,
  Link,
  ListChecks,
  Lock,
  MonitorSmartphone,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X
} from "lucide-react";
import "./styles.css";

const API_URL =
  "https://script.google.com/macros/s/AKfycbzbldkFxSfXMB9n1cjhShA39_oBMdk7sAOlxhWLUjqpb2mazdRQ7MKo3K-pGMX9PJUZ5w/exec";
const DEFAULT_THEME_COLOR = "#1683ff";
const ADMIN_PASSWORD = "Broadimagi";
const RESERVED_COLUMNS = ["rowId", "Status", "Time", "UID", "status", "time"];
const ROUTER_SETTING_KEYS = ["isActive", "syncTime", "Masterlist", "Suggestions", "Confirm", "Notify"];
const DEFAULT_SYNC_SECONDS = 60;
const MIN_SYNC_SECONDS = 15;
const MAX_SYNC_SECONDS = 3600;

const getCaseInsensitiveValue = (object, key) => {
  if (!object || typeof object !== "object") return undefined;
  const actualKey = Object.keys(object).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return actualKey ? object[actualKey] : undefined;
};

const hasRouterSettings = (object) =>
  ROUTER_SETTING_KEYS.some((key) => getCaseInsensitiveValue(object, key) !== undefined);

const normalizeLivePayload = (payload) => {
  if (Array.isArray(payload)) return { rows: payload, headers: null, router: null, error: null };
  if (!payload || typeof payload !== "object") return { rows: [], headers: null, router: null, error: "Invalid server response." };

  const rows = payload.rows || payload.data || payload.records || payload.masterlist;
  const routerCandidates = [payload.router, payload.masterRouter, payload.config, payload.settings, payload];
  const router = routerCandidates.find(hasRouterSettings) || null;
  return {
    rows: Array.isArray(rows) ? rows : [],
    headers: Array.isArray(payload.headers) ? payload.headers : null,
    router,
    error: payload.error || null
  };
};

const isRouterActive = (router) => {
  const value = getCaseInsensitiveValue(router, "isActive");
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "boolean") return value;
  return !["false", "0", "no", "off"].includes(String(value).trim().toLowerCase());
};

const getRouterSyncSeconds = (router) => {
  const value = Number(getCaseInsensitiveValue(router, "syncTime"));
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_SYNC_SECONDS;
  return Math.min(MAX_SYNC_SECONDS, Math.max(MIN_SYNC_SECONDS, Math.round(value)));
};

const isInactiveError = (error) => /inactive|deactivated/i.test(String(error || ""));

const columnsFromRouterValue = (value, availableColumns, single = false) => {
  if (value === undefined || value === null || String(value).trim() === "") return [];
  const indexes = String(value)
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((index) => Number.isInteger(index) && index >= 1 && index <= availableColumns.length);
  const columns = [...new Set(indexes.map((index) => availableColumns[index - 1]))];
  return single ? columns.slice(0, 1) : columns;
};

const getInitial = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
};

const defaultSettings = {
  showColumns: [],
  confirmColumns: [],
  suggestionColumns: [],
  notificationColumns: [],
  currentThemeColor: DEFAULT_THEME_COLOR
};

function AttendanceApp({ initialEventId = "", initialPassword = "", forceLocal = false, onExit }) {
  const [masterlist, setMasterlist] = useState(() => getInitial("masterlist", []));
  const [settings, setSettings] = useState(() => {
    const savedSettings = {
      ...defaultSettings,
      ...getInitial("settings", defaultSettings)
    };
    if (["#3b82f6", "#7dd3fc"].includes(savedSettings.currentThemeColor)) {
      savedSettings.currentThemeColor = DEFAULT_THEME_COLOR;
    }
    return savedSettings;
  });
  const [deviceId, setDeviceId] = useState("");
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(null);
  const [toastItems, setToastItems] = useState([]);
  const [identityUnlocked, setIdentityUnlocked] = useState(false);
  const [eventId, setEventId] = useState(() => forceLocal ? "" : initialEventId);
  const [password, setPassword] = useState(() => forceLocal ? "" : initialPassword);
  const [syncTimeSeconds, setSyncTimeSeconds] = useState(DEFAULT_SYNC_SECONDS);
  const [hasImageBackground, setHasImageBackground] = useState(() => !!localStorage.getItem("customThemePicture"));
  const csvInputRef = useRef(null);
  const bgInputRef = useRef(null);
  const searchInputRef = useRef(null);

  const headers = useMemo(
    () => Object.keys(masterlist[0] || {}).filter((key) => !RESERVED_COLUMNS.includes(key)),
    [masterlist]
  );

  const counters = useMemo(() => {
    const total = masterlist.length;
    const checked = masterlist.filter((row) => isChecked(row)).length;
    return {
      total,
      checked,
      pending: total - checked,
      rate: total ? Math.round((checked / total) * 100) : 0
    };
  }, [masterlist]);

  useEffect(() => {
    let savedId = localStorage.getItem("operatorIdentityName");
    if (!savedId) {
      savedId = `Device-${Math.floor(1000 + Math.random() * 9000)}`;
      localStorage.setItem("operatorIdentityName", savedId);
    }
    setDeviceId(savedId);
  }, []);

  useEffect(() => {
    const customImage = localStorage.getItem("customThemePicture");
    if (customImage) {
      applyImageBackground(customImage);
    } else {
      applyColorEngine(settings.currentThemeColor || DEFAULT_THEME_COLOR, false);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("settings", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (!isLiveMode) localStorage.setItem("masterlist", JSON.stringify(masterlist));
  }, [masterlist, isLiveMode]);

  useEffect(() => {
    if (forceLocal) {
      localStorage.removeItem("connectedEventId");
      localStorage.removeItem("connectedPassword");
      setIsLiveMode(false);
      return;
    }
    if (eventId && password) fetchLiveMasterlist(eventId, password, true);
  }, []);

  useEffect(() => {
    const warnBeforeLeaving = (event) => {
      if (!isLiveMode) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [isLiveMode]);

  useEffect(() => {
    const interval = setInterval(runBackgroundSyncHeartbeat, syncTimeSeconds * 1000);
    return () => clearInterval(interval);
  }, [isLiveMode, modal, eventId, password, masterlist, settings, syncTimeSeconds]);

  const dataColumns = (preferred) => {
    if (Array.isArray(preferred)) return preferred;
    return headers;
  };

  function isChecked(row) {
    return ["Checked", "Checked-in"].includes(row?.Status || row?.status);
  }

  function openModal(type, title, content = {}) {
    setModal({ type, title, ...content });
  }

  function closeModal() {
    setModal(null);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }

  function saveSettings(nextSettings) {
    setSettings(nextSettings);
    localStorage.setItem("settings", JSON.stringify(nextSettings));
  }

  function applyColorEngine(hex, persist = true) {
    const safeHex = hex?.startsWith("#") ? hex : DEFAULT_THEME_COLOR;
    const r = parseInt(safeHex.slice(1, 3), 16);
    const g = parseInt(safeHex.slice(3, 5), 16);
    const b = parseInt(safeHex.slice(5, 7), 16);
    document.documentElement.style.setProperty(
      "--bg-gradient",
      `radial-gradient(circle at 78% 18%, rgba(${r}, ${g}, ${b}, .22), transparent 34rem), linear-gradient(135deg, #ffffff 0%, #f3f5f8 100%)`
    );
    document.documentElement.style.setProperty("--primary-color", safeHex);
    document.body.style.backgroundImage = "";
    document.body.classList.add("bg-light-contrast");
    document.body.classList.remove("bg-dark-contrast");
    if (persist) {
      localStorage.removeItem("customThemePicture");
      setHasImageBackground(false);
      saveSettings({ ...settings, currentThemeColor: safeHex });
    }
  }

  function applyImageBackground(dataUrl) {
    document.body.style.backgroundImage = `url(${dataUrl})`;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = 40;
      canvas.height = 40;
      ctx.drawImage(img, 0, 0, 40, 40);
      const imageData = ctx.getImageData(0, 0, 40, 40).data;
      let luminance = 0;
      for (let i = 0; i < imageData.length; i += 4) {
        luminance += 0.299 * imageData[i] + 0.587 * imageData[i + 1] + 0.114 * imageData[i + 2];
      }
      document.body.classList.toggle("bg-light-contrast", luminance / 1600 > 140);
      document.body.classList.toggle("bg-dark-contrast", luminance / 1600 <= 140);
    };
    img.src = dataUrl;
  }

  function handleBackgroundUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        localStorage.setItem("customThemePicture", loadEvent.target.result);
        setHasImageBackground(true);
        applyImageBackground(loadEvent.target.result);
      } catch {
        alert("Image file size is too large for local storage.");
      }
    };
    reader.readAsDataURL(file);
  }

  function clearImageBackground() {
    localStorage.removeItem("customThemePicture");
    setHasImageBackground(false);
    applyColorEngine(settings.currentThemeColor || DEFAULT_THEME_COLOR, false);
  }

  function ensureDefaultColumnSettings(rows) {
    if (!rows.length) return settings;
    if (settings.showColumns.length) return settings;
    const nextHeaders = Object.keys(rows[0]).filter((key) => !RESERVED_COLUMNS.includes(key));
    const nameColumn = nextHeaders.find((key) => key.toLowerCase() === "name");
    const next = {
      ...settings,
      showColumns: nextHeaders.slice(0, 4),
      suggestionColumns: nextHeaders.slice(0, 3),
      confirmColumns: nextHeaders.slice(0, 3),
      notificationColumns: nameColumn ? [nameColumn] : nextHeaders.slice(0, 1)
    };
    saveSettings(next);
    return next;
  }

  function applyRouterColumnSettings(rows, router, sheetHeaders = null) {
    if (!rows.length || !router) return ensureDefaultColumnSettings(rows);
    const availableColumns = Object.keys(rows[0]).filter((key) => !RESERVED_COLUMNS.includes(key));
    const indexedColumns = Array.isArray(sheetHeaders) && sheetHeaders.length ? sheetHeaders : availableColumns;
    const getColumns = (key, single = false) =>
      columnsFromRouterValue(getCaseInsensitiveValue(router, key), indexedColumns, single)
        .filter((column) => availableColumns.includes(column));
    const next = {
      ...settings,
      showColumns: getColumns("Masterlist"),
      suggestionColumns: getColumns("Suggestions"),
      confirmColumns: getColumns("Confirm"),
      notificationColumns: getColumns("Notify", true)
    };
    saveSettings(next);
    return next;
  }

  function parseCsv(text) {
    const rows = text.split(/\r?\n/).filter(Boolean);
    const fileHeaders = rows[0].split(",").map((value) => value.trim());
    return rows.slice(1).map((row) => {
      const record = {};
      row.split(",").forEach((value, index) => {
        record[fileHeaders[index]] = value.trim();
      });
      return { ...record, Status: "", Time: "", UID: "" };
    });
  }

  function loadCsv(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const importedRows = parseCsv(loadEvent.target.result);
      let added = 0;
      const nextRows = [...masterlist];
      importedRows.forEach((row) => {
        const duplicate = nextRows.some((existing) =>
          Object.keys(row).every((key) => existing[key] === row[key])
        );
        if (!duplicate) {
          nextRows.push(row);
          added += 1;
        }
      });
      ensureDefaultColumnSettings(nextRows);
      setMasterlist(nextRows);
      openModal("message", "Upload Complete", { message: `Added ${added} record${added === 1 ? "" : "s"}.` });
      event.target.value = "";
    };
    reader.readAsText(file);
  }

  function searchGuest(rawValue) {
    if (!masterlist.length) {
      openModal("message", "Not Found", { message: "No data has been uploaded or linked." });
      return;
    }
    const value = rawValue.toLowerCase().trim();
    if (!value) return;
    const searchColumns = dataColumns(settings.suggestionColumns);
    const matches = masterlist
      .map((row, index) => ({ row, index }))
      .filter(({ row }) =>
        searchColumns.some((column) => String(row[column] || "").toLowerCase().includes(value))
      )
      .sort((a, b) => {
        const bExact = searchColumns.some((column) => String(b.row[column] || "").toLowerCase() === value);
        const aExact = searchColumns.some((column) => String(a.row[column] || "").toLowerCase() === value);
        return Number(bExact) - Number(aExact);
      })
      .slice(0, 5);
    if (!matches.length) {
      openModal("message", "Not Found", { message: "No data found for this search." });
      return;
    }
    openModal("suggestions", "Select Guest Profile", { matches });
  }

  function checkName(event) {
    event.preventDefault();
    searchGuest(query);
  }

  function handleQrScan(value) {
    setQuery(value);
    searchGuest(value);
  }

  function selectSuggestion(index) {
    setCurrentIndex(index);
    openModal("confirmation", isChecked(masterlist[index]) ? "Action Blocked" : "Verify Profile Data", {
      guestIndex: index
    });
  }

  async function fetchLiveMasterlist(nextEventId, nextPassword, silent = false) {
    try {
      if (!silent) openModal("message", "Loading", { message: "Fetching event records..." });
      const response = await fetch(
        `${API_URL}?eventId=${encodeURIComponent(nextEventId)}&password=${encodeURIComponent(nextPassword)}`
      );
      const payload = normalizeLivePayload(await response.json());
      if (payload.error) {
        setIsLiveMode(false);
        if (silent && isInactiveError(payload.error)) {
          localStorage.removeItem("connectedEventId");
          localStorage.removeItem("connectedPassword");
          setEventId("");
          setPassword("");
        }
        openModal("message", isInactiveError(payload.error) ? "Event Inactive" : "Access Denied", {
          message: isInactiveError(payload.error) ? "This event is currently inactive and cannot be connected." : `Google API Error: ${payload.error}`
        });
        return;
      }
      if (!isRouterActive(payload.router)) {
        setIsLiveMode(false);
        openModal("message", "Event Inactive", { message: "This event is currently inactive and cannot be connected." });
        return;
      }
      setSyncTimeSeconds(getRouterSyncSeconds(payload.router));
      localStorage.setItem("connectedEventId", nextEventId);
      localStorage.setItem("connectedPassword", nextPassword);
      setEventId(nextEventId);
      setPassword(nextPassword);
      applyRouterColumnSettings(payload.rows, payload.router, payload.headers);
      setMasterlist(payload.rows);
      setIsLiveMode(true);
      if (!silent) closeModal();
    } catch {
      setIsLiveMode(false);
      if (!silent) openModal("message", "Sync Offline", { message: "Could not connect to database endpoint." });
    }
  }

  async function runBackgroundSyncHeartbeat() {
    if (!isLiveMode || ["suggestions", "confirmation"].includes(modal?.type)) return;
    if (!eventId || !password) return;
    try {
      const response = await fetch(`${API_URL}?eventId=${encodeURIComponent(eventId)}&password=${encodeURIComponent(password)}`);
      const payload = normalizeLivePayload(await response.json());
      if (payload.error) {
        if (isInactiveError(payload.error)) {
          localStorage.removeItem("connectedEventId");
          localStorage.removeItem("connectedPassword");
          setIsLiveMode(false);
          setEventId("");
          setPassword("");
          openModal("message", "Event Inactive", { message: "This event has been deactivated and disconnected." });
        }
        return;
      }
      if (!payload.rows.length) return;
      if (!isRouterActive(payload.router)) {
        localStorage.removeItem("connectedEventId");
        localStorage.removeItem("connectedPassword");
        setIsLiveMode(false);
        setEventId("");
        setPassword("");
        openModal("message", "Event Inactive", { message: "This event has been deactivated and disconnected." });
        return;
      }
      setSyncTimeSeconds(getRouterSyncSeconds(payload.router));
      const freshData = payload.rows;
      const localMap = new Map(masterlist.map((row) => [String(row.rowId), row]));
      freshData.forEach((freshRow) => {
        const localMatch = localMap.get(String(freshRow.rowId));
        if (localMatch && !isChecked(localMatch) && isChecked(freshRow)) notifyCheckIn(freshRow);
      });
      setMasterlist(freshData);
    } catch {
      // Background sync quietly waits for the next cycle.
    }
  }

  async function checkIn() {
    if (currentIndex === null) return;
    const targetGuest = masterlist[currentIndex];
    const time = new Date().toLocaleString();
    if (isLiveMode) {
      openModal("message", "Verifying", { message: "Checking database state..." });
      try {
        const verifyResponse = await fetch(`${API_URL}?eventId=${encodeURIComponent(eventId)}&password=${encodeURIComponent(password)}`);
        const verifyPayload = normalizeLivePayload(await verifyResponse.json());
        if (verifyPayload.error || !isRouterActive(verifyPayload.router)) {
          openModal("message", "Check-In Blocked", { message: verifyPayload.error || "This event is currently inactive." });
          return;
        }
        const freshestData = verifyPayload.rows;
        const freshRow = freshestData.find((row) => String(row.rowId) === String(targetGuest.rowId));
        if (freshRow && isChecked(freshRow)) {
          openModal("message", "Overwrite Blocked", { message: "Another operator already checked this guest in." });
          return;
        }
        const response = await fetch(API_URL, {
          method: "POST",
          body: JSON.stringify({ eventId, password, rowId: targetGuest.rowId, status: "Checked", time, operator: deviceId })
        });
        const result = await response.json();
        if (!result.success) {
          openModal("message", "Sync Refused", { message: `Error: ${result.error}` });
          return;
        }
      } catch {
        openModal("message", "Network Error", { message: "Sync failed." });
        return;
      }
    }
    const nextRows = masterlist.map((row, index) =>
      index === currentIndex ? { ...row, Status: "Checked", Time: time, UID: deviceId } : row
    );
    setMasterlist(nextRows);
    notifyCheckIn(nextRows[currentIndex]);
    openModal("success", "Checked-In Successfully", { guestIndex: currentIndex, time });
  }

  function notifyCheckIn(row) {
    const columns = Array.isArray(settings.notificationColumns) ? settings.notificationColumns : [];
    const label = columns.map((column) => row[column]).filter(Boolean).join(" - ") || row.Name || "Guest Profile";
    const id = crypto.randomUUID?.() || String(Date.now());
    setToastItems((items) => [...items.slice(-4), { id, label }]);
    setTimeout(() => setToastItems((items) => items.filter((item) => item.id !== id)), 45000);
  }

  function afterCheckIn() {
    setQuery("");
    setCurrentIndex(null);
    closeModal();
  }

  function download() {
    if (!masterlist.length) return;
    const csv = [
      Object.keys(masterlist[0]).join(","),
      ...masterlist.map((row) => Object.values(row).join(","))
    ].join("\n");
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    anchor.download = "local_attendance_backup.csv";
    anchor.click();
  }

  function resetAll() {
    if (isLiveMode || prompt("Enter admin password:") !== ADMIN_PASSWORD) return;
    setMasterlist((rows) =>
      rows.map((row) => ({ ...row, Status: "", Time: "", UID: "", status: row.status ? "" : row.status, time: row.time ? "" : row.time }))
    );
  }

  function clearAllData() {
    if (isLiveMode || prompt("Enter admin password:") !== ADMIN_PASSWORD || !confirm("Download first?")) return;
    download();
    if (!confirm("Delete all imported data?")) return;
    setMasterlist([]);
    localStorage.removeItem("masterlist");
    closeModal();
  }

  function disconnectSheet() {
    if (prompt("Enter admin password to disconnect sheet:") !== ADMIN_PASSWORD) return;
    clearLiveConnection();
  }

  function clearLiveConnection() {
    localStorage.removeItem("connectedEventId");
    localStorage.removeItem("connectedPassword");
    setEventId("");
    setPassword("");
    setIsLiveMode(false);
    setMasterlist(getInitial("masterlist", []));
  }

  function leaveApp() {
    if (isLiveMode && !confirm("Leave this live event and disconnect this device?")) return;
    if (isLiveMode) clearLiveConnection();
    onExit?.();
  }

  function unlockOperatorIdentityField() {
    if (prompt("Enter admin credentials to modify the tracking UID:") === ADMIN_PASSWORD) {
      setIdentityUnlocked(true);
    } else {
      alert("Unauthorized action.");
    }
  }

  function updateDeviceIdentity(value) {
    if (!value.trim()) return;
    localStorage.setItem("operatorIdentityName", value.trim());
    setDeviceId(value.trim());
  }

  function toggleGridSetting(type, field, checked) {
    const next = { ...settings, [type]: [...(settings[type] || [])] };
    if (checked) {
      next[type] = type === "notificationColumns" ? [field] : [...new Set([...next[type], field])];
    } else {
      if (type === "showColumns" && next.showColumns.length <= 1) {
        alert("At least one masterlist column must remain selected.");
        return;
      }
      if (type === "notificationColumns" && next.notificationColumns.length <= 1) {
        alert("At least one notification column must remain selected.");
        return;
      }
      next[type] = next[type].filter((item) => item !== field);
    }
    saveSettings(next);
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <button className="brand-lockup brand-button" onClick={leaveApp} aria-label="Back to Dalo home">
          <span className="app-wordmark">Dalo<i aria-hidden="true" /></span>
        </button>
        <div className="header-controls">
          <div className={`mode-pill ${isLiveMode ? "live" : ""}`}>{isLiveMode ? "Live" : "Local"} Mode | {deviceId}</div>
          <nav className="top-actions" aria-label="Primary actions">
            <button className="ghost-button icon-label" onClick={() => openModal("settings", "System Configuration")}>
              <Settings size={18} /> Settings
            </button>
            <button className="success-button icon-label" onClick={() => openModal("masterlist", "Masterlist Records")}>
              <ListChecks size={18} /> Masterlist
            </button>
          </nav>
        </div>
      </header>

      <section className="checkin-area" aria-labelledby="checkin-title">
        {counters.total > 0 && (
          <div className="front-dashboard">
            <Stat title="Total" value={counters.total} />
            <Stat title="Checked" value={counters.checked} tone="green" />
            <Stat title="Pending" value={counters.pending} tone="orange" />
            <Stat title="Attendance" value={`${counters.rate}%`} tone="blue" />
          </div>
        )}
        <div className="checkin-panel">
          <div className="brand-mark hero-mark" aria-hidden="true">D</div>
          <div>
            <p className="eyebrow">Dalo</p>
            <h1 id="checkin-title">My Presence /  Attendance</h1>
          </div>
          <form onSubmit={checkName} className="search-form">
            <div className="search-box">
              <Search size={20} />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Enter guest details..."
                autoComplete="off"
              />
            </div>
            <button className="primary-button" type="submit">
              <Check size={19} /> Check
            </button>
          </form>
          <button
            className="scan-button scan-button-wide"
            type="button"
            onClick={() => openModal("scanner", "Scan Guest QR Code")}
          >
            <ScanLine size={19} /> Scan QR
          </button>
        </div>
      </section>

      <footer className="footer">
        Powered by: <a href="https://broadimagi.com" target="_blank" rel="noreferrer">Broadimagi</a>
      </footer>

      <input ref={csvInputRef} type="file" hidden accept=".csv" onChange={loadCsv} />
      <input ref={bgInputRef} type="file" hidden accept="image/*" onChange={handleBackgroundUpload} />

      <ToastStack items={toastItems} />
      {modal && (
        <Modal title={modal.title} onClose={closeModal}>
          {modal.type === "message" && <MessageModal message={modal.message} />}
          {modal.type === "scanner" && <QrScanner onScan={handleQrScan} />}
          {modal.type === "suggestions" && (
            <SuggestionsModal
              matches={modal.matches}
              columns={dataColumns(settings.suggestionColumns)}
              onSelect={selectSuggestion}
              isChecked={isChecked}
            />
          )}
          {modal.type === "confirmation" && (
            <ConfirmationModal
              row={masterlist[modal.guestIndex]}
              columns={dataColumns(settings.confirmColumns)}
              checked={isChecked(masterlist[modal.guestIndex])}
              onBack={() => checkName({ preventDefault() {} })}
              onConfirm={checkIn}
            />
          )}
          {modal.type === "success" && (
            <SuccessModal row={masterlist[modal.guestIndex]} columns={dataColumns(settings.confirmColumns)} time={modal.time} onDone={afterCheckIn} />
          )}
          {modal.type === "settings" && (
            <SettingsModal
              headers={headers}
              settings={settings}
              eventId={eventId}
              password={password}
              isLiveMode={isLiveMode}
              showEventConnection={!forceLocal}
              deviceId={deviceId}
              identityUnlocked={identityUnlocked}
              hasImageBackground={hasImageBackground}
              onDeviceChange={updateDeviceIdentity}
              onUnlock={unlockOperatorIdentityField}
              onColorChange={applyColorEngine}
              onWallpaper={() => bgInputRef.current?.click()}
              onClearWallpaper={clearImageBackground}
              onEventId={setEventId}
              onPassword={setPassword}
              onConnect={() => fetchLiveMasterlist(eventId, password)}
              onDisconnect={disconnectSheet}
              onUpload={() => csvInputRef.current?.click()}
              onToggle={toggleGridSetting}
            />
          )}
          {modal.type === "masterlist" && (
            <MasterlistModal
              rows={masterlist}
              columns={dataColumns(settings.showColumns)}
              counters={counters}
              isLiveMode={isLiveMode}
              isChecked={isChecked}
              onDownload={download}
              onReset={resetAll}
              onClear={clearAllData}
            />
          )}
        </Modal>
      )}
    </main>
  );
}

function Stat({ title, value, tone = "" }) {
  return (
    <div className={`front-stat ${tone}`}>
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function MessageModal({ message }) {
  return <p className="modal-message">{message}</p>;
}

function QrScanner({ onScan }) {
  const videoRef = useRef(null);
  const onScanRef = useRef(onScan);
  const [status, setStatus] = useState("Starting camera...");

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    let controls;
    let stopped = false;

    async function startScanner() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("Camera access is not available on this device.");
        return;
      }

      try {
        const reader = new BrowserQRCodeReader(undefined, {
          delayBetweenScanAttempts: 180
        });
        setStatus("Point the camera at the guest QR code.");
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } }, audio: false },
          videoRef.current,
          (result, _error, scanControls) => {
            const value = result?.getText()?.trim();
            if (!value || stopped) return;
            stopped = true;
            scanControls.stop();
            onScanRef.current(value);
          }
        );
        if (stopped) controls.stop();
      } catch (error) {
        const denied = error?.name === "NotAllowedError";
        setStatus(denied
          ? "Camera permission was denied. Allow camera access and try again."
          : "The camera could not be opened. Please try again or use the search field.");
      }
    }

    startScanner();
    return () => {
      stopped = true;
      controls?.stop();
    };
  }, []);

  return (
    <div className="qr-scanner">
      <div className="qr-video-wrap">
        <video ref={videoRef} className="qr-video" playsInline muted />
        <div className="qr-guide" aria-hidden="true" />
      </div>
      <p className="qr-status">{status}</p>
    </div>
  );
}

function SuggestionsModal({ matches, columns, onSelect, isChecked }) {
  return (
    <div className="suggestion-list">
      {matches.map(({ row, index }) => (
        <button key={index} className="suggestion-card" onClick={() => onSelect(index)}>
          <div className="suggestion-grid" style={{ "--columns": columns.length || 1 }}>
            {columns.map((column) => (
              <div key={column}>
                <span>{column}</span>
                <strong>{row[column] || "-"}</strong>
              </div>
            ))}
          </div>
          <em>{isChecked(row) ? "Already Checked-In" : "Tap to Verify & Check-In"}</em>
        </button>
      ))}
    </div>
  );
}

function ConfirmationModal({ row, columns, checked, onBack, onConfirm }) {
  return (
    <div className="confirm-layout">
      <GuestFields row={row} columns={columns} />
      {checked ? (
        <div className="blocked-note">
          <strong>Already checked in</strong>
          <span>{row.Time || row.time || "No timestamp."}</span>
        </div>
      ) : (
        <button className="primary-button confirm-button" onClick={onConfirm}>
          <Check size={20} /> Confirm Check-In
        </button>
      )}
      <button className="subtle-button" onClick={onBack}>
        <ChevronLeft size={18} /> Go Back
      </button>
    </div>
  );
}

function SuccessModal({ row, columns, time, onDone }) {
  return (
    <div className="success-layout">
      <div className="success-icon"><Check size={38} /></div>
      <p>Guest is now verified and recorded.</p>
      <GuestFields row={row} columns={columns} />
      <div className="status-strip">
        <span>Checked In</span>
        <strong>{time}</strong>
      </div>
      <button className="primary-button confirm-button" onClick={onDone}>Dismiss & Next Guest</button>
    </div>
  );
}

function GuestFields({ row = {}, columns }) {
  return (
    <div className="guest-fields" style={{ "--columns": columns.length || 1 }}>
      {columns.map((column) => (
        <div key={column}>
          <span>{column}</span>
          <strong>{row[column] || "-"}</strong>
        </div>
      ))}
    </div>
  );
}

function SettingsModal(props) {
  const {
    headers,
    settings,
    eventId,
    password,
    isLiveMode,
    showEventConnection,
    deviceId,
    identityUnlocked,
    hasImageBackground,
    onDeviceChange,
    onUnlock,
    onColorChange,
    onWallpaper,
    onClearWallpaper,
    onEventId,
    onPassword,
    onConnect,
    onDisconnect,
    onUpload,
    onToggle
  } = props;

  return (
    <div className="settings-layout">
      <div className="settings-grid">
        <label>
          <span>Tracking UID</span>
          <div className="inline-control">
            <input value={deviceId} disabled={!identityUnlocked} onChange={(event) => onDeviceChange(event.target.value)} />
            {!identityUnlocked && <button onClick={onUnlock}><Lock size={16} /> Unlock</button>}
          </div>
        </label>
        <label>
          <span>Brand Color</span>
          <div className="inline-control">
            <input className="color-input" type="color" value={settings.currentThemeColor} onChange={(event) => onColorChange(event.target.value)} />
            <button onClick={onWallpaper}><Upload size={16} /> Wallpaper</button>
            {hasImageBackground && <button className="danger-lite" onClick={onClearWallpaper}>Clear</button>}
          </div>
        </label>
      </div>

      {showEventConnection && (
        <div className="settings-grid event-grid">
          <input value={eventId} onChange={(event) => onEventId(event.target.value)} placeholder="Event ID" />
          <input value={password} onChange={(event) => onPassword(event.target.value)} type="password" placeholder="Password" />
          <button className="primary-button" onClick={onConnect}><Link size={18} /> Link Event</button>
          {eventId && <button className="danger-button" onClick={onDisconnect}>Disconnect</button>}
        </div>
      )}

      {!isLiveMode && (
        <button className="upload-button" onClick={onUpload}>
          <FileUp size={18} /> Upload Local CSV
        </button>
      )}

      <div className="settings-table-wrap">
        <table className="settings-table">
          <thead>
            <tr>
              <th>Column</th>
              <th>Masterlist</th>
              <th>Suggestions</th>
              <th>Confirm</th>
              <th>Notify</th>
            </tr>
          </thead>
          <tbody>
            {headers.length ? headers.map((header) => (
              <tr key={header}>
                <td>{header}</td>
                {["showColumns", "suggestionColumns", "confirmColumns", "notificationColumns"].map((type) => (
                  <td key={type}>
                    <input
                      type="checkbox"
                      checked={settings[type]?.includes(header)}
                      onChange={(event) => onToggle(type, header, event.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            )) : (
              <tr><td colSpan="5">No database columns loaded.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MasterlistModal({ rows, columns, counters, isLiveMode, isChecked, onDownload, onReset, onClear }) {
  if (!rows.length) return <MessageModal message="No uploaded records mapped." />;
  return (
    <div className="masterlist-layout">
      <div className="dashboard">
        <Stat title="Total Records" value={counters.total} />
        <Stat title="Checked-In" value={counters.checked} tone="green" />
        <Stat title="Pending" value={counters.pending} tone="orange" />
        <Stat title="Attendance" value={`${counters.rate}%`} tone="blue" />
      </div>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              {columns.map((column) => <th key={column}>{column}</th>)}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => <td key={column}>{row[column] || "-"}</td>)}
                <td>{isChecked(row) ? <span className="badge success">Checked</span> : <span className="badge pending">Pending</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isLiveMode ? (
        <p className="sync-note">Realtime cloud connection active. Auto-syncing every 15 seconds.</p>
      ) : (
        <div className="masterlist-actions">
          <button className="primary-button" onClick={onDownload}><Download size={18} /> Export CSV</button>
          <button className="subtle-button" onClick={onReset}><RefreshCw size={18} /> Clear Statuses</button>
          <button className="danger-button" onClick={onClear}><Trash2 size={18} /> Purge Lists</button>
        </div>
      )}
    </div>
  );
}

function ToastStack({ items }) {
  return (
    <div className="toast-stack">
      {items.map((item) => (
        <div key={item.id} className="toast"><span /> <strong>{item.label}</strong> checked in</div>
      ))}
    </div>
  );
}

const navigate = (path, state = {}) => {
  window.history.pushState(state, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "smooth" });
};

function PublicHeader() {
  return (
    <header className="site-header">
      <button className="site-brand" onClick={() => navigate("/")} aria-label="Dalo home">
        <span>D</span><strong>Dalo</strong>
      </button>
      <nav aria-label="Main navigation">
        <button onClick={() => navigate("/features")}>Features</button>
        <button onClick={() => { navigate("/"); setTimeout(() => document.getElementById("how-it-works")?.scrollIntoView(), 0); }}>How it works</button>
        <button onClick={() => navigate("/pricing")}>Pricing</button>
        <button className="nav-app" onClick={() => navigate("/app/local")}>Open app</button>
      </nav>
    </header>
  );
}

function HomePage() {
  const [eventId, setEventId] = useState("");
  const startOnline = (event) => {
    event.preventDefault();
    if (eventId.trim()) navigate(`/app/auth?event=${encodeURIComponent(eventId.trim())}`);
  };
  return (
    <main className="marketing-page">
      <PublicHeader />
      <section className="hero-section">
        <form className="hero-event-form" onSubmit={startOnline}>
          <label htmlFor="event-id">Enter Event ID</label>
          <input id="event-id" value={eventId} onChange={(e) => setEventId(e.target.value)} placeholder="EVENT ID" autoComplete="off" aria-label="Event ID" />
          <button disabled={!eventId.trim()} aria-label="Continue"><ArrowRight size={20} /></button>
        </form>
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="site-eyebrow">Enterprise attendance</p>
            <h1>Dalo — My Attendance / My Presence</h1>
            <p className="hero-lede">Eliminate paper sign-in sheets and manual data entry. Dalo provides fast, secure digital attendance tracking for enterprise events, conferences, and organizational meetings.</p>
            <div className="hero-actions">
              <a className="site-primary" href="mailto:hello@broadimagi.com?subject=Dalo%20demo">Request demo</a>
              <button className="site-secondary" onClick={() => navigate("/app/local")}>Use it for free</button>
            </div>
          </div>
          <figure className="digital-visual"><img src="/dalo-digital-attendance.png" alt="Laptop and mobile devices displaying synchronized digital attendance information" /></figure>
        </div>
      </section>
      <section className="home-solution" id="how-it-works">
        <p className="site-eyebrow">How it works</p>
        <h2>One system. Two modes.</h2>
        <div className="solution-grid">
          <article><MonitorSmartphone /><small>Local mode</small><h3>Simple and self-contained.</h3><p>Import a CSV and run attendance from a single device—even without an internet connection.</p><button onClick={() => navigate("/app/local")}>Start locally <ArrowRight size={16} /></button></article>
          <article><Sparkles /><small>Online mode</small><h3>Everyone stays in sync.</h3><p>Connect multiple check-in devices to one live guest list, with instant attendance updates.</p><button onClick={() => document.getElementById("event-id")?.focus()}>Join an event <ArrowRight size={16} /></button></article>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}

function AuthPage() {
  const eventId = new URLSearchParams(window.location.search).get("event") || "";
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "" });
  const submit = async (event) => {
    event.preventDefault();
    if (!eventId || !password) return;
    setStatus({ loading: true, error: "" });
    try {
      const response = await fetch(`${API_URL}?eventId=${encodeURIComponent(eventId)}&password=${encodeURIComponent(password)}`);
      const payload = normalizeLivePayload(await response.json());
      if (payload.error || !isRouterActive(payload.router)) {
        setStatus({ loading: false, error: payload.error || "This event is currently inactive." });
        return;
      }
      localStorage.setItem("connectedEventId", eventId);
      localStorage.setItem("connectedPassword", password);
      navigate(`/app/${encodeURIComponent(eventId)}`, { eventPassword: password });
    } catch {
      setStatus({ loading: false, error: "We couldn't reach this event. Check your connection and try again." });
    }
  };
  return (
    <main className="auth-page">
      <PublicHeader />
      <section className="auth-shell">
        <button className="back-link" onClick={() => navigate("/")}><ChevronLeft size={17} /> Back to home</button>
        <div className="auth-card">
          <div className="access-icon"><Lock size={23} /></div>
          <p className="card-kicker">Secure event access</p>
          <h1>One last step.</h1>
          <p>Enter the password for <strong>{eventId || "this event"}</strong> to open its live attendance workspace.</p>
          <form onSubmit={submit}>
            <label htmlFor="event-password">Event password</label>
            <input id="event-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter event password" autoFocus />
            {status.error && <p className="auth-error" role="alert">{status.error}</p>}
            <button className="site-primary" disabled={!eventId || !password || status.loading}>{status.loading ? "Verifying…" : "Verify and enter"} {!status.loading && <ArrowRight size={18} />}</button>
          </form>
          <span className="secure-note"><ShieldCheck size={16} /> Your credentials are used only to connect to this event.</span>
        </div>
      </section>
    </main>
  );
}

const featureCards = [
  [QrCode, "Fast guest check-in", "Find guests by name or scan their QR code, then confirm attendance in seconds."],
  [MonitorSmartphone, "Local-first reliability", "Upload a CSV and keep check-in moving from one device, even when the venue connection is unreliable."],
  [RefreshCw, "Live multi-device sync", "Give every entrance the same up-to-date guest list and prevent accidental duplicate check-ins."],
  [BarChart3, "Attendance at a glance", "See totals, checked-in guests, pending arrivals, and attendance rate as the event unfolds."],
  [Settings, "Flexible guest fields", "Choose which columns appear in search, confirmation, notifications, and your masterlist."],
  [Sparkles, "An event that feels yours", "Personalize colors and background imagery to match your organization, venue, or event identity."]
];

function FeaturesPage() {
  return <main className="marketing-page"><PublicHeader /><section className="page-intro"><p className="site-eyebrow"><span /> Designed for the door</p><h1>Less queue. More welcome.</h1><p>Dalo keeps the mechanics of attendance out of the way, so your team can focus on the people arriving.</p></section><section className="feature-grid">{featureCards.map(([Icon, title, copy]) => <article key={title}><div><Icon size={23} /></div><h2>{title}</h2><p>{copy}</p></article>)}</section><section className="page-cta"><div><p className="card-kicker">Ready when your doors open</p><h2>Start with the setup that fits your event.</h2></div><button className="site-primary" onClick={() => navigate("/app/local")}>Open local app <ArrowRight size={18} /></button></section><SiteFooter /></main>;
}

const plans = [
  ["Essential", "₱999", "per event", "Up to 100 participants", ["Personalized event workspace", "Live multi-device attendance", "QR and name check-in", "Attendance export"]],
  ["Team", "₱1,449", "per event", "Up to 150 participants", ["Everything in Essential", "More room for growing events", "Live attendance overview", "Custom guest fields"]],
  ["Unlimited", "₱1,999", "per event", "Unlimited participants", ["Everything in Team", "No participant cap", "Best for conferences and large events", "Priority event setup"]]
];

function PricingPage() {
  return <main className="marketing-page"><PublicHeader /><section className="page-intro pricing-intro"><p className="site-eyebrow"><span /> Straightforward event pricing</p><h1>Personalize one event.<br />Pay for only that event.</h1><p>For organizations that want a branded, connected attendance experience without a long-term subscription.</p></section><section className="pricing-grid">{plans.map(([name, price, cadence, capacity, items], index) => <article className={index === 1 ? "featured-plan" : ""} key={name}>{index === 1 && <span className="popular">Most popular</span>}<p className="card-kicker">{name}</p><h2>{price}</h2><span className="cadence">{cadence}</span><strong>{capacity}</strong><ul>{items.map(item => <li key={item}><Check size={16} />{item}</li>)}</ul><a href="mailto:hello@broadimagi.com?subject=Dalo%20event%20pricing">Personalize my event <ArrowRight size={17} /></a></article>)}</section><p className="pricing-note">Need help choosing? Tell us about your event and we’ll recommend the right fit.</p><SiteFooter /></main>;
}

function SiteFooter() {
  return <footer className="site-footer"><div className="site-brand"><span>D</span><strong>Dalo</strong></div><p>Attendance that feels effortless.</p><div><button onClick={() => navigate("/features")}>Features</button><button onClick={() => navigate("/pricing")}>Pricing</button><a href="https://broadimagi.com" target="_blank" rel="noreferrer">Broadimagi</a></div></footer>;
}

function DaloSite() {
  const [location, setLocation] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => {
    const currentPath = location.split("?")[0];
    const update = () => {
      const nextLocation = window.location.pathname + window.location.search;
      const nextPath = window.location.pathname;
      const leavingLiveEvent =
        currentPath.startsWith("/app/") &&
        currentPath !== "/app/local" &&
        nextPath !== currentPath &&
        !!localStorage.getItem("connectedEventId");
      if (leavingLiveEvent && !confirm("Leave this live event and disconnect this device?")) {
        window.history.forward();
        return;
      }
      if (leavingLiveEvent) {
        localStorage.removeItem("connectedEventId");
        localStorage.removeItem("connectedPassword");
      }
      setLocation(nextLocation);
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, [location]);
  const path = location.split("?")[0].replace(/\/docs\/?$/, "/");
  if (path === "/features") return <FeaturesPage />;
  if (path === "/pricing") return <PricingPage />;
  if (path === "/app/auth") return <AuthPage />;
  if (path === "/app/local") return <AttendanceApp forceLocal onExit={() => navigate("/")} />;
  if (path.startsWith("/app/")) {
    const id = decodeURIComponent(path.slice(5));
    const queryPassword = new URLSearchParams(window.location.search).get("password") || "";
    const savedEventId = localStorage.getItem("connectedEventId") || "";
    const savedPassword = savedEventId === id ? localStorage.getItem("connectedPassword") || "" : "";
    const pass = window.history.state?.eventPassword || queryPassword || savedPassword;
    if (queryPassword) window.history.replaceState({ eventPassword: queryPassword }, "", `/app/${encodeURIComponent(id)}`);
    return <AttendanceApp initialEventId={id} initialPassword={pass} onExit={() => navigate("/")} />;
  }
  return <HomePage />;
}

createRoot(document.getElementById("root")).render(<DaloSite />);
