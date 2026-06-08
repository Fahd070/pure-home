# WFM System

**Professional Workforce Management Platform**

A desktop application for managing customer appointments, maintenance workflows, and field technician operations. Built for teams that need real-time coordination across administration, scheduling, and field service departments.

---

## Overview

WFM System is a multi-department workforce management platform delivered as a Windows desktop application. It connects all three operational roles — administration, scheduling, and field technicians — through a shared cloud backend, keeping every team member synchronized in real time.

The system manages the full lifecycle of customer service: from initial registration and appointment booking, through task assignment and field execution, to completion tracking and reporting. Every action is logged, every state change is audited, and every department sees updates the moment they happen.

**Supported languages:** Arabic and English (switchable per user)

---

## Key Features

### Customer Management
- Full customer registry with contact details and service addresses
- Customer approval workflow before scheduling is permitted
- Customer history: all past appointments and maintenance tasks per record
- Bulk operations for administrative efficiency

### Appointment Scheduling
- Create, reschedule, and cancel appointments with full status tracking
- Appointment types: Installation and Maintenance
- Conflict detection and version-controlled concurrent editing
- Linked maintenance tasks generated from appointments

### Maintenance Task Workflow
- Structured task lifecycle: Pending Approval → Approved → In Progress → Completed / Postponed
- Technician assignment per task
- Postponement tracking with reason logging
- Full state history preserved per task

### Technician Operations
- Personal work queue showing only assigned tasks
- Task detail view with customer and address information
- Start, complete, and postpone actions with status enforcement
- Real-time updates when tasks are assigned or modified

### Real-Time Synchronization
- All connected clients receive live updates via WebSocket
- No manual refresh required across any department
- Instant notification delivery across departments

### Notification System
- In-app notifications for upcoming appointments and task changes
- Relative timestamps (Just now, 5m ago, 2h ago) in Arabic and English
- Per-user notification preferences and sound controls
- Badge counts on navigation items for unread alerts

### Direct Messaging
- Department-to-department internal messaging
- Conversation history per role pair
- Real-time message delivery

### Audit & Event Logging
- Every create, update, and delete action is recorded with user identity and timestamp
- Before/after state snapshots on record changes
- System-wide activity log visible to all departments
- Event log with full JSON payloads for integration readiness

### Reporting
- Customer and appointment reports with export to Excel
- PDF export for individual records
- Accessible to administration and scheduling roles

### Settings & Personalization
- Per-user theme: Light, Dark, System (follows OS)
- Font size: Small, Medium, Large, Extra Large
- Interface scale: Compact, Normal, Comfortable
- Accessibility: High Contrast mode, Enhanced Readability
- Notification and sound preferences per user

### Access Control Management
- Department access codes managed from the Admin panel
- Code change requires verification of the current code
- Changes take effect immediately without restarting

---

## System Architecture

```
┌─────────────────────────────────────────────┐
│            Employee Workstations            │
│                                             │
│  ┌──────────┐ ┌───────────┐ ┌───────────┐  │
│  │  Admin   │ │Scheduling │ │Technician │  │
│  │  Panel   │ │  Panel    │ │  Panel    │  │
│  └────┬─────┘ └─────┬─────┘ └─────┬─────┘  │
│       │             │             │         │
│       └─────────────┼─────────────┘         │
│                     │ Electron Desktop App  │
└─────────────────────┼───────────────────────┘
                      │ HTTPS + WebSocket
                      ▼
           ┌──────────────────────┐
           │   Cloud Backend      │
           │   Node.js / Express  │
           │   REST API           │
           │   Socket.IO Server   │
           └──────────┬───────────┘
                      │ Prisma ORM
                      ▼
           ┌──────────────────────┐
           │  Managed PostgreSQL  │
           │  (Cloud Database)    │
           └──────────────────────┘
```

**Desktop Application:** Built with Electron and React. A single installer covers all three department roles — the user selects their department at login. No browser required; runs as a native Windows application.

**Backend API:** Node.js with Express, handling all business logic, authentication, and data access. Deployed on a managed cloud platform with automatic health monitoring.

**Database:** PostgreSQL hosted on a managed cloud database service with automated daily backups, SSL encryption, and connection pooling.

**Real-Time Layer:** Socket.IO over WebSocket. All three departments share a live connection to the backend, receiving updates for tasks, notifications, messages, and system events as they occur.

---

## User Roles

### Administration
Full system access.

- Manage the customer registry (create, edit, approve, delete)
- View and manage all appointments across the organization
- Assign technicians to maintenance tasks
- Approve task completions submitted by technicians
- View all system reports and export data
- Manage department access codes
- View the full audit and activity log
- Communicate with all departments via direct messaging

### Scheduling & Maintenance
Operational scheduling access.

- Create and manage customer appointments
- Link appointments to maintenance tasks
- Monitor appointment status and reschedule as needed
- View customer records and service history
- Access the organization-wide activity log
- Communicate with administration and technicians

### Technicians
Field operations access.

- View personal work queue of assigned tasks
- Start, complete, or postpone assigned tasks
- View full task details including customer address
- Receive real-time notifications for new assignments
- Communicate with administration and scheduling

---

## Installation

### For Employees

Download the installer from the [Releases page](../../releases/latest) and run it.

```
WFM-System-Setup-1.4.0.exe
```

The installer requires no technical configuration. It sets up the application for all users on the PC, creates Start Menu and Desktop shortcuts, and completes in under two minutes.

**Requirements:**
- Windows 10 or Windows 11 (64-bit)
- Internet connection to reach the backend service

