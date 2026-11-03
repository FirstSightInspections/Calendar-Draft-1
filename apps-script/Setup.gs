/**
 * One-time / re-runnable setup. Run `setup` from the Apps Script editor
 * (select it in the function drop-down, click Run).
 *
 * It is safe to run again any time — e.g. after adding an inspector row.
 * It will:
 *   1. Create a BRAND-NEW spreadsheet the first time (never touches your
 *      existing sheets — even if this script was opened from one).
 *   2. Create the "Bookings" and "Inspectors" tabs if missing.
 *   3. For each inspector row: fill in an ID, color and access key if
 *      blank, and create a private Google Calendar if no Calendar ID.
 *   4. Create the shared PUBLIC calendar if it doesn't exist.
 * Then check View → Logs (or Execution log) for a summary.
 */
function setup() {
  assertOwner_();
  var props = props_();

  // 1. Spreadsheet
  var ss;
  var ssId = props.getProperty(PROP_SPREADSHEET_ID);
  if (ssId) ss = SpreadsheetApp.openById(ssId);
  if (!ss) ss = SpreadsheetApp.create(NEW_SPREADSHEET_NAME);
  props.setProperty(PROP_SPREADSHEET_ID, ss.getId());

  // 2. Tabs
  var bookings = ss.getSheetByName(SHEET_NAMES.BOOKINGS) || ss.insertSheet(SHEET_NAMES.BOOKINGS);
  ensureHeaders_(bookings, BOOKING_COLUMNS.map(function (c) { return c.label; }));
  var idx = headerIndex_(bookings);
  ['Submitted', 'Start', 'End'].forEach(function (label) {
    if (idx[label] !== undefined) bookings.getRange(2, idx[label] + 1, bookings.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd h:mm am/pm');
  });
  ['Attending Phone'].forEach(function (label) {
    if (idx[label] !== undefined) bookings.getRange(2, idx[label] + 1, bookings.getMaxRows() - 1, 1).setNumberFormat('@');
  });

  var inspectorsSheet = ss.getSheetByName(SHEET_NAMES.INSPECTORS) || ss.insertSheet(SHEET_NAMES.INSPECTORS);
  ensureHeaders_(inspectorsSheet, INSPECTOR_COLUMNS);
  if (inspectorsSheet.getLastRow() < 2) {
    inspectorsSheet.getRange(2, 1, 2, INSPECTOR_COLUMNS.length).setValues([
      ['', 'Inspector A', '', '', '', '', true],
      ['', 'Inspector B', '', '', '', '', true]
    ]);
  }

  // 3. Inspectors: IDs, colors, keys, private calendars
  var ih = headerIndex_(inspectorsSheet);
  var n = inspectorsSheet.getLastRow() - 1;
  var data = inspectorsSheet.getRange(2, 1, n, inspectorsSheet.getLastColumn()).getValues();
  var usedIds = {};
  var log = [];
  data.forEach(function (row, i) {
    var name = String(row[ih['Name']]).trim();
    if (!name) return;
    var id = String(row[ih['ID']]).trim();
    if (!id) {
      id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'inspector';
      while (usedIds[id]) id += '-2';
      row[ih['ID']] = id;
    }
    usedIds[id] = true;
    if (!String(row[ih['Color']]).trim()) row[ih['Color']] = INSPECTOR_COLORS[i % INSPECTOR_COLORS.length];
    if (String(row[ih['Access Key']]).trim().length < 8) row[ih['Access Key']] = randomKey_();
    if (row[ih['Active']] === '') row[ih['Active']] = true;

    var calId = String(row[ih['Private Calendar ID']]).trim();
    if (!calId || !CalendarApp.getCalendarById(calId)) {
      var cal = CalendarApp.createCalendar(CONFIG.COMPANY_NAME + ' — ' + name + ' (private)', {
        timeZone: CONFIG.TIMEZONE,
        color: CalendarApp.Color.BLUE
      });
      row[ih['Private Calendar ID']] = cal.getId();
      log.push('Created private calendar for ' + name + ': ' + cal.getId());
    }
    log.push(name + ' — ID: ' + row[ih['ID']] + ', access key: ' + row[ih['Access Key']]);
  });
  inspectorsSheet.getRange(2, 1, n, data[0].length).setValues(data);
  inspectorCache_ = null;

  // 4. Public calendar
  var pubId = props.getProperty(PROP_PUBLIC_CALENDAR_ID);
  var pub = pubId && CalendarApp.getCalendarById(pubId);
  if (!pub) {
    var existing = CalendarApp.getCalendarsByName(CONFIG.PUBLIC_CALENDAR_NAME);
    pub = existing.length ? existing[0] : CalendarApp.createCalendar(CONFIG.PUBLIC_CALENDAR_NAME, {
      timeZone: CONFIG.TIMEZONE,
      color: CalendarApp.Color.ORANGE
    });
    props.setProperty(PROP_PUBLIC_CALENDAR_ID, pub.getId());
    log.push('Public calendar: ' + pub.getId());
  }

  log.unshift('Spreadsheet: ' + ss.getUrl());
  log.push('Setup complete. Next: Deploy → New deployment → Web app.');
  console.log(log.join('\n'));
  return log.join('\n');
}

function ensureHeaders_(sh, labels) {
  var lastCol = sh.getLastColumn();
  var existing = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  var missing = labels.filter(function (l) { return existing.indexOf(l) === -1; });
  if (!missing.length) return;
  var startCol = existing.filter(String).length ? lastCol + 1 : 1;
  if (startCol === 1) missing = labels;
  sh.getRange(1, startCol, 1, missing.length).setValues([missing]).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function randomKey_() {
  var chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now());
  var out = '';
  for (var i = 0; i < 14; i++) out += chars.charAt((bytes[i] + 256) % chars.length);
  return out.slice(0, 4) + '-' + out.slice(4, 9) + '-' + out.slice(9);
}

/** setup() must only run for the script owner, never from the public page. */
function assertOwner_() {
  var active = Session.getActiveUser().getEmail();
  var owner = Session.getEffectiveUser().getEmail();
  if (!active || active !== owner) throw new Error('Run setup() from the Apps Script editor while signed in as the owner.');
}
