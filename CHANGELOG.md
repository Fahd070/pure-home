# Changelog

All notable changes to WFM System are documented here.

---

## [1.4.0] — 2026-06-08

### New Features

**Global Settings Page**
- Each department (Admin, Scheduling, Technician) now has a dedicated Settings page
- Theme control: Light, Dark, and System (follows OS preference)
- Font size selector: Small, Medium, Large, Extra Large
- Interface scale: Compact, Normal, Comfortable
- Background mode: Day and Night presets
- Accessibility options: High Contrast and Enhanced Readability modes
- Notification preferences: enable/disable in-app notifications
- Notification sound: enable/disable with volume control and test button
- Settings are saved per-user and persist across sessions and restarts
- Full Arabic and English localization for all settings labels

**Notification Sound System**
- In-app audio notification chime when new tasks or alerts arrive
- Uses Web Audio API — no external sound files required
- Volume is adjustable per user preference
- Sound can be tested from the Settings page without waiting for a real notification

**Automated Database Backup**
- Daily automated database backup via GitHub Actions (02:00 UTC)
- Backup integrity verification on every run
- 90-day retention with automatic cleanup
- Manual backup trigger available from GitHub Actions UI
- Automatic failure notification to repository owner

### Improvements

**Real-Time Synchronization**
- Notification display now shows relative timestamps ("Just now", "5m ago", "2h ago") in both Arabic and English
- Notification message body cleaned of internal deduplication markers before display
- Socket.IO connection recovery improved — clients reconnect automatically after server restart

**Activity Log (Messages)**
- Scheduling and Technician users can now view the system activity log without errors
- Removed non-functional action buttons that appeared for non-admin users
- Activity log displays consistently across all three departments

**Backend Health Monitoring**
- `/health` endpoint now returns database response time, server uptime, and ISO timestamp
- Returns HTTP 503 with `status: degraded` when database is unreachable
- Enables accurate uptime monitoring via external services (UptimeRobot, Render health checks)

### Security

- Strengthened access controls on task state transitions: each technician can only act on tasks assigned to them
- Added state machine validation to task endpoints: tasks must be in the correct state before transitioning
- Restricted real-time connection origins to verified deployment URLs
- Validated role parameters in message management endpoints
- Added URL format validation on server configuration screen
- Access code login now validates technician identity before issuing tokens

### Bug Fixes

- Fixed Settings page displaying a missing translation key on save
- Fixed activity log being inaccessible to non-admin users due to overly restrictive middleware
- Fixed delete buttons appearing for users without delete permissions
- Corrected database backup script to use the direct PostgreSQL connection (required for `pg_dump`)

### Documentation

- Added deployment guide for Render + Supabase setup
- Added Windows installation guide for employee PCs
- Added comprehensive troubleshooting guide covering 20+ common scenarios
- Added backup and recovery strategy with restore procedures
- Added environment variable reference (`.env.example`)

---

## [1.3.1] — 2026-06-06

### Bug Fixes

- Fixed access code management page not persisting changes after server restart
- `system_configs` table is now created automatically on first startup (no manual migration required)

---

## [1.3.0] — 2026-06-06

### New Features

**Access Code Management**
- Admin can now change department access codes from within the application
- Current code verification required before changing any code
- Changes take effect immediately without restarting the server

**Admin Improvements**
- Task badge counts visible in Admin sidebar navigation
- Bulk delete option for customer records
- Access Code Management page in Admin settings

---

## [1.2.0] — Prior release

Initial multi-department unified application combining Admin, Scheduling, and Technician workflows
into a single Electron desktop application with role-based routing.

---

## Version History Summary

| Version | Date | Highlights |
|---|---|---|
| 1.4.0 | 2026-06-08 | Settings page, notification sound, security hardening, automated backup |
| 1.3.1 | 2026-06-06 | Access code persistence fix |
| 1.3.0 | 2026-06-06 | Access code management |
| 1.2.0 | — | Unified app architecture |
