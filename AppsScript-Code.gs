const ROUTER_SHEET_NAME = "MasterRouter";
const CHECK_IN_LOG_SHEET_NAME = "CheckInLog";
const CHECKED_IN_STATUS = "Checked-in";

const REQUIRED_ROUTER_HEADERS = [
  "eventID",
  "eventName",
  "spreadsheetLink",
  "eventPassword",
  "eventTheme",
  "syncTime",
  "notificationTime",
  "isActive",
  "masterlist",
  "suggestions",
  "confirm",
  "notify",
  "qrKey",
  "qrActive"
];

const DEFAULT_SYNC_SECONDS = 600;
const DEFAULT_NOTIFICATION_SECONDS = 15;
const MIN_SYNC_SECONDS = 15;
const MIN_NOTIFICATION_SECONDS = 5;
const MAX_INTERVAL_SECONDS = 3600;

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function findHeaderIndex(headers, targetHeader) {
  const target = String(targetHeader).trim().toLowerCase();
  return headers.findIndex(function (header) {
    return String(header).trim().toLowerCase() === target;
  });
}

function parseIsActive(value) {
  if (value === true) return true;
  return String(value).trim().toLowerCase() === "true";
}

function normalizeInterval(value, fallback, minimum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(
    MAX_INTERVAL_SECONDS,
    Math.max(minimum, Math.round(parsed))
  );
}

function extractSpreadsheetId(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  if (input.includes("docs.google.com/spreadsheets")) {
    const match = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) return match[1];
  }
  return input;
}

function isCheckedIn(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  return normalized === "checked" || normalized === "checked-in";
}

function getRouterRecord(eventId, password) {
  if (!eventId || !password) {
    throw new Error("Missing Event ID or Password authorization parameters.");
  }

  const container = SpreadsheetApp.getActiveSpreadsheet();
  const routerSheet = container.getSheetByName(ROUTER_SHEET_NAME);
  if (!routerSheet) throw new Error("MasterRouter sheet could not be found.");

  const lastRow = routerSheet.getLastRow();
  const lastColumn = routerSheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) {
    throw new Error("MasterRouter does not contain any event records.");
  }

  const data = routerSheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = data[0].map(function (header) {
    return String(header).trim();
  });
  const indexes = {};

  REQUIRED_ROUTER_HEADERS.forEach(function (header) {
    const index = findHeaderIndex(headers, header);
    if (index === -1) {
      throw new Error("Missing required MasterRouter column: " + header);
    }
    indexes[header] = index;
  });

  const requestedEventId = String(eventId).trim();
  const requestedPassword = String(password).trim();
  let eventFound = false;
  let matchedRow = null;

  for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
    const row = data[rowIndex];
    if (String(row[indexes.eventID]).trim() !== requestedEventId) continue;
    eventFound = true;
    if (String(row[indexes.eventPassword]).trim() === requestedPassword) {
      matchedRow = row;
      break;
    }
  }

  if (!eventFound) throw new Error("Event ID could not be found.");
  if (!matchedRow) throw new Error("Authentication failed. Invalid password.");

  const isActive = parseIsActive(matchedRow[indexes.isActive]);
  if (!isActive) {
    throw new Error("This event is inactive and cannot be connected.");
  }

  const spreadsheetId = extractSpreadsheetId(
    matchedRow[indexes.spreadsheetLink]
  );
  if (!spreadsheetId) {
    throw new Error("No spreadsheet link is configured for this event.");
  }

  return {
    spreadsheetId: spreadsheetId,
    router: {
      eventName: String(matchedRow[indexes.eventName] || "").trim(),
      eventTheme: matchedRow[indexes.eventTheme],
      syncTime: normalizeInterval(
        matchedRow[indexes.syncTime],
        DEFAULT_SYNC_SECONDS,
        MIN_SYNC_SECONDS
      ),
      notificationTime: normalizeInterval(
        matchedRow[indexes.notificationTime],
        DEFAULT_NOTIFICATION_SECONDS,
        MIN_NOTIFICATION_SECONDS
      ),
      isActive: isActive,
      masterlist: matchedRow[indexes.masterlist],
      suggestions: matchedRow[indexes.suggestions],
      confirm: matchedRow[indexes.confirm],
      notify: matchedRow[indexes.notify],
      qrKey: matchedRow[indexes.qrKey],
      qrActive: parseIsActive(matchedRow[indexes.qrActive])
    }
  };
}

