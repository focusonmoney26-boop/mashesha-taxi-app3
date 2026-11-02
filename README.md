# Mashesha Qwaqwa — Android starter

This is an Expo / React Native starter for the Mashesha passenger, driver and admin experience.

## Included
- Original cream / dark brown / burnt orange / forest green visual identity.
- Qwaqwa-inspired route picker and Sesotho-inspired labels.
- Shesha Share (R39), Shesha Solo (R66), Shesha Kombi (R122) demo fares.
- Automatic +R20 surcharge for pickup times at or after 20:00.
- Passenger booking preview and demo booking reference.
- Passenger / Driver / Admin workspace switch.
- Supabase/Postgres production starter schema.

## Run on Android
1. Install Node.js LTS and Android Studio (or use an Android phone with Expo Go).
2. Extract this folder.
3. Run `npm install`.
4. Run `npx expo start`.
5. Scan the QR code using Expo Go, or press `a` to launch an Android emulator.

## Important: prototype vs live service
The app runs as a local interactive prototype. It does **not** yet contact drivers, process payments, track live GPS, verify identities, or provide a live admin service. The Driver and Admin tabs are starter workspaces, not production portals.

## Production checklist
1. Create a Supabase project and apply `supabase/schema.sql`.
2. Add reviewed row-level security policies for passengers, drivers and administrators before exposing tables.
3. Implement OTP phone authentication and role-based onboarding.
4. Connect a maps/geocoding provider and request Android foreground/background location permissions.
5. Implement secure booking dispatch, driver acceptance, realtime trip status and cancellation rules.
6. Add a South African payment provider and cash reconciliation.
7. Add driver/vehicle document verification, safety contacts, incident workflow and audit logs.
8. Test fare rules at 19:59, 20:00 and 20:01 Africa/Johannesburg; test daylight/time-zone handling.
9. Confirm fares, route availability, vehicle capacity and operating rules with local taxi associations.
10. Build signed Android App Bundle (AAB), configure Play Console, privacy policy and support contacts.

## Fare rule
The demo applies a flat R20 surcharge based on the pickup time. Share/Solo/Kombi base fares are illustrative values carried forward from the approved concept and must be confirmed before launch.


## Passenger and driver accounts (Supabase Auth)
The starter now includes phone-OTP account authentication and role-based passenger/driver profiles.

1. Create a Supabase project.
2. In Supabase Authentication > Providers, enable Phone and configure an SMS provider.
3. Copy `.env.example` to `.env` and fill in the project URL and publishable/anon key.
4. Install dependencies with `npm install`.
5. Apply `supabase/schema.sql` in the Supabase SQL Editor.
6. Restart Expo after setting environment variables.

The mobile app never needs the Supabase service-role secret. Never place that secret in `.env` or the Android app.
Driver registration creates a driver profile but does not approve the driver. An administrator must verify the driver and vehicle before dispatch access is granted.

The app uses OTP verification. SMS delivery, phone-number formatting, Supabase project configuration and RLS policies must be tested before public launch.

### Account connection details
Passenger and driver sign-ups share the same Supabase Auth project and phone-number OTP verification. The app loads the signed-in user's `profiles.role` to determine which workspace to show. Admin is not a public sign-up choice; assign admin role manually using a trusted Supabase SQL/editor workflow.

For driver onboarding, collect and verify identity/vehicle documents through a secure server-side workflow before setting the driver's vehicle `verified=true` and profile `approved=true`. Do not store identity document images in public buckets.

## Dispatch, payments and cash controls (new migration)

Apply `supabase/migrations/20261031_dispatch_payments_admin.sql` after the base schema.
Deploy the Edge Functions:

```bash
supabase functions deploy dispatch-booking
supabase functions deploy accept-booking
supabase functions deploy payment-webhook
```

The passenger app now calls `dispatch-booking`. Approved drivers receive realtime offers; the accept RPC locks the offer and assigns the booking to only one driver. Driver offers expire after 45 seconds. Realtime must be enabled for `booking_offers` and `bookings` in the Supabase project.

The admin workspace now displays live counts for bookings, drivers, payment records and cash sessions awaiting review. This is an operations overview, not yet a complete admin control panel: driver approval, fare editing, cash review actions, refunds and user management need dedicated secured server actions before launch.

### Payments and cash reconciliation

The migration adds payment records, provider references, cash sessions, cash entries and audit logs. Cash reconciliation is represented in the database but the driver close-shift and admin approve/flag workflows still require server-side actions. The payment webhook is deliberately a provider-neutral scaffold and is **not a live gateway connection**. Before production, choose a South African gateway (for example PayFast, Yoco or a supported Stripe account), configure its merchant account, implement its official signature verification and hosted checkout flow, and test successful, failed, duplicate and refunded events. Never trust a client-supplied `paid` status.

### Android build

`eas.json` includes internal APK and production AAB profiles. After installing EAS CLI and authenticating:

```bash
npm install
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform android --profile production
```

A production-signed release requires the owner's Android signing credentials (EAS can generate/manage a keystore after you explicitly choose that option). No signing key or payment credentials are included in this source archive.

### Security / release gates

- The admin role must be assigned by a trusted operator, never public signup.
- Set `profiles.approved=true` only after driver and vehicle checks.
- Review the migration policies against the actual project before launch.
- The starter's booking creation uses a server function; the service-role key stays in Edge Function secrets.
- This project has not been connected to your Supabase project or a payment merchant account in this workspace. No APK/AAB is claimed as built or signed.

## Cash-first launch flow (added)
- Passenger bookings are explicitly cash-only. The passenger pays the driver directly after the trip; no card gateway is used.
- Driver must open a cash shift before recording fares.
- The assigned driver sees their active bookings and can tap **Confirm cash received** only after physically receiving the exact fare.
- `collect_cash_fare` is a server-side atomic RPC: it verifies driver assignment and booking state, inserts/updates the paid cash payment, creates one cash ledger entry, and completes the booking in one transaction.
- Closing a shift totals opening float plus cash ledger entries. The admin reviews and approves only zero-variance shifts; other shifts are flagged.

### Apply and test
1. In Supabase SQL Editor, apply `supabase/schema.sql` first.
2. Apply `supabase/migrations/20261031_dispatch_payments_admin.sql` next (including the appended cash collection functions).
3. Deploy the `dispatch-booking` and `accept-booking` Edge Functions and configure Supabase Auth.
4. Create/approve a driver and vehicle using trusted admin procedures. Do not make a user an admin from the mobile app.
5. Sign in as the approved driver, open a cash shift, then create a passenger booking.
6. Driver accepts, completes the trip, physically receives cash, and confirms collection. Verify `payments.status='paid'`, `bookings.payment_status='paid'`, and exactly one `cash_entries` row.
7. Close the shift with the counted cash and review it from an approved admin account.

Cash collection is not automatic: the driver must verify that cash was actually received. Do not use this starter with real passengers until RLS, Edge Functions, admin provisioning, and the end-to-end flow have been security-reviewed and tested.
