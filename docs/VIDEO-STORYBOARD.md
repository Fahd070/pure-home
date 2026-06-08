# Pure Home — Product Demo Video Storyboard

**Production Document v1.0**
Total runtime: ~2 minutes 30 seconds
Language: Arabic (on-screen text only — no voice narration)
Style: Clean SaaS product demo (Notion / Jira / Monday.com style)
Recording tool: OBS Studio or Camtasia

---

## Production Notes

| Setting | Value |
|---|---|
| Resolution | 1920 × 1080 (Full HD) |
| Frame rate | 60 fps |
| Cursor | Use a large, clearly visible cursor (OBS cursor plugin recommended) |
| App zoom | Set Windows display scaling to 125% before recording |
| Language | Switch app language to Arabic before recording |
| Browser | No browser — record the Electron desktop app only |
| Music | Soft corporate background track — no vocals, ~70 BPM, fade in at Scene 1, fade out at Scene 19 |
| Music volume | 15–20% — text overlays must be readable over it |

---

## Music Reference

Style: Modern SaaS / tech corporate instrumental
Reference tracks to search on Pixabay Audio or YouTube Audio Library:
- Search: "corporate soft background no vocals"
- Search: "SaaS product demo music minimal"
- Search: "calm technology background 2024"

Suggested cue points:
- 0:00 — fade in gently from silence
- 0:05 — full volume (low)
- 2:22 — gentle swell for outro
- 2:30 — fade to silence

---

## Color Reference for Text Overlays

| Element | Color |
|---|---|
| Scene title overlay | White `#FFFFFF` on dark slate `#0F172A` — 80% opacity |
| Action caption | Soft white `#F1F5F9` — centered bottom third |
| Role badge (Admin) | Blue `#2563EB` background, white text |
| Role badge (Scheduling) | Green `#16A34A` background, white text |
| Role badge (Technician) | Orange `#EA580C` background, white text |
| Highlight ring | Blue `#3B82F6`, 3px, animated pulse |

---

## Icon Characters (Per Role)

Use flat SVG icons — no full characters required.

| Role | Icon | Color |
|---|---|---|
| Admin | Shield + person silhouette | Blue `#2563EB` |
| Scheduling | Calendar + checkmark | Green `#16A34A` |
| Technician | Wrench / tool | Orange `#EA580C` |

Each role icon slides in from the left when its section starts and holds for 2 seconds alongside the section title, then fades out.

---

## FULL SHOT-BY-SHOT STORYBOARD

---

### SCENE 1 — INTRO TITLE CARD
**Duration:** 5 seconds
**Screen:** Black background (no app yet)
**Action:** None — static title card

**Visual:**
- Centered white logo text: **Pure Home**
- Below it, Arabic subtitle fades in:
  > **نظام إدارة العمليات والموظفين**
- Small version tag bottom-right: `v1.0.0`

**Camera:** Static — no movement

**Text Overlay:**
```
Pure Home
نظام إدارة العمليات والموظفين
```

**Transition out:** Fade to app (0.5s)
**Purpose:** Brand introduction

---

### SCENE 2 — LOGIN SCREEN (DEPARTMENT SELECTOR)
**Duration:** 6 seconds
**Screen:** `DepartmentSelector` page — three department tiles visible

**Action:**
1. App appears from fade (already on Department Selector screen)
2. Cursor slowly moves toward the **Admin** department tile
3. Light hover effect visible on the Admin card
4. Pause 1.5 seconds — do not click yet

**Visual:**
- Admin role icon (blue shield) appears in bottom-left corner with a gentle slide-in animation
- Hold for 1 second then fade

**Text Overlay (bottom center, Arabic, white):**
```
اختر دورك للبدء
```

**Camera:** Slight slow zoom in toward center of screen (scale 1.0 → 1.04 over 6 seconds)
**Purpose:** Show entry point — role selection

---

### SCENE 3 — ADMIN LOGIN
**Duration:** 5 seconds
**Screen:** `CodeEntry` page — 4-digit code input field

**Action:**
1. Cursor clicks Admin tile (Scene 2 transitions here)
2. Code entry screen appears
3. Cursor clicks each digit button one by one — slow and deliberate
4. After 4th digit: login button appears / auto-submits

