/**
 * First Sight Inspections — booking web app.
 *
 * Functions in this file WITHOUT a trailing underscore can be called from
 * the web page (google.script.run). Each one decides exactly what data
 * leaves the server:
 *   - Public functions return only city / date / time / inspector name.
 *   - Inspector functions require a valid inspector access key.
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(CONFIG.COMPANY_NAME + ' — Book an Inspection')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    // Allows embedding in an <iframe> on your own website.
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ================================================================== */
/* PUBLIC (anyone with the link)                                       */
/* ================================================================== */

/** Settings + inspector names the booking page needs to draw itself. */
function getBootstrap() {
  return {
    company: CONFIG.COMPANY_NAME,
    today: todayYmd_(),
    slots: CONFIG.SLOTS,
    slotMinutes: CONFIG.SLOT_MINUTES,
    workDays: CONFIG.WORK_DAYS,
    horizonDays: CONFIG.HORIZON_DAYS,
    tasks: CONFIG.TASKS,
    lossTypes: CONFIG.LOSS_TYPES,
    roles: CONFIG.ATTENDING_ROLES,
    states: CONFIG.STATES,
    defaultState: CONFIG.DEFAULT_STATE,
    inspectors: activeInspectors_().map(publicInspector_)
  };
}

/**
 * Availability + public schedule for a date range (max ~6 weeks).
 * Returns { days: { 'yyyy-MM-dd': { slots: { 'HH:mm': [inspectorId…] },
 *                                    schedule: [{time, inspectorId, inspectorName, city}] } } }
 */
function getAvailability(startYmd, endYmd) {
  if (!isYmd_(startYmd) || !isYmd_(endYmd) || endYmd < startYmd) throw new Error('Invalid date range.');
  if (endYmd > addDaysYmd_(startYmd, 44)) endYmd = addDaysYmd_(startYmd, 44);

  var rangeStart = at_(startYmd, '00:00');
  var rangeEnd = at_(addDaysYmd_(endYmd, 1), '00:00');
  var inspectors = activeInspectors_();
  var now = new Date();

  var busy = {};
  inspectors.forEach(function (i) { busy[i.id] = busyIntervals_(i, rangeStart, rangeEnd); });

  var days = {};
  for (var ymd = startYmd; ymd <= endYmd; ymd = addDaysYmd_(ymd, 1)) {
    var day = { slots: {}, schedule: [] };
    CONFIG.SLOTS.forEach(function (slot) {
      if (!slotBookable_(ymd, slot, now)) return;
      var s = at_(ymd, slot), e = slotEnd_(s);
      day.slots[slot] = inspectors
        .filter(function (i) { return !overlaps_(busy[i.id], s, e); })
        .map(function (i) { return i.id; });
    });
    days[ymd] = day;
  }

  publicEntries_(rangeStart, rangeEnd).forEach(function (p) {
    if (days[p.date]) days[p.date].schedule.push(p);
  });
  Object.keys(days).forEach(function (k) {
    days[k].schedule.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
  });

  return { days: days };
}

/** Client submits the booking form. */
function submitBooking(payload) {
  payload = payload || {};
  // Honeypot: a hidden field real people never fill in.
  if (payload.website) return { bookingId: 'FSI-' + Utilities.getUuid().slice(0, 6).toUpperCase(), ignored: true };

  var b = validateBooking_(payload);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var inspector;
  try {
    inspector = inspectorById_(b.inspectorId);
    if (!inspector || !inspector.active || !inspector.calendarId) throw new Error('Please choose an available inspector.');
    if (!slotBookable_(b.date, b.time)) throw new Error('That time is no longer available. Please choose another.');

    var start = at_(b.date, b.time), end = slotEnd_(start);
    if (!isFree_(inspector, start, end)) {
      throw new Error('SLOT_TAKEN: Sorry — ' + inspector.name + ' was just booked at that time. Please pick another time.');
    }

    b.bookingId = newBookingId_();
    b.createdAt = new Date();
    b.status = 'Booked';
    b.start = start;
    b.end = end;
    b.inspectorName = inspector.name;
    b.lastChange = 'Booked online ' + fmt_(b.createdAt, 'yyyy-MM-dd h:mm a');

    try {
      b.privateEventId = createPrivateEvent_(inspector, b, start, end).getId();
      b.publicEventId = createPublicEvent_(inspector, b, start, end).getId();
      appendBooking_(b);
    } catch (err) {
      // Roll back so a half-finished booking never blocks the slot.
      deleteEventQuietly_(privateCalendar_(inspector), b.privateEventId);
      deleteEventQuietly_(publicCalendar_(), b.publicEventId);
      throw err;
    }
  } finally {
    lock.releaseLock();
  }

  notifyNewBooking_(b, inspector);

  return {
    bookingId: b.bookingId,
    date: b.date,
    time: b.time,
    inspectorName: inspector.name,
    city: b.city,
    contactEmail: b.contactEmail
  };
}

