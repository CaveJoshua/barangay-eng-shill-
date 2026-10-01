
STEP 1: OPENING THE PROGRAM

1. Look for Visual Studio Code on your computer.
2. Right-click the icon and click "Run as Administrator".
3. Look at the top left of the screen. Click "File", then click "Open Folder".
4. Find the folder where the system is saved, click it, and then click "Select Folder".

STEP 2: STARTING THE USER DASHBOARD

1. Look at the top menu again. Click "Terminal", then click "New Terminal".
2. A box will open at the bottom of your screen. Click inside it and type these commands. Press ENTER on your keyboard after typing each line:

Set-ExecutionPolicy RemoteSigned
node -v
npm run dev

3. Wait a few seconds until you see a message saying "VITE ready".
4. You will see a link that says: http://localhost:5173/
5. Hold the CTRL key on your keyboard and click that link. It will automatically open the system in your browser.
(Note: If clicking doesn't work, highlight the link, press CTRL+C to copy it, open Google Chrome, and press CTRL+V to paste it at the top).

STEP 3: STARTING THE BACKGROUND ENGINE (LOAD BALANCED)

1. Look back at the terminal box at the bottom of Visual Studio Code.
2. On the right side of that box, find and click the "+" (Plus) icon. This opens a second terminal box.
3. Click inside this new box, type one of the following commands, and press ENTER:

   OPTION A (Multi-Core Load Balanced Cluster — Recommended):
   npm run start:cluster
   (Distributes traffic across all available CPU cores with auto-restart on crash)

   OPTION B (Standard Single Instance):
   node server.js

   OPTION C (HTTP Reverse Proxy Load Balancer):
   npm run start:lb

4. The system will show technical startup text and confirm worker processes are active on Port 8000:

* [CORE] System Live on Port 8000
* [MAILER CHECK] Connection Successful!

5. In Google Chrome you may access the administrator portal at: http://localhost:5173/officialslogin

Username: beh005@bh.officials.eng-hill.brg.ph
Password: beh005123456

TROUBLESHOOTING
If the system does not open or you see red error text, make sure you opened the correct folder in Step 1. If it still does not work, please stop and contact the System Admin.