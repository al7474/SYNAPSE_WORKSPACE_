# Synapse Workspace: Your Intelligent Second Brain

Synapse Workspace is a note-taking application designed especially for developers and tech students that works in a simple, fast, and automatic way. Here is how you experience it from the very first moment as a user:

---

### 1. Zero-Friction Guest Access (Try Without an Account)
Forget long registration forms or having to verify your email just to test the app. 
* **One-Click Demo:** Click **"Enter Demo Mode"** to instantly enter an isolated workspace.
* **Temporary Session:** The backend creates a temporary guest session with an expiring secure cookie. No password or personal data is required.
* **Full Control:** Use **"Delete demo workspace"** to permanently remove the boards and notes created during the demo.

### 2. Account Access

* **Registration and login:** Account passwords are validated and hashed by the backend. Registration creates an expiring `HttpOnly` session cookie and opens the workspace immediately; if the email is already registered, the form reports that account and asks you to sign in instead.
* **Email verification:** After registration, Synapse sends a single-use verification link. The link is consumed with a protected `POST` request. You can keep creating and editing private boards and notes while verification is pending; sharing and collaborator access management unlock after verification. Local development can use the console email provider, which prints the link in the backend log.
* **Password recovery:** The recovery form always returns the same response whether an email exists or not. A valid, single-use reset link replaces the password and signs out existing sessions.
* **Session protection:** Mutating browser requests use a CSRF token and all account sessions are revoked immediately by logout, password reset, or an authenticated password change. The implementation uses opaque server-side sessions rather than JWTs.
* **Production email:** A delivery provider such as Resend or SMTP is required to send real messages. It does not perform password hashing or token validation; those controls stay in the backend.

### 3. A Super Smooth & Modern Editor
You will write your notes in an editor heavily inspired by Notion. You can organize your content by blocks, create paragraphs, lists, headers, and—most importantly—**code blocks with syntax highlighting** so your programming notes and snippets are incredibly clean and easy to read.

### 4. Invisible & Automatic Saving
As you type, the app automatically saves your progress in the background every two to three seconds. You do not have to look for a save button; you will never lose your information if your tab closes or your connection drops. A subtle indicator on the screen always confirms when your workspace is fully synced and safe in the database.

### 5. The Magic of Intelligent Search
This is the platform's star feature. Instead of searching for notes using exact words, you can press `Ctrl + K` (or `Cmd + K`) to open the command palette and type natural sentences, just like you would talk to a friend or an AI. 

> **Example:** If you have a note about Docker commands, and you type *"how to package my application using containers"* in the search bar, the app will understand the concept. It will show you that Docker note instantly, even if you never explicitly wrote the word "container" inside it. It searches by the **meaning behind your words**, not just exact text matches.

### 6. Developer-Focused Sharing (Async Collaboration)
Need to share a complex configuration file, a deployment guide, or study notes with your team? Synapse allows you to collaborate without the bloat. 
* **Public Links:** Instantly generate a secure, read-only public URL for any note to share with external developers.
* **Shared Workspaces:** Invite team members to your workspace via email to build a shared internal knowledge base, ensuring everyone stays on the same page while keeping your personal workspaces strictly private.

### 7. Interruption-Free & Secure
If the AI service that analyzes your notes gets saturated, fails, or lags due to external connection issues, your writing experience is never interrupted. Your notes will save normally in the database the traditional way, and the system will queue them to be analyzed by the AI as soon as the service is fully restored. This ensures the editor remains lightning-fast and responsive at all times. 