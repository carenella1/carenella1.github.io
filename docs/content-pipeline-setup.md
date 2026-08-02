# Content pipeline: one-time setup

This is a one-time setup. After completing it, the pipeline runs on its own:
once a month it generates an article, a narration-audio track, a slideshow
video (uploaded to YouTube), and a podcast feed entry, then opens a PR labeled
`auto-content` that auto-merges after 72 hours unless you close it or add a
`hold` label. None of the steps below can be done on your behalf — they
involve logging into your own accounts and entering payment details, both of
which are yours to do.

## 1. Anthropic API key (article text generation)

1. Go to the Anthropic Console and create an API key.
2. Add billing (usage-based; this pipeline costs roughly $0.05–0.15/month at
   one article per month).
3. In this repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `ANTHROPIC_API_KEY`
   - Value: the key you just created

## 2. OpenAI API key (narration audio / TTS)

1. Go to the OpenAI Platform and create an API key.
2. Add billing (usage-based; roughly $0.10–0.12/month at this word count).
3. Add it as a repo secret named `OPENAI_API_KEY`.

## 3. YouTube upload (uses your existing Google account — no new account)

This is the multi-step one:

1. Go to the Google Cloud Console and create a new project (or reuse an
   existing one) under your existing Google account.
2. Enable the **YouTube Data API v3** for that project (APIs & Services →
   Enable APIs and Services → search for it → Enable).
3. Configure the OAuth consent screen (External or Internal, Testing mode is
   fine — you're the only user of this integration) with the scope
   `https://www.googleapis.com/auth/youtube.upload`.
4. Create an OAuth 2.0 Client ID: **APIs & Services → Credentials → Create
   Credentials → OAuth client ID**. Application type: **Web application**
   (not "Desktop" — a redirect URI is required, see next step).
5. Under **Authorized redirect URIs**, add exactly:
   `http://localhost:8080/oauth2callback`
6. Note the generated **Client ID** and **Client Secret**.
7. On your own machine (not in CI), run the one-time helper script in this
   repo:
   ```bash
   YT_CLIENT_ID=your-client-id YT_CLIENT_SECRET=your-client-secret \
     node scripts/one-time-get-youtube-refresh-token.js
   ```
   It prints a Google sign-in URL — open it, sign in with the Google account
   that owns (or should own) the YouTube channel videos get uploaded to, and
   approve access. The script catches the redirect locally and prints a
   **refresh token**.
8. Add three repo secrets:
   - `YT_CLIENT_ID` — from step 6
   - `YT_CLIENT_SECRET` — from step 6
   - `YT_REFRESH_TOKEN` — printed by the script in step 7

If step 7 doesn't print a refresh token (Google only issues one on first
consent, or when explicitly forced), revoke this app's access at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions)
and run the script again.

## 4. First real run

Once all five secrets are set, trigger the pipeline manually once (rather
than waiting for the monthly cron) to validate the whole chain end to end:

**Actions tab → Monthly Content Pipeline → Run workflow.**

This opens a PR labeled `auto-content`. Review it closely this first time —
the article text, the audio, the video, the YouTube upload, and the podcast
feed entry — before trusting the 72-hour auto-merge to run unattended on
future cycles. To veto any cycle (this one or a future one), either close the
PR or add the `hold` label before the 72-hour window elapses.