**First launch:** Enter the server URL provided by your IT administrator and click **Test Connection**. Once connected, select your department and enter your access code.

### For IT Administrators

See [`docs/INSTALL-WINDOWS.md`](docs/INSTALL-WINDOWS.md) for the complete employee installation guide, including troubleshooting common connection issues.

---

## Deployment

The WFM System backend is hosted on a cloud platform and connects to a managed PostgreSQL database. Employees do not run any local server — the desktop application connects to the shared cloud backend over HTTPS.

### High-Level Architecture

| Component | Hosting | Notes |
|---|---|---|
| Desktop application | Employee PCs | Installed via NSIS installer |
| Backend API | Cloud platform (Node.js) | Auto-deploys from `main` branch |
| Database | Managed PostgreSQL | Automated daily backups, 90-day retention |
| Real-time layer | Embedded in backend | Socket.IO, no separate service |

### Deployment Guides

- Full backend deployment guide: [`docs/DEPLOY-RENDER.md`](docs/DEPLOY-RENDER.md)
- Backup and recovery strategy: [`docs/BACKUP-STRATEGY.md`](docs/BACKUP-STRATEGY.md)
- Common issues and solutions: [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)

All deployment credentials and connection strings are stored exclusively in the cloud platform's environment configuration and are never committed to this repository.

---

## Security

- **Role-based access control:** Every API endpoint enforces role authorization. Technicians can only access their own tasks. Scheduling users cannot access admin-only operations.
- **Stateless authentication:** Short-lived signed tokens issued at login. No session state stored server-side.
- **Encrypted transport:** All communication between the desktop application and the backend uses HTTPS and WSS (WebSocket Secure).
- **Audit trail:** Every data modification records the acting user, timestamp, and before/after state. The audit log is append-only and visible to all departments.
- **Access code protection:** Department access codes are stored in the database and managed exclusively through the Admin panel. They are not stored in the application or on employee devices.
- **No secrets in the repository:** Environment variables, credentials, and connection strings are stored exclusively in the cloud deployment environment. The `.env.example` file in this repository contains only placeholder values for developer reference.
- **Conflict protection:** Optimistic locking prevents two users from overwriting each other's changes on the same record.

---

## Usage Workflow

The typical end-to-end workflow through the system:

```
1. Admin creates a customer record
        ↓
2. Admin approves the customer (enables scheduling)
        ↓
3. Scheduling creates an appointment for the customer
        ↓
4. Admin assigns a technician to the maintenance task
        ↓
5. Technician receives a real-time notification
        ↓
6. Technician starts the task on their work queue
        ↓
7. Technician marks the task complete
        ↓
8. Admin reviews and approves the completion
        ↓
9. All departments see the update in real time
       All actions recorded in the audit log
```

---

## Project Structure

```
wfm-system/
├── packages/
│   ├── unified-app/          # Electron desktop application (all three departments)
│   │   ├── src/
│   │   │   ├── admin/        # Admin department pages and components
│   │   │   ├── scheduling/   # Scheduling department pages and components
│   │   │   ├── technician/   # Technician department pages and components
│   │   │   ├── components/   # Shared components (Settings, Notifications, etc.)
│   │   │   └── pages/        # Shared pages (Login, ServerSetup, etc.)
│   │   └── electron/         # Electron main process and preload
│   └── backend/              # Node.js REST API and Socket.IO server
│       ├── src/
│       │   ├── routes/       # API route handlers
│       │   ├── services/     # Business logic (audit, events, notifications)
│       │   └── middleware/   # Auth, error handling, conflict detection
│       └── prisma/           # Database schema and migrations
├── docs/                     # Deployment, installation, and operations guides
├── scripts/                  # Administrative scripts (backup, restore)
└── .github/workflows/        # CI/CD and automated backup workflows
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 28 |
| Frontend framework | React 18, TypeScript |
| Styling | Tailwind CSS |
| State management | Zustand, TanStack Query |
| Real-time client | Socket.IO client |
| Backend framework | Node.js, Express, TypeScript |
| ORM | Prisma |
| Database | PostgreSQL |
| Real-time server | Socket.IO |
| Build tool | electron-vite |
| Installer | electron-builder (NSIS) |

---

## Documentation

| Document | Description |
|---|---|
| [`docs/INSTALL-WINDOWS.md`](docs/INSTALL-WINDOWS.md) | Employee installation guide for Windows PCs |
| [`docs/DEPLOY-RENDER.md`](docs/DEPLOY-RENDER.md) | Backend deployment guide (cloud + database) |
| [`docs/BACKUP-STRATEGY.md`](docs/BACKUP-STRATEGY.md) | Backup schedule, restore procedures, and health monitoring |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | Common issues and step-by-step solutions |
| [`CHANGELOG.md`](CHANGELOG.md) | Full version history and release notes |

---

## Releases

Production installers are published on the [GitHub Releases page](../../releases).

Each release includes:
- Windows installer (`WFM-System-Setup-X.X.X.exe`)
- Release notes describing all changes

Employees should always install the latest release. The installer handles upgrades automatically — running a newer installer over an existing installation preserves all settings.

---

## Project Status

**Version 1.4.0 — Production Ready**

The system is actively deployed and in production use. All three departments are operational. The backend is cloud-hosted with automated health monitoring and daily database backups.

| Area | Status |
|---|---|
| Core workflow | Stable |
| Real-time synchronization | Stable |
| Authentication & access control | Stable |
| Audit & event logging | Stable |
| Automated backups | Active |
| Arabic / English support | Complete |

---

## License

Internal use. All rights reserved.