function getEventSheet(eventId, password) {
  const route = getRouterRecord(eventId, password);
  let spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(route.spreadsheetId);
  } catch (error) {
    throw new Error(
      "Target guest spreadsheet could not be opened. " +
      "Check the link and sharing permissions."
    );
  }

  const sheet = spreadsheet.getSheets().find(function (candidate) {
    return candidate.getName() !== CHECK_IN_LOG_SHEET_NAME;
  });
  if (!sheet) {
    throw new Error("The target spreadsheet does not contain a guest sheet.");
  }

  return {
    sheet: sheet,
    router: route.router
  };
}

function getCheckInLogSheet(eventSheet, createIfMissing) {
  const spreadsheet = eventSheet.getParent();
  let logSheet = spreadsheet.getSheetByName(CHECK_IN_LOG_SHEET_NAME);

  if (!logSheet && createIfMissing) {
    logSheet = spreadsheet.insertSheet(CHECK_IN_LOG_SHEET_NAME);
    logSheet.appendRow([
      "rowId",
      "guestKey",
      "status",
      "time",
      "operator",
      "requestId"
    ]);
    logSheet.setFrozenRows(1);
  }
  return logSheet;
}

function getUpdateCursor(eventSheet) {
  const logSheet = getCheckInLogSheet(eventSheet, false);
  return logSheet ? Math.max(1, logSheet.getLastRow()) : 0;
}

function getRecentUpdates(eventSheet, after) {
  const logSheet = getCheckInLogSheet(eventSheet, false);
  if (!logSheet) return { updates: [], updateCursor: 0 };

  const lastRow = logSheet.getLastRow();
  const cursor = Math.max(1, Number(after) || 1);
  if (cursor >= lastRow) {
    return { updates: [], updateCursor: lastRow };
  }

  const startRow = cursor + 1;
  const values = logSheet
    .getRange(startRow, 1, lastRow - cursor, 6)
    .getValues();
  const updates = values.map(function (row) {
    return {
      rowId: row[0],
      guestKey: row[1],
      status: row[2],
      time: row[3],
      operator: row[4],
      requestId: row[5]
    };
  });

  return {
    updates: updates,
    updateCursor: lastRow
  };
}

function findLoggedRequest(eventSheet, requestId) {
  if (!requestId) return null;
  const logSheet = getCheckInLogSheet(eventSheet, false);
  if (!logSheet || logSheet.getLastRow() < 2) return null;

  const match = logSheet
    .getRange(2, 6, logSheet.getLastRow() - 1, 1)
    .createTextFinder(String(requestId))
    .matchEntireCell(true)
    .findNext();
  if (!match) return null;

  const rowNumber = match.getRow();
  const row = logSheet.getRange(rowNumber, 1, 1, 6).getValues()[0];
  return {
    success: true,
    status: row[2],
    time: row[3],
    operator: row[4],
    updateCursor: rowNumber
  };
}

