# TBFT Google Drive setup

TBFT uses Google Drive for document bytes and Supabase only for metadata, folder relationships, and activity history.

## 1. Supabase

Run `supabase/google-drive-storage-v1.sql` once after the existing file-space hierarchy migrations.

Copy the project service-role key for the Netlify server environment. Never expose it through a `NEXT_PUBLIC_` variable.

## 2. Google Cloud

1. Create or select a Google Cloud project.
2. Enable **Google Drive API**.
3. Open **Google Auth Platform** and configure Branding/Audience.
4. If Audience is External and the app is still in Testing, add the Google accounts that will test TBFT.
5. Under **Data Access**, add `https://www.googleapis.com/auth/drive.file`.
6. Open **Clients** and create an OAuth client with application type **Web application**.
7. Add this authorized redirect URI exactly:
   `https://tbft.marzan.info/api/google-drive/callback`
8. Copy the OAuth Client ID and Client Secret.

TBFT also requests the standard `openid` and `email` scopes so it can show which Google account owns the connected Drive root.

Important: External OAuth apps left in Google's **Testing** publishing state receive refresh tokens that expire after 7 days when Drive access is requested. After the initial test, move the OAuth app to **In production** if you want a persistent connection.

## 3. Netlify environment variables

Add these server-side environment variables and redeploy:

```text
SUPABASE_SERVICE_ROLE_KEY=...
GOOGLE_DRIVE_CLIENT_ID=...
GOOGLE_DRIVE_CLIENT_SECRET=...
GOOGLE_DRIVE_SERVER_SECRET=...
GOOGLE_DRIVE_REDIRECT_URI=https://tbft.marzan.info/api/google-drive/callback
```

Generate `GOOGLE_DRIVE_SERVER_SECRET` as a long random value (for example 32 random bytes or more). It is used to sign OAuth state and encrypt the stored Google refresh token.

Do not prefix any of these variables with `NEXT_PUBLIC_`.

## 4. Connect TBFT

1. Redeploy TBFT.
2. Sign in as the TBFT workspace owner.
3. Open **Settings → Google Drive**.
4. Click **Connect Google Drive**.
5. Approve the requested Google permissions.

TBFT creates one `TBFT` root folder in the connected account and mirrors the logical hierarchy beneath it:

```text
TBFT/
├─ <Project>/
│  └─ <normal project task>/
└─ Fucking Lonely Tasks/
   └─ <normal standalone task>/
```

Recurring task roots and generated recurring occurrences never create folders.

When possible, TBFT shares the root folder with the other workspace member's TBFT account email. If their Google account uses a different email address, share the `TBFT` root folder with that Google account manually in Drive.

## Storage behavior

- New uploads use Google Drive, not Supabase Storage.
- The browser uploads file bytes directly to Google's resumable upload session.
- Supabase stores the Drive file/folder IDs, URLs, MIME type, size, ownership metadata, and activity history.
- Existing prototype files already stored in Supabase remain readable/removable.
- Disconnecting Drive does not delete files already present in Google Drive.
