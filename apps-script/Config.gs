/**
 * First Sight Inspections — booking system configuration.
 *
 * Everything you are likely to want to change lives in this file.
 * Inspectors themselves are NOT configured here: they live in the
 * "Inspectors" tab of the bookings spreadsheet, so adding a third
 * inspector is just adding a row (then re-running setup()).
 */
var CONFIG = {
  COMPANY_NAME: 'First Sight Inspections',

  // All dates/times are interpreted in this time zone (keep it in sync
  // with "timeZone" in appsscript.json).
  TIMEZONE: 'America/New_York',

  // Bookable start times (24h "HH:mm") and how long each job blocks.
  SLOTS: ['09:00', '11:00', '13:00', '15:00'],
  SLOT_MINUTES: 120,

  // Days clients can book. 0 = Sunday … 6 = Saturday.
  WORK_DAYS: [1, 2, 3, 4, 5, 6],

  // No bookings closer than this many hours from now.
  MIN_NOTICE_HOURS: 18,

  // How far ahead clients can book.
  HORIZON_DAYS: 60,

  DEFAULT_STATE: 'MD',

  // Drop-down choices on the booking form.
  TASKS: ['Inspection', 'Reinspection', 'Supplement inspection', 'Other'],
  LOSS_TYPES: ['Hail & Wind', 'Wind', 'Hail', 'Fire', 'Water', 'Other'],
  ATTENDING_ROLES: ['Contractor', 'Public Adjuster', 'Field Adjuster', 'Insured / Homeowner', 'Other'],

  // Who gets the full-detail "new booking" email. Leave empty to send it
  // to the Google account that owns/deploys this script.
  NOTIFY_EMAILS: [],

  // Also email the assigned inspector (uses the Email column on the
  // Inspectors tab).
  EMAIL_ASSIGNED_INSPECTOR: true,

  // Send the person who filled out the form a confirmation email.
  SEND_CLIENT_CONFIRMATION: true,

  // true  = every signed-in inspector sees every inspector's FULL job
  //         details (lets inspectors coordinate and swap jobs).
  // false = inspectors see full details only for their own jobs; other
  //         inspectors' jobs show just city/date/time (spec §5, last bullet).
  INSPECTORS_SEE_ALL_DETAILS: true,

  PUBLIC_CALENDAR_NAME: 'First Sight Inspections — Public Schedule'
};

var SHEET_NAMES = {
  BOOKINGS: 'Bookings',
  INSPECTORS: 'Inspectors'
};

/**
 * Bookings tab columns. `label` is the header text in the sheet; rename
 * labels to match your existing sheet if you like. Columns are looked up
 * by header text, so you can reorder them or add your own extra columns.
 */
var BOOKING_COLUMNS = [
  { key: 'bookingId',      label: 'Booking ID' },
  { key: 'createdAt',      label: 'Submitted' },
  { key: 'status',         label: 'Status' },
  { key: 'start',          label: 'Start' },
  { key: 'end',            label: 'End' },
  { key: 'inspectorId',    label: 'Inspector ID' },
  { key: 'inspectorName',  label: 'Inspector' },
  { key: 'clientName',     label: 'Insured / Client Name' },
  { key: 'task',           label: 'Task' },
  { key: 'lossType',       label: 'Loss Type' },
  { key: 'attendingName',  label: 'Attending Name' },
  { key: 'attendingRole',  label: 'Attending Role' },
  { key: 'attendingPhone', label: 'Attending Phone' },
  { key: 'street',         label: 'Street Address' },
  { key: 'city',           label: 'City' },
  { key: 'state',          label: 'State' },
  { key: 'zip',            label: 'ZIP' },
  { key: 'filledBy',       label: 'Form Filled Out By' },
  { key: 'contactEmail',   label: 'Contact Email' },
  { key: 'notes',          label: 'Notes' },
  { key: 'privateEventId', label: 'Private Event ID' },
  { key: 'publicEventId',  label: 'Public Event ID' },
  { key: 'lastChange',     label: 'Last Change' }
];

var INSPECTOR_COLUMNS = ['ID', 'Name', 'Email', 'Private Calendar ID', 'Color', 'Access Key', 'Active'];

var INSPECTOR_COLORS = ['#2563eb', '#0f8a6a', '#9333ea', '#c2410c', '#0e7490', '#be123c'];
