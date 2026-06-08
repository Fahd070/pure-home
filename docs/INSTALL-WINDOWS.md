# WFM System — Windows Installation Guide

Version 1.4.0 | For employee PCs

---

## What You Need

- Windows 10 or Windows 11 (64-bit)
- Internet connection
- The WFM System installer file: `WFM-System-Setup-1.4.0.exe`
- The server URL provided by your IT administrator

---

## Installation Steps

### 1. Run the Installer

Double-click `WFM-System-Setup-1.4.0.exe`.

If Windows shows a SmartScreen warning:
1. Click **More info**
2. Click **Run anyway**

> This warning appears because the app is not signed with a paid code-signing certificate.
> The software is safe — it was built internally.

### 2. Complete the Setup Wizard

- Click **Next** on each screen
- Leave the installation directory as the default (`C:\Program Files\WFM System`)
- Click **Install**
- Click **Finish** when complete

The app will appear in the Start Menu as **WFM System** and on the Desktop.

### 3. First Launch — Enter Server URL

When you open the app for the first time, you will see the **Server Setup** screen.

1. Enter the server URL your IT admin provided:
   ```
   https://wfm-system.onrender.com
   ```
   (The exact URL may differ — ask your admin if unsure)

2. Click **Test Connection** — wait for the green checkmark
3. Click **Save & Continue**

> If the connection test fails, see the Troubleshooting section below.

### 4. Log In with Your Access Code

On the login screen:
1. Select your department (Admin / Scheduling / Technician)
2. Enter your 4-digit access code
3. Click **Login**

Your IT admin will provide your access code.

---

## Updating the App

When a new version is released:

1. Download the new `WFM-System-Setup-X.X.X.exe` installer
2. Run it — it will automatically uninstall the old version first
3. Your settings and server URL will be preserved

---

## Uninstalling

**Option A — Settings:**
1. Open Windows Settings → Apps
2. Search for "WFM System"
3. Click **Uninstall**

**Option B — Control Panel:**
1. Open Control Panel → Programs → Uninstall a program
2. Find "WFM System" in the list
3. Click **Uninstall**

---

## File Locations

| Item | Location |
|---|---|
| App files | `C:\Program Files\WFM System\` |
| App data & settings | `C:\ProgramData\WFM System\` |
| Log files | `C:\ProgramData\WFM System\logs\` |

---

## Connection Problems

**"Test Connection failed" or "Unable to reach server":**
1. Check your internet connection
2. Make sure the URL starts with `https://` — not `http://`
3. Make sure there is no trailing slash at the end of the URL
4. Try opening the URL in a browser — if it loads, the server is running
5. If the server is on Render free tier, it may take up to 30 seconds to wake up on first use — click **Test Connection** again

**"Invalid access code":**
- Double-check the code with your IT admin
- Make sure you selected the correct department before entering the code

**App opens but shows a blank screen:**
1. Close the app
2. Delete the folder `C:\ProgramData\WFM System\`
3. Reopen — you will need to re-enter the server URL

---

## Getting Help

Contact your IT administrator or submit a support request through your company's help desk.

Include the following information:
- What you were trying to do
- The exact error message (take a screenshot if possible)
- The log files from `C:\ProgramData\WFM System\logs\`
