/**
 * Internal helpers: spreadsheet, calendars, dates, email.
 *
 * IMPORTANT: every function in this file ends with "_". Apps Script only
 * lets the web page call top-level functions WITHOUT a trailing
 * underscore, so these helpers can never be called from the browser.
 */

var PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';
var PROP_PUBLIC_CALENDAR_ID = 'PUBLIC_CALENDAR_ID';
var TAG_BOOKING = 'fsi_booking';
var TAG_INSPECTOR = 'fsi_inspector';
var TAG_CITY = 'fsi_city';

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

function fmt_(date, pattern) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, pattern);
}

function todayYmd_() {
  return fmt_(new Date(), 'yyyy-MM-dd');
}

/** Date for "yyyy-MM-dd" + "HH:mm" in the business time zone. */
function at_(ymd, hhmm) {
  return Utilities.parseDate(ymd + ' ' + hhmm, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm');
}

/** Pure string date math (no time zone involved). */
function addDaysYmd_(ymd, n) {
  var p = ymd.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.toISOString().slice(0, 10);
}

function dayOfWeek_(ymd) {
  var p = ymd.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}

function isYmd_(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function slotEnd_(start) {
  return new Date(start.getTime() + CONFIG.SLOT_MINUTES * 60000);
}

/** Can a client book this date + slot right now? (ignores inspector availability) */
function slotBookable_(ymd, hhmm, now) {
  if (!isYmd_(ymd) || CONFIG.SLOTS.indexOf(hhmm) === -1) return false;
  if (CONFIG.WORK_DAYS.indexOf(dayOfWeek_(ymd)) === -1) return false;
  if (ymd > addDaysYmd_(todayYmd_(), CONFIG.HORIZON_DAYS)) return false;
  var earliest = (now || new Date()).getTime() + CONFIG.MIN_NOTICE_HOURS * 3600000;
  return at_(ymd, hhmm).getTime() >= earliest;
}

/* ------------------------------------------------------------------ */
/* Spreadsheet                                                         */
/* ------------------------------------------------------------------ */

function props_() {
  return PropertiesService.getScriptProperties();
}

function spreadsheet_() {
  var id = props_().getProperty(PROP_SPREADSHEET_ID);
  if (id) return SpreadsheetApp.openById(id);
  throw new Error('Booking system is not set up yet. Run setup() from the Apps Script editor.');
}

function sheet_(name) {
  var sh = spreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('Missing "' + name + '" tab. Run setup() from the Apps Script editor.');
  return sh;
}

/** Map of header label -> 0-based column index. */
function headerIndex_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  headers.forEach(function (h, i) { map[String(h).trim()] = i; });
  return map;
}

/** Prevent formula injection when writing user text into Sheets. */
function safeCell_(v) {
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
}

function unsafeCell_(v) {
  if (typeof v === 'string' && v.charAt(0) === "'") return v.slice(1);
  return v;
}

var inspectorCache_ = null;

/** All inspectors from the Inspectors tab. */
function inspectors_() {
  if (inspectorCache_) return inspectorCache_;
  var sh = sheet_(SHEET_NAMES.INSPECTORS);
  var idx = headerIndex_(sh);
  var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues() : [];
  var get = function (row, label) { return idx[label] === undefined ? '' : row[idx[label]]; };
  inspectorCache_ = rows
    .map(function (row, i) {
      var active = get(row, 'Active');
      return {
        id: String(get(row, 'ID')).trim(),
        name: String(get(row, 'Name')).trim(),
        email: String(get(row, 'Email')).trim(),
        calendarId: String(get(row, 'Private Calendar ID')).trim(),
        color: String(get(row, 'Color')).trim() || INSPECTOR_COLORS[i % INSPECTOR_COLORS.length],
        accessKey: String(get(row, 'Access Key')).trim(),
        active: active === true || /^(true|yes|y|1)$/i.test(String(active).trim()),
        row: i + 2
      };
    })
    .filter(function (i) { return i.id && i.name; });
  return inspectorCache_;
}

function activeInspectors_() {
  return inspectors_().filter(function (i) { return i.active && i.calendarId; });
}

function inspectorById_(id) {
  return inspectors_().filter(function (i) { return i.id === id; })[0] || null;
}

/** The ONLY inspector fields that are ever sent to the public page. */
function publicInspector_(i) {
  return { id: i.id, name: i.name, color: i.color };
}

function bookingRows_() {
  var sh = sheet_(SHEET_NAMES.BOOKINGS);
  var idx = headerIndex_(sh);
  if (sh.getLastRow() < 2) return [];
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  return values.map(function (row, i) {
    var o = { _row: i + 2 };
    BOOKING_COLUMNS.forEach(function (c) {
      o[c.key] = idx[c.label] === undefined ? '' : unsafeCell_(row[idx[c.label]]);
    });
    return o;
  }).filter(function (o) { return o.bookingId; });
}

function findBookingRow_(bookingId) {
  return bookingRows_().filter(function (b) { return String(b.bookingId) === String(bookingId); })[0] || null;
}

function appendBooking_(obj) {
  var sh = sheet_(SHEET_NAMES.BOOKINGS);
  var idx = headerIndex_(sh);
  var row = new Array(sh.getLastColumn()).fill('');
  BOOKING_COLUMNS.forEach(function (c) {
    if (idx[c.label] !== undefined && obj[c.key] !== undefined) row[idx[c.label]] = safeCell_(obj[c.key]);
  });
  sh.appendRow(row);
}

function updateBooking_(rowNumber, changes) {
  var sh = sheet_(SHEET_NAMES.BOOKINGS);
  var idx = headerIndex_(sh);
  BOOKING_COLUMNS.forEach(function (c) {
    if (changes[c.key] !== undefined && idx[c.label] !== undefined) {
      sh.getRange(rowNumber, idx[c.label] + 1).setValue(safeCell_(changes[c.key]));
    }
  });
}

function asDate_(v) {
  if (v instanceof Date) return v;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/* ------------------------------------------------------------------ */
/* Calendars                                                           */
/* ------------------------------------------------------------------ */

function publicCalendar_() {
  var id = props_().getProperty(PROP_PUBLIC_CALENDAR_ID);
  var cal = id && CalendarApp.getCalendarById(id);
  if (!cal) throw new Error('Public calendar not found. Run setup() from the Apps Script editor.');
  return cal;
}

function privateCalendar_(inspector) {
  var cal = inspector.calendarId && CalendarApp.getCalendarById(inspector.calendarId);
  if (!cal) throw new Error('Calendar for ' + inspector.name + ' not found. Check the Inspectors tab.');
  return cal;
}

/**
 * Busy time ranges on an inspector's private calendar. Anything on that
 * calendar blocks booking — jobs, but also days off or personal blocks
 * the inspector adds directly in Google Calendar.
 */
function busyIntervals_(inspector, start, end) {
  return privateCalendar_(inspector).getEvents(start, end).map(function (ev) {
    if (ev.isAllDayEvent()) return [ev.getAllDayStartDate().getTime(), ev.getAllDayEndDate().getTime()];
    return [ev.getStartTime().getTime(), ev.getEndTime().getTime()];
  });
}

function overlaps_(intervals, start, end) {
  var s = start.getTime(), e = end.getTime();
  return intervals.some(function (iv) { return iv[0] < e && iv[1] > s; });
}

function isFree_(inspector, start, end) {
  return !overlaps_(busyIntervals_(inspector, start, end), start, end);
}

/**
 * Public schedule entries: city / date / time / inspector — nothing else.
 * Read from tags the script sets, never from titles or descriptions.
 */
function publicEntries_(start, end) {
  return publicCalendar_().getEvents(start, end)
    .filter(function (ev) { return ev.getTag(TAG_INSPECTOR); })
    .map(function (ev) {
      var insp = inspectorById_(ev.getTag(TAG_INSPECTOR));
      return {
        date: fmt_(ev.getStartTime(), 'yyyy-MM-dd'),
        time: fmt_(ev.getStartTime(), 'HH:mm'),
        endTime: fmt_(ev.getEndTime(), 'HH:mm'),
        inspectorId: ev.getTag(TAG_INSPECTOR),
        inspectorName: insp ? insp.name : 'Inspector',
        city: ev.getTag(TAG_CITY) || ''
      };
    });
}

function fullAddress_(b) {
  return [b.street, b.city, [b.state, b.zip].filter(String).join(' ')].filter(String).join(', ');
}

function privateDescription_(b) {
  return [
    'Booking ID: ' + b.bookingId,
    'Insured / client: ' + b.clientName,
    'Task: ' + b.task,
    'Loss type: ' + b.lossType,
    'Attending: ' + b.attendingName + ' (' + b.attendingRole + ') ' + b.attendingPhone,
    'Address: ' + fullAddress_(b),
    'Form filled out by: ' + b.filledBy,
    'Contact email: ' + b.contactEmail,
    '',
    'Notes:',
    b.notes || '—'
  ].join('\n');
}

function createPrivateEvent_(inspector, b, start, end) {
  var ev = privateCalendar_(inspector).createEvent(
    b.task + ' – ' + b.clientName + ' (' + b.lossType + ')',
    start, end,
    { location: fullAddress_(b), description: privateDescription_(b) }
  );
  ev.setTag(TAG_BOOKING, b.bookingId);
  return ev;
}

function publicTitle_(inspector, city) {
  return inspector.name + ' — ' + city;
}

function createPublicEvent_(inspector, b, start, end) {
  // City only. No client, company, address or job details — ever.
  var ev = publicCalendar_().createEvent(publicTitle_(inspector, b.city), start, end, {
    location: b.city + (b.state ? ', ' + b.state : '')
  });
  ev.setTag(TAG_BOOKING, b.bookingId);
  ev.setTag(TAG_INSPECTOR, inspector.id);
  ev.setTag(TAG_CITY, b.city);
  return ev;
}

function deleteEventQuietly_(calendar, eventId) {
  if (!calendar || !eventId) return;
  try {
    var ev = calendar.getEventById(eventId);
    if (ev) ev.deleteEvent();
  } catch (err) {
    console.warn('Could not delete event ' + eventId + ': ' + err);
  }
}

/* ------------------------------------------------------------------ */
/* Email                                                               */
/* ------------------------------------------------------------------ */

function ownerEmails_() {
  if (CONFIG.NOTIFY_EMAILS && CONFIG.NOTIFY_EMAILS.length) return CONFIG.NOTIFY_EMAILS.slice();
  var me = Session.getEffectiveUser().getEmail();
  return me ? [me] : [];
}

function escHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function prettyWhen_(b) {
  var start = asDate_(b.start);
  var end = asDate_(b.end) || slotEnd_(start);
  return fmt_(start, 'EEE, MMM d, yyyy') + ' · ' + fmt_(start, 'h:mm a') + ' – ' + fmt_(end, 'h:mm a');
}

function detailsTable_(b) {
  var rows = [
    ['Booking ID', b.bookingId],
    ['When', prettyWhen_(b)],
    ['Inspector', b.inspectorName],
    ['Insured / client', b.clientName],
    ['Task', b.task],
    ['Loss type', b.lossType],
    ['Attending', b.attendingName + ' — ' + b.attendingRole],
    ['Attending phone', b.attendingPhone],
    ['Property address', fullAddress_(b)],
    ['Form filled out by', b.filledBy],
    ['Contact email', b.contactEmail],
    ['Notes', b.notes || '—']
  ];
  return '<table cellpadding="6" style="border-collapse:collapse;font:14px Arial,sans-serif">' +
    rows.map(function (r) {
      return '<tr><td style="color:#6b7280;vertical-align:top;white-space:nowrap">' + escHtml_(r[0]) +
        '</td><td style="white-space:pre-wrap">' + escHtml_(r[1]) + '</td></tr>';
    }).join('') + '</table>';
}

function send_(to, subject, html, replyTo) {
  var list = to.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  if (!list.length) return;
  try {
    var opts = { to: list.join(','), subject: subject, htmlBody: html, name: CONFIG.COMPANY_NAME };
    if (replyTo) opts.replyTo = replyTo;
    MailApp.sendEmail(opts);
  } catch (err) {
    // Never fail a booking because an email bounced or quota ran out.
    console.error('Email failed (' + subject + '): ' + err);
  }
}

function notifyNewBooking_(b, inspector) {
  var internal = ownerEmails_();
  if (CONFIG.EMAIL_ASSIGNED_INSPECTOR && inspector.email) internal.push(inspector.email);
  send_(internal,
    'New booking: ' + b.city + ' · ' + prettyWhen_(b) + ' · ' + inspector.name,
    '<p>A new inspection was booked.</p>' + detailsTable_(b),
    b.contactEmail);

  if (CONFIG.SEND_CLIENT_CONFIRMATION && b.contactEmail) {
    send_([b.contactEmail],
      'Inspection confirmed — ' + prettyWhen_(b),
      '<p>Thanks for booking with ' + escHtml_(CONFIG.COMPANY_NAME) + '. Here are the details we received:</p>' +
        detailsTable_(b) +
        '<p>Need to change something? Just reply to this email.</p>',
      ownerEmails_()[0]);
  }
}

function notifyChange_(subject, message, b, inspectors) {
  var to = ownerEmails_();
  inspectors.forEach(function (i) { if (i && i.email) to.push(i.email); });
  send_(to, subject, '<p>' + escHtml_(message) + '</p>' + detailsTable_(b));
}
