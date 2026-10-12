# 90s Turf — Backend API

NestJS 11 + TypeORM + MySQL 8. Serves the website, admin dashboard and mobile app.

## Setup

```bash
npm install
cp .env.example .env        # then fill in DB_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET, SEED_ADMIN_PASSWORD
```

Create the database once:

```sql
CREATE DATABASE nineties_turf CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

```bash
npm run seed          # admin user + pricing, services, gallery, reviews
npm run seed:demo     # …plus sample customers, bookings and payments
npm run start:dev     # http://localhost:4000/api   ·   docs: http://localhost:4000/api/docs
```

With `DB_SYNC=true` (development only) tables are created/updated from the entities on start.

## Tests

```bash
npm test              # unit tests: pricing, overlaps, statuses, payment ledger, codes
npm run test:e2e      # API tests against the database in .env (read-only; needs seed)
```

## Endpoints (prefix `/api`)

| Area | Routes | Access |
|---|---|---|
| Auth | `POST auth/login`, `POST auth/refresh`, `POST auth/logout`, `GET/PATCH auth/me`, `PATCH auth/change-password`, `GET auth/sessions`, `DELETE auth/sessions/:id`, `POST auth/sessions/revoke-others` | login/refresh/logout public; rest admin |
| Users | `GET/POST users`, `GET/PATCH/DELETE users/:id`, `POST users/:id/avatar` (multipart `file`) | admin |
| Bookings | `GET bookings?status=&range=today\|week\|month\|custom&from=&to=&q=&paymentStatus=&page=&limit=`, `GET bookings/counts`, `POST bookings`, `GET/PATCH/DELETE bookings/:id`, `PATCH bookings/:id/cancel`, `POST bookings/:id/payments` | admin |
| Payments | `GET payments`, `DELETE payments/:id` | admin |
| Invoices | `GET invoices`, `GET/PATCH invoices/:id` | admin |
| Dashboard | `GET dashboard/summary?range=`, `GET dashboard/upcoming?limit=`, `GET dashboard/revenue?months=` | admin |
| Enquiries | `GET enquiries`, `PATCH/DELETE enquiries/:id` | admin |
| Documents | `GET documents/:type/:bookingId/pdf` (download), `GET documents/:type/:bookingId/links`, `POST documents/:type/:bookingId/send` `{ channel: email\|whatsapp, to? }` — `:type` = `invoice` or `booking` | admin |
| Website | `GET public/services\|pricing\|gallery\|reviews`, `GET public/slots?date=`, `POST public/bookings` (returns `pdfUrl`), `POST public/enquiries`, `GET public/documents/:type/:token.pdf` | public (rate-limited) |

Full request/response schemas are in Swagger at `/api/docs`.

## How it works

- **Pricing** (`src/pricing/pricing.calc.ts`): each 30-minute block is charged at its plan's rate — weekday day (before 6 PM), weekday night, or weekend. Extra guests above the plan maximum are charged per guest. Admins can override the rate per booking.
- **No double booking**: creating or moving a booking locks that day's bookings in a transaction and rejects any overlap (409). Back-to-back bookings are allowed.
- **Statuses**: `UPCOMING → ONGOING → COMPLETED` follow the clock (updated every minute and before every list). Cancelling frees the slot.
- **Payments**: every payment, advance or refund is a row in `payments`. The booking's `amountPaid`, `paymentStatus` (PENDING / ADVANCE / PAID / REFUND), `paymentType`, `transactionId`, `paymentDate` and the invoice status are recalculated from them. Overpayments and refunds above the amount paid are rejected.
- **Invoices**: one per booking, created automatically (`INV-YYYY-####`).
- **PDFs** (`src/documents`): Handlebars templates (`templates/invoice.hbs`, `templates/booking-confirmation.hbs`, shared `partials/`) rendered to A4 PDF by Playwright (headless Chromium, installed by `npm install` via `postinstall`) with the brand fonts embedded. Customers open PDFs through a secret link (`public/documents/:type/<48-char token>.pdf`).
- **Sending** (`src/notifications`): when a booking is created the **booking confirmation** PDF is emailed to the customer, and when its payments cover the full amount the **invoice** PDF is emailed (`AUTO_SEND_DOCUMENTS=true`). Admins can also send either PDF by email or WhatsApp from the dashboard/app.
  - Email uses `SMTP_*` settings. Without `SMTP_HOST` (development) emails go to a free Ethereal test inbox — nothing is delivered and the preview link is logged.
  - WhatsApp: with `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` (Meta WhatsApp Cloud API) the PDF is sent automatically as a document; without them the apps open a WhatsApp chat with the customer and the PDF link ready to send.
  - `PUBLIC_BASE_URL` is the address used in links sent to customers. Locally it's your PC's Wi-Fi IP so phones on the same network can open them; in production set it to your public HTTPS domain (WhatsApp Cloud API needs a public link).
- **Who signs in**: only **ADMIN** accounts. Customers are records (no password, no login, no self-registration); a customer can be made an admin by giving them a password, and demoting an admin removes their password.
- **Sessions**: login returns a 15-minute access token (`Authorization: Bearer`) and a 7-day refresh token. Browsers get the refresh token as an httpOnly, SameSite cookie scoped to `/api/auth`; native apps send `X-Client: mobile` and exchange it in the JSON body. Every `POST auth/refresh` rotates the refresh token and extends the session by 7 days, so a device stays signed in until it goes 7 days unused. Each sign-in is a row in `auth_sessions` holding only a SHA-256 hash of the current refresh token. Access tokens carry the session id and are checked against it on every request, so logout, "sign out other devices", a password change (other devices) and an admin resetting/deactivating/demoting an account (all devices) take effect immediately. Replaying an already-rotated refresh token revokes the session (theft detection; a 60 s grace covers two tabs refreshing at once). Expired/revoked rows are purged daily.
- **Security**: bcrypt password hashes (never returned by the API), JWT auth for active admins only (a deactivated or demoted admin loses access immediately), input validation with unknown fields rejected, rate limits on login and public forms, CORS limited to `CORS_ORIGINS`.

## Project layout

```
src/
  auth/        admin login, access/refresh tokens, sessions, JWT strategy, profile & password
  users/       user entity, CRUD, avatar upload
  bookings/    booking entity, rules, service (bookings + payments + invoices), status scheduler
  payments/    payment entity, payments list
  invoices/    invoice entity, invoices list/edit
  pricing/     pricing plans + price calculation
  dashboard/   summary, upcoming, monthly revenue
  enquiries/   website contact form submissions
  documents/   PDF templates (.hbs), fonts, rendering, download/share endpoints
  notifications/ email (SMTP/Ethereal), WhatsApp, automatic sending on booking events
  public/      website endpoints
  content/     services, gallery images, reviews
  common/      enums, guards, decorators, time helpers
  database/    seed script
```