**Note for recording:** Use the actual admin access code. Do NOT show the code prominently on screen — the camera should be slightly zoomed out so the numpad is partially visible but not perfectly readable.

**Text Overlay (bottom center):**
```
تسجيل الدخول — قسم الإدارة
```

**Role badge (top right):** Blue pill — **الإدارة**

**Camera:** Medium zoom — show full login form
**Transition out:** Quick cut to dashboard (0.3s)
**Purpose:** Show authentication flow

---

### SCENE 4 — ADMIN DASHBOARD
**Duration:** 10 seconds
**Screen:** Admin `Dashboard` page — KPI cards, recent activity

**Action:**
1. Dashboard loads — cards animate in (they already do this in the app)
2. Cursor slowly moves across the stat cards left to right
3. Hover over each card for 1 second:
   - Total Customers
   - Appointments Today
   - Active Tasks
   - Pending Approvals
4. Scroll down slightly to show lower section

**Text Overlay sequence (3 overlays, 3 seconds each):**
1. `لوحة التحكم — نظرة عامة على العمليات` (appears at start)
2. `متابعة المواعيد والمهام في الوقت الفعلي` (appears at 4s)
3. `كل البيانات في مكان واحد` (appears at 7s)

**Camera:** Slow pan right across dashboard cards, then settle
**Purpose:** Show dashboard value — real-time operational overview

---

### SCENE 5 — ADMIN CREATES A NEW CUSTOMER
**Duration:** 14 seconds
**Screen:** `AddCustomer` page

**Action:**
1. Cursor clicks **العملاء** (Customers) in sidebar
2. Customer list loads — cursor moves to **إضافة عميل** button (top right)
3. Click — form slides open
4. Fill in each field slowly and deliberately:
   - **الاسم الكامل:** `أحمد محمد العلي` (type character by character)
   - **رقم الهاتف:** `0501234567`
   - **العنوان:** `الرياض - حي النزهة`
5. Click **حفظ العميل** button
6. Success toast appears: "تم إضافة العميل بنجاح"

**Text Overlay sequence:**
1. `إضافة عميل جديد` (shows at start, 3s)
2. `إدخال بيانات العميل والموقع` (shows during form fill, 5s)
3. `تم الحفظ بنجاح ✓` (shows on success toast, 3s)

**Camera:**
- Start: medium zoom showing full sidebar + main content
- During form: subtle zoom toward form fields
- On success: zoom out slightly to show toast notification

**Highlight:** When cursor hovers over **حفظ** button, add a blue highlight ring around it for 1 second before clicking

**Purpose:** Demonstrate CRM — customer creation

---

### SCENE 6 — CUSTOMER APPROVAL
**Duration:** 8 seconds
**Screen:** Customer detail page or customer list with approval action

**Action:**
1. Customer just created appears in list (or auto-navigates to detail page)
2. Cursor finds the **اعتماد** / **موافقة** button
3. Slow hover — highlight ring appears
4. Click — status badge changes from "قيد الانتظار" (yellow) to "معتمد" (green)
5. Hold on green badge for 2 seconds

**Text Overlay:**
```
اعتماد العميل لبدء جدولة الخدمات
```

**Camera:** Zoom in slightly on the status badge transition (yellow → green)
**Highlight:** Zoom punch (1.0 → 1.08) on the badge the moment it turns green
**Purpose:** Show approval workflow — gating mechanism

---

### SCENE 7 — CUSTOMER LIST OVERVIEW
**Duration:** 6 seconds
**Screen:** Customers list page — multiple customer rows visible