/* ================================================================== */
/* INSPECTORS (require access key from the Inspectors tab)             */
/* ================================================================== */

function inspectorLogin(key) {
  var me = authInspector_(key);
  return {
    me: publicInspector_(me),
    inspectors: activeInspectors_().map(publicInspector_),
    seeAllDetails: CONFIG.INSPECTORS_SEE_ALL_DETAILS
  };
}

/** Every inspector's bookings for a date range, with full details. */
function getPrivateSchedule(key, startYmd, endYmd) {
  var me = authInspector_(key);
  if (!isYmd_(startYmd) || !isYmd_(endYmd)) throw new Error('Invalid date range.');
  var from = at_(startYmd, '00:00').getTime();
  var to = at_(addDaysYmd_(endYmd, 1), '00:00').getTime();

  var bookings = bookingRows_()
    .filter(function (b) {
      var s = asDate_(b.start);
      return s && String(b.status) !== 'Cancelled' && s.getTime() >= from && s.getTime() < to;
    })
    .map(function (b) { return toClientBooking_(b, me); });

  bookings.sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1; });
  return { bookings: bookings };
}

/** Hand a job to another inspector (job swaps). */
function reassignBooking(key, bookingId, newInspectorId) {
  var me = authInspector_(key);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var b, from, to;
  try {
    b = findBookingRow_(bookingId);
    if (!b || String(b.status) === 'Cancelled') throw new Error('Booking not found.');
    if (!canManage_(me, b)) throw new Error('You can only reassign your own jobs.');
    from = inspectorById_(b.inspectorId);
    to = inspectorById_(newInspectorId);
    if (!to || !to.active || !to.calendarId) throw new Error('Choose an active inspector.');
    if (from && from.id === to.id) throw new Error('That job is already assigned to ' + to.name + '.');

    var start = asDate_(b.start), end = asDate_(b.end) || slotEnd_(start);
    if (!isFree_(to, start, end)) throw new Error(to.name + ' already has something on their calendar at that time.');

    var newPriv = createPrivateEvent_(to, b, start, end);
    if (from) deleteEventQuietly_(CalendarApp.getCalendarById(from.calendarId), b.privateEventId);

    var pub = b.publicEventId && publicCalendar_().getEventById(b.publicEventId);
    if (pub) {
      pub.setTitle(publicTitle_(to, b.city));
      pub.setTag(TAG_INSPECTOR, to.id);
    } else {
      b.publicEventId = createPublicEvent_(to, b, start, end).getId();
    }

    b.inspectorId = to.id;
    b.inspectorName = to.name;
    b.privateEventId = newPriv.getId();
    b.lastChange = 'Reassigned ' + (from ? from.name : '?') + ' → ' + to.name + ' by ' + me.name + ' ' +
      fmt_(new Date(), 'yyyy-MM-dd h:mm a');
    updateBooking_(b._row, {
      inspectorId: b.inspectorId, inspectorName: b.inspectorName,
      privateEventId: b.privateEventId, publicEventId: b.publicEventId, lastChange: b.lastChange
    });
  } finally {
    lock.releaseLock();
  }

  notifyChange_('Job reassigned to ' + to.name + ': ' + b.city + ' · ' + prettyWhen_(b), b.lastChange, b, [from, to]);
  return toClientBooking_(b, me);
}

function cancelBooking(key, bookingId, reason) {
  var me = authInspector_(key);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var b, insp;
  try {
    b = findBookingRow_(bookingId);
    if (!b || String(b.status) === 'Cancelled') throw new Error('Booking not found.');
    if (!canManage_(me, b)) throw new Error('You can only cancel your own jobs.');
    insp = inspectorById_(b.inspectorId);
    if (insp) deleteEventQuietly_(CalendarApp.getCalendarById(insp.calendarId), b.privateEventId);
    deleteEventQuietly_(publicCalendar_(), b.publicEventId);
    b.status = 'Cancelled';
    b.lastChange = 'Cancelled by ' + me.name + ' ' + fmt_(new Date(), 'yyyy-MM-dd h:mm a') +
      (reason ? ' — ' + String(reason).slice(0, 300) : '');
    updateBooking_(b._row, { status: b.status, lastChange: b.lastChange });
  } finally {
    lock.releaseLock();
  }
  notifyChange_('Booking cancelled: ' + b.city + ' · ' + prettyWhen_(b), b.lastChange, b, [insp]);
  return { ok: true };
}

