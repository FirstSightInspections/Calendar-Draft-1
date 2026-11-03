# First Sight Inspections — Booking System

Online booking for First Sight Inspections. It shows two levels of detail:

| | Who sees it | What it shows |
|---|---|---|
| **Book an inspection** | Anyone (clients) | Pick a date → pick a time → see which inspector is free *and where they're already working that day* → fill out the intake form |
| **Public schedule** | Anyone (clients) | **Only** city, date, time and inspector name, e.g. "Inspector A · Frederick · 9:00 AM". No client, company, address or job details. |
| **Inspector view** | Inspectors (personal access key) | Every inspector's full schedule: insured/client, task, loss type, attending name/role/phone, full address, who filled out the form, contact email and notes. Inspectors can **hand a job off to another inspector** or cancel it. |

It runs on the Google tools you already use, with no third-party scheduling platform and no hosting bill:

- **Google Sheets**: a `Bookings` tab (one row per booking) and an `Inspectors` tab (one row per inspector).
- **Google Calendar**: one private calendar per inspector with full details, plus one shared **public** calendar that holds only `Inspector A — Frederick`.
- **Gmail**: a full-detail email to you (and the assigned inspector) on every booking, plus an optional confirmation to the client.
- **Apps Script**: serves the booking page and enforces privacy on the server.

## Try it right now (demo mode)

Open `apps-script/Index.html` directly in any browser. It runs on built-in sample data, and nothing is saved. In the **Inspector view**, use access key `demo-key-a`.

## How privacy is enforced

The privacy rules live in the server code, not in the page layout.

- The public functions (`getBootstrap`, `getAvailability`) only ever return inspector ID/name/color plus date, time and city. Client data never reaches a client's browser. Even someone reading the page's network traffic sees nothing private.
- Public calendar events get a title of `Inspector — City`, a location of `City, State`, and **no description**.
- Full details are only returned by `getPrivateSchedule`, which requires a valid inspector access key.
- Every helper ends in `_`, which means Apps Script won't let the web page call it. `setup()` refuses to run unless you're the owner in the editor.

### Inspectors seeing each other's jobs

You asked for inspectors to see each other's full schedules so they can coordinate and swap jobs, so that is the default:

```js
// apps-script/Config.gs
INSPECTORS_SEE_ALL_DETAILS: true,
```

Your spec sheet (§5) originally said each inspector should only see **their own** private details. If you want that instead, set this to `false`. Inspectors will then still see *where and when* the others are working (city/time), but not their client details, and they can only reassign or cancel their own jobs.

## Setup (about 15 minutes, one time)

> **Your current system is left alone.** This runs as a completely separate project. It creates its *own new* spreadsheet and *new* calendars, and it never opens or changes your existing Google Form, script, sheet or calendar. Keep using your current setup while you test this one, and switch over only when you're happy with it.

1. **Create a separate script project.** Go to [script.google.com](https://script.google.com) and click **New project**. Name it "First Sight Booking System". *Don't* open it from **Extensions → Apps Script** inside your current sheet.
2. **(Nothing to create by hand.)** `setup()` makes a brand-new spreadsheet called **"First Sight Inspections — Bookings (new system)"** in your Drive.
3. **Add the files.** Copy each file from the `apps-script/` folder into the editor:
   - `Code.gs`, `Store.gs`, `Setup.gs`, `Config.gs`: click **+ → Script**, name the file without `.gs`, and paste.
   - `Index.html`: click **+ → HTML**, name it `Index`, and paste.
   - `appsscript.json`: under **Project Settings**, tick "Show appsscript.json manifest file", then paste.
   - (Or use [clasp](https://github.com/google/clasp): `clasp create --type standalone --rootDir apps-script` and then `clasp push`.)
4. **Check `Config.gs`.** Clients can pick start times **every 30 minutes from 8:00 AM to 5:00 PM** (`FIRST_START`, `LAST_START`, `START_EVERY_MINUTES`). Each job blocks the inspector for `SLOT_MINUTES` (default 2 hours), so a 9:00 job makes that inspector unavailable until 11:00. Working days, minimum notice, form drop-down choices, and who gets notification emails are also set there.
5. **Run setup.** Select `setup` in the function drop-down and click **Run**, then approve the permissions. Setup will:
   - create a **new** spreadsheet with `Bookings` and `Inspectors` tabs (with one inspector row, "Inspector A", for you). Its link is printed in the execution log;
   - create a private calendar for each inspector and the public calendar;
   - generate an **access key** for each inspector (shown in the `Inspectors` tab and in the execution log).
6. **Edit the `Inspectors` tab.**
   - Put in real names: the **Name** column is what clients see.
   - Add each inspector's **Email** so they get job notifications.
   - Send each inspector their own access key.
   - If an inspector already has a calendar they want to use, paste its ID into **Private Calendar ID**. The calendar must be shared with your account with "Make changes to events".
7. **Deploy.** Choose **Deploy → New deployment → Web app**, with "Execute as: **Me**" and "Who has access: **Anyone**". Copy the web app URL.
8. **Share the calendars with your inspectors** (optional but handy). In Google Calendar, share each private calendar with the inspectors ("See all event details" or "Make changes to events"). The jobs then also show up in their phone's calendar app.

### Adding an inspector later

It starts with just you. While there's only one inspector, clients skip the "choose your inspector" step and the inspector filters are hidden. To add someone, add a row to the `Inspectors` tab with just a **Name** and **Email**, and re-run `setup()`. Setup fills in the ID, color, access key and private calendar. No code changes are needed. The "choose your inspector" step and filters come back automatically.

### Days off and personal appointments

Anything on an inspector's private calendar blocks booking: jobs, vacation days, dentist appointments. To block time, add an event (or an all-day event) to that inspector's calendar.

## Embedding on your website

Paste this where you want the booking page:

```html
<iframe src="YOUR_WEB_APP_URL" style="width:100%;min-height:1100px;border:0" title="Book an inspection"></iframe>
```

To link inspectors straight to their view, add `#inspector` to the web app URL. Their key is remembered for the browser session.

## Answers to the spec's developer questions (§10)

- **Can Google Calendar sharing alone do the two-tier visibility?** Not on its own. Google's "free/busy only" sharing hides the city as well, and a single calendar can't show different fields to different people. This build uses **two calendars per booking** (private with full details, public with city only), written by the script. Google Calendar stays the backend, and the privacy split is guaranteed by code.
- **Can it be embedded?** Yes, with the `<iframe>` above. It works on phones.
- **Ongoing costs?** None for hosting. Apps Script, Sheets, Calendar and Gmail are free within Google's daily quotas. Consumer Gmail allows about 100 script emails/day; Workspace allows about 1,500.

## Things to know

- **Edit bookings through the app.** Moving or deleting a job directly in Google Calendar frees or blocks the slot correctly, but the `Bookings` sheet won't know about it. Use the Inspector view's **Reassign** / **Cancel** buttons so the sheet, both calendars and the emails stay in sync.
- **Sheet layout.** Column headers in the `Bookings` tab can be renamed in `Config.gs` (`BOOKING_COLUMNS`) to match your current sheet. Columns are found by header name, so you can reorder them or add your own.
- **Double-booking protection.** Two clients can't grab the same inspector and slot: the script locks, re-checks the calendar, and only then books.
- **Spam.** The form has a hidden honeypot field, and all form input is validated on the server.