**Action:**
1. Cursor clicks back to customer list
2. Slow scroll down through the list — showing multiple customers
3. Pause on a row — hover shows action buttons
4. Move cursor to show the search bar at the top (don't type)

**Text Overlay:**
```
قائمة العملاء — بحث وتصفية فورية
```

**Camera:** Wide shot — show full list with sidebar visible
**Purpose:** Show scale — the system handles a real customer registry

---

### SCENE 8 — ROLE TRANSITION ANIMATION — SCHEDULING
**Duration:** 4 seconds
**Screen:** Transition overlay (not in app — this is an editing overlay)

**Visual:**
- Current screen blurs out (Gaussian blur 0 → 8)
- Center screen: green calendar icon slides in from left
- Arabic text fades in:
  > **قسم الجدولة والمواعيد**
- Green role badge pulses once
- Blur clears, new role's screen fades in

**Action in app:** Log out, select Scheduling role, enter code

**Note for editor:** Cut the actual logout/login steps. Keep only the department selector moment and the first frame of the scheduling dashboard. Insert the transition overlay to mask the switch.

**Text Overlay:**
```
الآن — قسم الجدولة
```

**Camera:** Static during overlay
**Purpose:** Clean role switch — keeps pacing tight

---

### SCENE 9 — SCHEDULING APPOINTMENTS PAGE
**Duration:** 7 seconds
**Screen:** Scheduling `Appointments` page

**Action:**
1. Appointments list loads — several appointments visible with status badges
2. Cursor hovers over different status badges:
   - "مجدول" (blue)
   - "قيد التنفيذ" (yellow)
   - "مكتمل" (green)
3. Slow scroll through list

**Text Overlay:**
```
إدارة جميع المواعيد من مكان واحد
```

**Camera:** Medium wide — show full list, status badges clearly visible
**Purpose:** Show scheduling module overview

---

### SCENE 10 — CREATE NEW APPOINTMENT
**Duration:** 13 seconds
**Screen:** `NewAppointment` form

**Action:**
1. Click **موعد جديد** button (top right)
2. Form opens — fill each field:
   - **العميل:** Click dropdown → select `أحمد محمد العلي` (the one created in Scene 5)
   - **نوع الخدمة:** Select **صيانة**
   - **التاريخ:** Click date picker → select tomorrow's date
   - **الوقت:** Select `10:00 ص`
   - **ملاحظات:** Type `فحص المرشح الرئيسي`
3. Click **حفظ الموعد**
4. Appointment appears in list with "مجدول" badge

**Text Overlay sequence:**
1. `إنشاء موعد خدمة جديد` (0s, 4s duration)
2. `ربط الموعد بالعميل والفني المناسب` (5s, 4s duration)
3. `تم جدولة الموعد بنجاح` (success toast moment, 3s)

**Camera:**
- Start: medium zoom showing form
- During customer dropdown: zoom toward dropdown
- On success: pull back to show full form + success state

**Purpose:** Core scheduling workflow

---

### SCENE 11 — ASSIGN TECHNICIAN
**Duration:** 8 seconds
**Screen:** Task detail or appointment detail page — technician assignment

**Action:**
1. Navigate to the task associated with the appointment (or the task list)
2. Open the task — find **تعيين الفني** field
3. Click — dropdown shows available technicians
4. Hover over technician name for 1 second
5. Click to select
6. Task updates — technician name appears with status "في الانتظار"

**Text Overlay:**
```
تعيين الفني المناسب للمهمة
```

**Camera:**
- Zoom in on the technician selection dropdown
- Hold on assigned result for 2 seconds

**Highlight:** Blue ring around the technician name when selected
**Purpose:** Task assignment — connects scheduling to field team

---

### SCENE 12 — ROLE TRANSITION ANIMATION — TECHNICIAN
**Duration:** 4 seconds
**Visual:** Same transition overlay as Scene 8 but with orange wrench icon

**Text Overlay:**
```
الآن — قسم الفنيين
```

**Purpose:** Clean role switch to field technician view

---

### SCENE 13 — TECHNICIAN WORK QUEUE
**Duration:** 7 seconds
**Screen:** Technician `WorkQueue` page

**Action:**
1. Work queue loads — task assigned in Scene 11 is visible at the top
2. Task card shows: customer name, address, appointment type, status badge "معتمد"
3. Cursor slowly hovers over the task card — it lifts slightly (hover effect)
4. Pause 2 seconds on the task card

**Text Overlay:**
```
قائمة المهام المخصصة للفني
```

**Camera:** Medium zoom — task cards clearly readable
**Purpose:** Show technician's personal view — only their tasks

---

### SCENE 14 — TASK DETAIL VIEW
**Duration:** 8 seconds
**Screen:** `TaskDetail` page

**Action:**
1. Click the task card
2. Task detail opens — show all fields:
   - Customer name and address
   - Task type
   - Status badge
   - Notes from scheduling
   - Action buttons at bottom: **ابدأ العمل** / **تأجيل**
3. Cursor moves across each field slowly

**Text Overlay:**
```
تفاصيل كاملة عن كل مهمة خدمية
```

**Camera:** Scroll slowly down the task detail page
**Purpose:** Information density — technician has all context needed

---

### SCENE 15 — TECHNICIAN UPDATES TASK STATUS
**Duration:** 9 seconds
**Screen:** Task detail page — status transition

**Action:**
1. Cursor hovers over **ابدأ العمل** button
2. Highlight ring pulses around it
3. Click — status changes from "معتمد" to "قيد التنفيذ" (yellow badge)
4. Hold 2 seconds on the new badge
5. Cursor moves to **إتمام المهمة** button
6. Highlight ring pulses
7. Click — status changes to "مكتمل" (green badge)
8. Hold 2 seconds on the green badge

**Text Overlay sequence:**
1. `بدء تنفيذ المهمة` (at first click, 3s)
2. `تحديث الحالة لحظياً` (during transition, 2s)
3. `تم إتمام المهمة بنجاح ✓` (on green badge, 3s)

**Camera:**
- Medium zoom on action buttons
- Punch zoom (1.0 → 1.1 → 1.0) on badge the moment it turns green

**Highlight:** Green glow effect on the completion badge
**Purpose:** Core task lifecycle — the money shot of the demo

---

### SCENE 16 — REAL-TIME NOTIFICATION
**Duration:** 9 seconds
**Screen:** Split concept — show notification appearing

**Action:**
1. Stay on technician view for 1 second post-completion
2. Show the notification bell icon in sidebar — badge count increments (+1)
3. Click the bell / navigate to Notifications
4. Notification appears: "تم إتمام المهمة — أحمد محمد العلي"
5. Show relative timestamp: "الآن"
6. Cursor hovers over the notification

**Text Overlay:**
```
الإشعارات الفورية — تنسيق آني بين الأقسام
```

**Camera:**
- Fast cut to notification panel
- Zoom in on the new notification card
- Hold 3 seconds

**Highlight:** Soft glow animation on the notification card as it appears
**Purpose:** Demonstrate real-time sync — one team's action is instantly visible to others

---

### SCENE 17 — ACTIVITY LOG (CROSS-DEPARTMENT)
**Duration:** 7 seconds
**Screen:** Messages / Activity Log page (any department)

**Action:**
1. Navigate to **سجل النشاط** (Messages/Activity page)
2. Show the live activity feed — several entries visible
3. The task completion from Scene 15 appears at the top
4. Scroll slowly through 3–4 entries

**Text Overlay:**
```
سجل كامل لجميع العمليات — شفافية تامة
```

**Camera:** Medium wide — show multiple activity entries
**Purpose:** Audit trail — full accountability across departments

---

### SCENE 18 — SETTINGS PAGE
**Duration:** 8 seconds
**Screen:** Settings page (Admin or any role)

**Action:**
1. Navigate to Settings
2. Slowly scroll through settings sections visible on screen:
   - **المظهر** (Theme) — Light/Dark/System controls visible
   - **حجم الخط** (Font Size) — size options visible
   - **إمكانية الوصول** (Accessibility) — toggle switches visible
   - **الإشعارات** (Notifications) — toggle visible
3. Click the Dark mode option — UI switches to dark
4. Hold 1.5 seconds on dark mode
5. Click back to Light mode

**Text Overlay sequence:**
1. `إعدادات مخصصة لكل مستخدم` (0s, 4s)
2. `واجهة مرنة تتكيف مع احتياجاتك` (4s, 4s)

**Camera:** Medium zoom — settings cards clearly visible
**Purpose:** Show personalization — each team member controls their own experience

---

### SCENE 19 — OUTRO / BRANDING
**Duration:** 8 seconds
**Screen:** Admin dashboard (return to starting point)

**Action:**
1. Navigate back to Admin dashboard
2. Dashboard cards visible — full system overview
3. After 3 seconds, a full-screen overlay fades in (editor adds this — not in app):

**Outro overlay (editor-created):**
- Background: dark slate `#0F172A` fading in over the dashboard
- Logo/text centered:
  ```
  Pure Home
  إدارة ذكية لفرق العمل والخدمات
  ```
- Three role icons appear below (Admin, Scheduling, Technician) — left to right with stagger
- Website or GitHub link (optional): `github.com/Fahd070/pure-home`
- Music gentle swell then fade to silence

**Text Overlay (centered, large):**
```
Pure Home
إدارة ذكية لفرق العمل والخدمات
```

**Camera:** Slow zoom out on dashboard before overlay
**Transition:** Overlay fades in over 1.5 seconds
**Purpose:** Brand close — leave viewer with the product name and value statement

---

## COMPLETE SCENE TABLE

| # | Scene | Screen | Duration | Overlay Text |
|---|---|---|---|---|
| 1 | Intro title | Black | 5s | Pure Home / نظام إدارة العمليات |
| 2 | Department selector | DepartmentSelector | 6s | اختر دورك للبدء |
| 3 | Admin login | CodeEntry | 5s | تسجيل الدخول — قسم الإدارة |
| 4 | Admin dashboard | Dashboard | 10s | لوحة التحكم — نظرة عامة |
| 5 | Create customer | AddCustomer | 14s | إضافة عميل جديد |
| 6 | Approve customer | CustomerDetail | 8s | اعتماد العميل |
| 7 | Customer list | Customers | 6s | قائمة العملاء |
| 8 | Role transition | Overlay | 4s | الآن — قسم الجدولة |
| 9 | Appointments list | Appointments | 7s | إدارة جميع المواعيد |
| 10 | Create appointment | NewAppointment | 13s | إنشاء موعد خدمة جديد |
| 11 | Assign technician | TaskDetail | 8s | تعيين الفني المناسب |
| 12 | Role transition | Overlay | 4s | الآن — قسم الفنيين |
| 13 | Technician queue | WorkQueue | 7s | قائمة المهام المخصصة |
| 14 | Task detail | TaskDetail | 8s | تفاصيل كاملة عن المهمة |
| 15 | Update task status | TaskDetail | 9s | بدء تنفيذ المهمة → مكتمل |
| 16 | Notification | Notifications | 9s | الإشعارات الفورية |
| 17 | Activity log | Messages | 7s | سجل النشاط الكامل |
| 18 | Settings | Settings | 8s | إعدادات مخصصة لكل مستخدم |
| 19 | Outro branding | Overlay | 8s | Pure Home / إدارة ذكية |

**Total:** 19 scenes — ~2 minutes 30 seconds

---

## OBS STUDIO RECORDING SETUP

### Before you start
1. Set Windows display scaling to 125%
2. Switch app language to Arabic (Settings page → language icon)
3. Set OBS output resolution to 1920×1080, 60fps
4. Enable cursor recording in OBS (Tools → Settings → Hotkeys)
5. Use a large cursor (Windows: Settings → Ease of Access → Mouse pointer size 3)
6. Have the music track ready in an audio editor — will be layered in post

### OBS Scene setup
- Source 1: Window Capture → Pure Home application window
- Source 2: Desktop Audio (muted during recording — add music in post)
- No webcam
- Resolution: 1920×1080

### Recording order
Record scenes 1–7 (Admin role), then scenes 9–11 (Scheduling role), then scenes 13–18 (Technician role) as three separate recordings. Edit together in video editor.

---

## VIDEO EDITOR CHECKLIST

- [ ] Import all three recordings (Admin, Scheduling, Technician)
- [ ] Cut between scenes per duration table above
- [ ] Add role transition overlay animations (Scenes 8, 12)
- [ ] Add Arabic text overlays per storyboard (font: Cairo or Tajawal — Google Fonts)
- [ ] Add highlight rings on key clicks (circular glow, blue/green)
- [ ] Add status badge zoom punches (Scenes 6, 15)
- [ ] Add intro title card (Scene 1 — black background)
- [ ] Add outro branding overlay (Scene 19)
- [ ] Layer background music track — fade in at 0:00, fade out at 2:30
- [ ] Export as MP4, H.264, 1920×1080, 60fps
- [ ] Review: all Arabic text is right-to-left and readable

---

## RECOMMENDED FREE TOOLS

| Tool | Purpose |
|---|---|
| OBS Studio | Screen recording (free, open source) |
| DaVinci Resolve | Video editing, color, overlays (free tier) |
| CapCut Desktop | Quick editing + text overlays (free) |
| Pixabay Audio | Royalty-free background music |
| Google Fonts — Cairo | Arabic text overlays |
| Canva | Role icon / character creation |
