<div align="center">
<img src="packages/unified-app/assets/icon.png" width="110" alt="Golden Pizza Logo" />

# Pure Home

### Smart Workforce & Service Management Platform

**Simplifying workforce operations with real-time intelligence and automation.**

![Version](https://img.shields.io/badge/version-1.4.0-0ea5e9?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows-0f172a?style=flat-square)
![Status](https://img.shields.io/badge/status-Production%20Ready-22c55e?style=flat-square)
![Language](https://img.shields.io/badge/language-AR%20%7C%20EN-8b5cf6?style=flat-square)

---

*From first customer contact to completed service — Pure Home keeps every team member synchronized, every workflow structured, and every action visible.*

</div>

---

## What is Pure Home?

Pure Home is a modern workforce management platform built for service companies that need operational clarity. It brings together your administration, scheduling, and field technician teams into a single, unified desktop application — connected in real time through a cloud backend.

Whether you are managing dozens of customer accounts, coordinating a full week of service appointments, or tracking a technician's progress in the field, Pure Home gives every team member exactly the view and tools they need — nothing more, nothing less.

**Designed for:**
- Home service and maintenance companies
- Field operations teams
- Multi-department service organizations
- Teams that need structured coordination without complexity

---

## Why Pure Home?

| Without Pure Home | With Pure Home |
|---|---|
| Calls and messages to coordinate between teams | Instant real-time updates across all departments |
| Spreadsheets for scheduling and tracking | Structured workflows with status enforcement |
| No visibility into what field teams are doing | Live task tracking from assignment to completion |
| Manual record-keeping and follow-up | Automated audit trail on every action |
| Fragmented communication across tools | Built-in direct messaging between departments |

---

## Key Features

### Smart Customer Management
Build and maintain a complete customer registry with contact details, service addresses, and full appointment history. Approval workflows ensure every customer is verified before services are scheduled, keeping your operations clean and consistent.

### Intelligent Scheduling System
Create, assign, and manage service appointments with confidence. The scheduling interface gives your operations team a clear view of all upcoming work, with conflict detection and version-controlled editing to prevent double-bookings and overwritten changes.

### Technician Workflow Management
Field technicians see only what they need: their personal work queue, task details, and customer information. They can start, complete, or postpone tasks directly from their device. Every action is timestamped and immediately reflected across the platform.

### Live Synchronization
Every change — a new appointment, a task update, a status change — is broadcast instantly to all connected team members. No refreshing, no waiting, no version conflicts. Every department works from the same live data.

### Smart Notification System
Stay ahead of upcoming appointments and task deadlines with proactive in-app notifications. Alerts arrive in real time with relative timestamps and sound cues. Each user controls their own notification preferences, including volume and display settings.

### Full Audit & Activity Tracking
Every action taken in Pure Home — who did it, when, and what changed — is permanently recorded. Administrators and schedulers can review the complete activity log at any time, providing full transparency and accountability across your operation.

### Role-Based Access Control
Pure Home is built around the concept of structured access. Each team member sees exactly what their role requires and nothing more. Permissions are enforced at every level, from the interface to the API, ensuring your data stays secure and your workflows stay clean.

### Personalized Experience
Each team member can configure their own interface: theme (Light, Dark, System), font size, interface density, accessibility options, and notification preferences. Settings sync automatically and persist across sessions.

---

## How It Works

Pure Home guides your team through a structured, repeatable service workflow — from the first customer interaction to final completion.

```
  CREATE           APPROVE          SCHEDULE
  Customer    →    Request     →    Appointment
     │                                  │
     │                                  ▼
  COMPLETE      TRACK PROGRESS      ASSIGN
  & Log    ←    in Real Time   ←    Technician
```

**Step by step:**

1. **Create** — Administration registers a new customer with contact and address details
2. **Approve** — The customer is verified and approved for scheduling
3. **Schedule** — Scheduling creates a service appointment linked to the customer
4. **Assign** — A technician is assigned to the resulting maintenance task
5. **Notify** — The technician receives an instant notification on their device
6. **Execute** — The technician starts the task, works, and marks it complete
7. **Review** — Administration reviews the completion and approves it
8. **Log** — The full activity is permanently recorded in the audit trail

Every step is visible to the right people, in real time, with no manual coordination required.

---

## User Roles

Pure Home is structured around three clearly defined roles. Each role has its own tailored interface and permissions.

### Administration Team
The operational command center. Administrators have full system visibility and control.

- Manage the complete customer registry
- Oversee all appointments and service schedules
- Assign technicians to maintenance tasks and approve completions
- Access organization-wide reports and export data
- Manage department access codes and system settings
- Communicate with all departments via direct messaging
- Review the full audit and activity log

### Scheduling & Operations Team
The coordination layer. Scheduling users manage the day-to-day service calendar.

- Create and manage customer appointments
- Link appointments to service and maintenance tasks
- Monitor appointment status and handle rescheduling
- View customer records and service history
- Communicate with administration and field teams in real time

### Field Technicians
The execution layer. Technicians have a focused, distraction-free interface built for field use.

- View their personal work queue and assigned tasks
- Access full task details including customer location
- Start, complete, or postpone tasks with reason logging
- Receive instant notifications when new tasks are assigned
- Communicate directly with the office through the app

---

## Value Proposition

**Pure Home transforms how service teams operate.**

**Operational efficiency** — Structured workflows replace ad-hoc coordination. Every task follows a defined lifecycle with clear ownership and status at every stage.

**Real-time visibility** — Every team member, from the office to the field, works from the same live data. There is no lag, no version mismatch, and no need for manual status calls.

**Accountability by default** — The audit trail is not an optional feature — it is built into every action. Every change, every decision, and every completion is permanently recorded with a timestamp and user identity.

**Reduced coordination overhead** — Built-in direct messaging, real-time notifications, and live task tracking reduce the number of calls, messages, and manual check-ins required to keep operations running.

**Structured access** — Role-based permissions ensure team members focus on their responsibilities. There is no confusion about who can do what, and no risk of accidental data modification across departments.

---

## Installation

Pure Home is distributed as a ready-to-run Windows desktop application. No technical setup is required for employees.

### For Employees

1. Download the latest installer from the [Releases page](../../releases/latest)
2. Run `Pure-Home-Setup-X.X.X.exe`
3. Click through the setup wizard (under two minutes)
4. Launch Pure Home from the Start Menu or Desktop shortcut
5. Enter the server address provided by your IT administrator
6. Select your department and enter your access code

**System requirements:** Windows 10 or Windows 11 (64-bit) — Internet connection required

No databases to configure. No servers to run locally. No technical knowledge required.

### For IT Administrators

The installer deploys for all users on the PC using a standard NSIS setup. Application data and user settings are stored in the system application data directory. See the full installation guide in [`docs/INSTALL-WINDOWS.md`](docs/INSTALL-WINDOWS.md).

---

## System Overview

Pure Home is built on a cloud-native, three-tier architecture designed for reliability and simplicity.

```
┌───────────────────────────────────────────────┐
│               Employee Devices                │
│                                               │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│   │  Admin   │  │ Sched.   │  │  Tech.   │   │
│   └──────────┘  └──────────┘  └──────────┘   │
│         Pure Home Desktop Application         │
└────────────────────┬──────────────────────────┘
                     │  Secure HTTPS + WebSocket
                     ▼
          ┌─────────────────────┐
          │   Cloud Backend     │
          │   REST API          │
          │   Real-Time Server  │
          └──────────┬──────────┘
                     │
                     ▼
          ┌─────────────────────┐
          │  Managed Database   │
          │  Automated Backups  │
          │  Daily Snapshots    │
          └─────────────────────┘
```

**Desktop Application** — A native Windows application built on Electron. A single installation covers all three department roles. No browser required.

**Cloud Backend** — A managed cloud API handles all business logic, authentication, and real-time communication. Automatically deployed from the main branch. Health-monitored continuously.

**Managed Database** — PostgreSQL hosted on a fully managed cloud database service. Automated daily backups with 90-day retention. SSL-encrypted connections.

**Real-Time Layer** — WebSocket connections keep every desktop client synchronized. All departments receive live updates as they happen, without polling or manual refresh.

---

## Security & Reliability

Pure Home is built with security as a structural property, not an afterthought.

**Role-based access control** — Every endpoint, every page, and every data field is protected by role authorization. Team members can only access what their role permits.

**Encrypted authentication** — All authentication is handled via signed, time-limited tokens transmitted over encrypted connections. Credentials are never stored in the application or on employee devices.

**Audit trail** — Every create, update, and delete action is logged with the user's identity, a timestamp, and before/after state. The audit log is append-only and cannot be edited.

**Conflict protection** — Optimistic locking prevents two users from unknowingly overwriting the same record. Concurrent edits are detected and surfaced immediately.

**No local secrets** — The desktop application holds no credentials, no database connections, and no sensitive configuration. All business logic and data access run on the cloud backend.

**Automated backups** — The database is backed up daily with integrity verification. Restore procedures are documented and tested.

---

## Documentation

| Document | Purpose |
|---|---|
| [`docs/INSTALL-WINDOWS.md`](docs/INSTALL-WINDOWS.md) | Employee installation guide |
| [`docs/DEPLOY-RENDER.md`](docs/DEPLOY-RENDER.md) | Backend deployment and configuration |
| [`docs/BACKUP-STRATEGY.md`](docs/BACKUP-STRATEGY.md) | Backup schedule and restore procedures |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | Common issues and solutions |
| [`CHANGELOG.md`](CHANGELOG.md) | Full release history |

---

## Releases

Every version of Pure Home is published on the [GitHub Releases page](../../releases).

Each release includes a signed Windows installer and full release notes. The installer handles upgrades gracefully — running a newer installer over an existing installation preserves all settings and the server configuration.

**Current version: 1.4.0**

---

## Project Status

Pure Home is production-ready and actively maintained.

| Area | Status |
|---|---|
| Core service workflow | Stable |
| Real-time synchronization | Stable |
| Authentication & access control | Stable |
| Audit & event logging | Stable |
| Automated database backups | Active |
| Arabic & English interface | Complete |
| Windows desktop application | Stable |

---

<div align="center">

---

*Pure Home transforms how service teams operate —*
*bringing clarity, speed, and control into one unified platform.*

---

**[Download Latest Release](../../releases/latest)** · **[View Documentation](docs/)** · **[Changelog](CHANGELOG.md)**

</div>