function doGet(e) {
  try {
    const parameters = e && e.parameter ? e.parameter : {};
    const eventId = parameters.eventId || "";
    const password = parameters.password || "";
    const action = String(parameters.action || "").trim().toLowerCase();
    const context = getEventSheet(eventId, password);
    const sheet = context.sheet;

    if (action === "updates") {
      return jsonResponse(getRecentUpdates(sheet, parameters.after));
    }

    const updateCursor = getUpdateCursor(sheet);
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    if (lastRow < 1 || lastColumn < 1) {
      return jsonResponse({
        rows: [],
        headers: [],
        router: context.router,
        updateCursor: updateCursor
      });
    }

    const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
    const headers = values[0].map(function (header) {
      return String(header).trim();
    });
    const rows = [];

    for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
      const sourceRow = values[rowIndex];
      const hasData = sourceRow.some(function (value) {
        return value !== "" && value !== null;
      });
      if (!hasData) continue;

      const record = { rowId: rowIndex + 1 };
      headers.forEach(function (header, columnIndex) {
        if (header) record[header] = sourceRow[columnIndex];
      });
      rows.push(record);
    }

    return jsonResponse({
      rows: rows,
      headers: headers,
      router: context.router,
      updateCursor: updateCursor
    });
  } catch (error) {
    return jsonResponse({ error: error.message || String(error) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(5000)) {
      throw new Error("Another check-in is being processed. Please try again.");
    }
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("Missing check-in request data.");
    }

    const params = JSON.parse(e.postData.contents);
    const context = getEventSheet(params.eventId, params.password);
    const sheet = context.sheet;

    const previousResult = findLoggedRequest(sheet, params.requestId);
    if (previousResult) return jsonResponse(previousResult);

    let lastColumn = sheet.getLastColumn();
    if (lastColumn < 1) {
      throw new Error("The guest sheet does not contain headers.");
    }

    const headers = sheet
      .getRange(1, 1, 1, lastColumn)
      .getValues()[0]
      .map(function (header) {
        return String(header).trim();
      });

    let statusColumn = findHeaderIndex(headers, "Status") + 1;
    let timeColumn = findHeaderIndex(headers, "Time") + 1;
    let uidColumn = findHeaderIndex(headers, "UID") + 1;

    if (statusColumn === 0) {
      lastColumn++;
      sheet.getRange(1, lastColumn).setValue("Status");
      statusColumn = lastColumn;
      headers.push("Status");
    }
    if (timeColumn === 0) {
      lastColumn++;
      sheet.getRange(1, lastColumn).setValue("Time");
      timeColumn = lastColumn;
      headers.push("Time");
    }
    if (uidColumn === 0) {
      lastColumn++;
      sheet.getRange(1, lastColumn).setValue("UID");
      uidColumn = lastColumn;
      headers.push("UID");
    }

    const rowId = Number(params.rowId);
    const finalRow = sheet.getLastRow();
    if (!Number.isInteger(rowId) || rowId < 2 || rowId > finalRow) {
      throw new Error("Invalid guest row identifier.");
    }

    const currentStatus = sheet.getRange(rowId, statusColumn).getValue();
    if (isCheckedIn(currentStatus)) {
      return jsonResponse({
        success: false,
        code: "ALREADY_CHECKED_IN",
        error: "This guest has already been checked in.",
        time: sheet.getRange(rowId, timeColumn).getValue(),
        operator: sheet.getRange(rowId, uidColumn).getValue()
      });
    }

    const operatorIdentity = String(
      params.operator || "Unknown Device"
    ).trim();
    const checkedAt = new Date();

    sheet.getRange(rowId, statusColumn).setValue(CHECKED_IN_STATUS);
    sheet.getRange(rowId, timeColumn).setValue(checkedAt);
    sheet.getRange(rowId, uidColumn).setValue(operatorIdentity);

    const qrColumn = Number(context.router.qrKey);
    const guestKey =
      Number.isInteger(qrColumn) &&
      qrColumn >= 1 &&
      qrColumn <= sheet.getLastColumn()
        ? sheet.getRange(rowId, qrColumn).getValue()
        : "";

    const logSheet = getCheckInLogSheet(sheet, true);
    logSheet.appendRow([
      rowId,
      guestKey,
      CHECKED_IN_STATUS,
      checkedAt,
      operatorIdentity,
      params.requestId || ""
    ]);
    SpreadsheetApp.flush();

    return jsonResponse({
      success: true,
      status: CHECKED_IN_STATUS,
      time: checkedAt,
      operator: operatorIdentity,
      updateCursor: logSheet.getLastRow()
    });
  } catch (error) {
    return jsonResponse({
      success: false,
      error: error.message || String(error)
    });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}
