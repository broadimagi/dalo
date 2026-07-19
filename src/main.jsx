import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserQRCodeReader } from "@zxing/browser";
import {
  Check,
  ChevronLeft,
  Download,
  FileUp,
  Link,
  ListChecks,
  Lock,
  RefreshCw,
  ScanLine,
  Search,
  Settings,
  Trash2,
  Upload,
  X
} from "lucide-react";
import "./styles.css";

const API_URL =
  "https://script.google.com/macros/s/AKfycbzbldkFxSfXMB9n1cjhShA39_oBMdk7sAOlxhWLUjqpb2mazdRQ7MKo3K-pGMX9PJUZ5w/exec";
const DEFAULT_THEME_COLOR = "#7dd3fc";
const ADMIN_PASSWORD = "Broadimagi";
const RESERVED_COLUMNS = ["rowId", "Status", "Time", "UID", "status", "time"];

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

function App() {
  const [masterlist, setMasterlist] = useState(() => getInitial("masterlist", []));
  const [settings, setSettings] = useState(() => {
    const savedSettings = {
      ...defaultSettings,
      ...getInitial("settings", defaultSettings)
    };
    if (savedSettings.currentThemeColor === "#3b82f6") {
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
  const [eventId, setEventId] = useState(() => localStorage.getItem("connectedEventId") || "");
  const [password, setPassword] = useState(() => localStorage.getItem("connectedPassword") || "");
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
    if (eventId && password) fetchLiveMasterlist(eventId, password, true);
  }, []);

  useEffect(() => {
    const interval = setInterval(runBackgroundSyncHeartbeat, 15000);
    return () => clearInterval(interval);
  }, [isLiveMode, modal, eventId, password, masterlist, settings]);

  const dataColumns = (preferred) => {
    if (preferred?.length) return preferred;
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
    const lightBackground = 0.299 * r + 0.587 * g + 0.114 * b > 155;
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const delta = max - min;
    let hue = 0;
    if (delta) {
      if (max === r / 255) hue = 60 * (((g - b) / 255 / delta) % 6);
      else if (max === g / 255) hue = 60 * ((b - r) / 255 / delta + 2);
      else hue = 60 * ((r - g) / 255 / delta + 4);
    }
    hue = (hue + 360) % 360;
    const lightness = (max + min) / 2;
    const saturation = Math.round(
      delta ? (delta / (1 - Math.abs(2 * lightness - 1))) * 100 : 0
    );
    const companionLightness = lightBackground
      ? Math.max(22, Math.round(lightness * 100) - 30)
      : Math.min(74, Math.round(lightness * 100) + 24);
    document.documentElement.style.setProperty(
      "--bg-gradient",
      `linear-gradient(135deg, rgb(${r}, ${g}, ${b}) 0%, hsl(${hue}, ${saturation}%, ${companionLightness}%) 100%)`
    );
    document.body.style.backgroundImage = "";
    document.body.classList.toggle("bg-light-contrast", lightBackground);
    document.body.classList.toggle("bg-dark-contrast", !lightBackground);
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
      const data = await response.json();
      if (data.error) {
        setIsLiveMode(false);
        openModal("message", "Access Denied", { message: `Google API Error: ${data.error}` });
        return;
      }
      localStorage.setItem("connectedEventId", nextEventId);
      localStorage.setItem("connectedPassword", nextPassword);
      setEventId(nextEventId);
      setPassword(nextPassword);
      ensureDefaultColumnSettings(data);
      setMasterlist(data);
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
      const freshData = await response.json();
      if (!Array.isArray(freshData)) return;
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
        const freshestData = await verifyResponse.json();
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
    const columns = settings.notificationColumns?.length ? settings.notificationColumns : dataColumns(settings.showColumns);
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
    localStorage.removeItem("connectedEventId");
    localStorage.removeItem("connectedPassword");
    setEventId("");
    setPassword("");
    setIsLiveMode(false);
    setMasterlist(getInitial("masterlist", []));
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
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">D</div>
          <div>
            <div className="header-title">Dalo</div>
            <div className="header-kicker">My Presence / Attendance</div>
          </div>
        </div>
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
            <button
              className="scan-button"
              type="button"
              onClick={() => openModal("scanner", "Scan Guest QR Code")}
            >
              <ScanLine size={19} /> Scan QR
            </button>
          </form>
          <button className="subtle-button" onClick={() => setQuery("")}>
            <RefreshCw size={17} /> Refresh
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

      <div className="settings-grid event-grid">
        <input value={eventId} onChange={(event) => onEventId(event.target.value)} placeholder="Event ID" />
        <input value={password} onChange={(event) => onPassword(event.target.value)} type="password" placeholder="Password" />
        <button className="primary-button" onClick={onConnect}><Link size={18} /> Link Event</button>
        {eventId && <button className="danger-button" onClick={onDisconnect}>Disconnect</button>}
      </div>

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

createRoot(document.getElementById("root")).render(<App />);