/* ================================================================== */
/* Internal                                                            */
/* ================================================================== */

function authInspector_(key) {
  key = String(key || '').trim();
  if (key.length >= 8) {
    var match = inspectors_().filter(function (i) {
      return i.active && i.accessKey && i.accessKey.length >= 8 && safeEquals_(i.accessKey, key);
    })[0];
    if (match) return match;
  }
  Utilities.sleep(800); // slow down guessing
  throw new Error('That access key was not recognized.');
}

function safeEquals_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function canManage_(me, b) {
  return CONFIG.INSPECTORS_SEE_ALL_DETAILS || String(b.inspectorId) === me.id;
}

/** Shape a sheet row for the inspector view (dates as strings; optional redaction). */
function toClientBooking_(b, me) {
  var start = asDate_(b.start);
  var end = asDate_(b.end) || slotEnd_(start);
  var insp = inspectorById_(b.inspectorId);
  var base = {
    id: String(b.bookingId),
    date: fmt_(start, 'yyyy-MM-dd'),
    time: fmt_(start, 'HH:mm'),
    endTime: fmt_(end, 'HH:mm'),
    inspectorId: String(b.inspectorId),
    inspectorName: insp ? insp.name : String(b.inspectorName),
    city: String(b.city),
    state: String(b.state || ''),
    mine: String(b.inspectorId) === me.id
  };
  if (!CONFIG.INSPECTORS_SEE_ALL_DETAILS && !base.mine) {
    base.redacted = true;
    return base;
  }
  ['clientName', 'task', 'lossType', 'attendingName', 'attendingRole', 'attendingPhone',
   'street', 'state', 'filledBy', 'contactEmail', 'notes', 'lastChange'].forEach(function (k) {
    base[k] = b[k] == null ? '' : String(b[k]);
  });
  base.address = fullAddress_(b);
  base.submitted = asDate_(b.createdAt) ? fmt_(asDate_(b.createdAt), 'yyyy-MM-dd h:mm a') : '';
  return base;
}

function newBookingId_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid());
  var id = '';
  for (var i = 0; i < 6; i++) id += chars.charAt((bytes[i] + 256) % chars.length);
  return 'FSI-' + id;
}

function validateBooking_(p) {
  var line = function (v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 120); };
  var titleCase = function (s) {
    // Only fix ALL-CAPS / all-lowercase input; leave "McLean" etc. alone.
    if (s !== s.toLowerCase() && s !== s.toUpperCase()) return s;
    return s.toLowerCase().replace(/(^|[\s\-'.])([a-z])/g, function (m, a, c) { return a + c.toUpperCase(); });
  };
  var oneOf = function (v, list, label) {
    v = line(v);
    if (list.indexOf(v) === -1) throw new Error('Please choose a ' + label + '.');
    return v;
  };
  var required = function (v, label, max) {
    v = line(v, max);
    if (!v) throw new Error(label + ' is required.');
    return v;
  };

  var b = {
    date: line(p.date, 10),
    time: line(p.time, 5),
    inspectorId: line(p.inspectorId, 60),
    clientName: required(p.clientName, 'Insured / client name'),
    task: oneOf(p.task, CONFIG.TASKS, 'task'),
    lossType: oneOf(p.lossType, CONFIG.LOSS_TYPES, 'loss type'),
    attendingName: required(p.attendingName, 'Attending name'),
    attendingRole: oneOf(p.attendingRole, CONFIG.ATTENDING_ROLES, 'attending role'),
    attendingPhone: required(p.attendingPhone, 'Attending phone', 30),
    street: required(p.street, 'Street address', 160),
    city: titleCase(required(p.city, 'City', 60)),
    state: oneOf(String(p.state || '').toUpperCase(), CONFIG.STATES, 'state'),
    filledBy: required(p.filledBy, '"Form filled out by"'),
    contactEmail: required(p.contactEmail, 'Contact email', 160).toLowerCase(),
    notes: String(p.notes == null ? '' : p.notes).trim().slice(0, 2000)
  };
  if (!isYmd_(b.date) || CONFIG.SLOTS.indexOf(b.time) === -1) throw new Error('Please pick a date and time.');
  if ((b.attendingPhone.match(/\d/g) || []).length < 10) throw new Error('Please enter a 10-digit phone number.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.contactEmail)) throw new Error('Please enter a valid contact email.');
  return b;
}
