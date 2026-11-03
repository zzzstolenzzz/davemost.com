# Doodle Chess

Chess drawn in ballpoint pen. Plain HTML/CSS/JS, no build step. Lives at davemost.com/chess.

## Setup

1. Firebase console: create a project, then Build > Realtime Database > Create database (locked mode).
2. Authentication > Get started > Sign-in method > enable Google. Then Authentication > Settings > Authorized domains > add `davemost.com`.
3. Project settings > Your apps > Web app (`</>`). Paste the config into `chess/config.js` (include `databaseURL`).
4. Push, open davemost.com/chess. Each player taps "Player sign-in" and copies their ID.
5. Paste both IDs into `config.js` (PLAYERS) AND `database.rules.json`. Then paste the rules into Firebase > Realtime Database > Rules > Publish. Push again.
6. Customizing:
   - Names: `config.js`.
   - Her ink colour: `--ink-b` in `style.css`.
   - Swap a piece: replace its file in `pieces/` (keep the filename). Use `currentColor`; put eyes in `<g class="eyes">` to make them blink.

## Test on your computer

ES modules don't work from `file://`. Run `python -m http.server 8000` in the chess folder, then open http://localhost:8000 (localhost is pre-authorized for sign-in).

## Security note

Anyone can watch. Only those two Google accounts can move, enforced by the database rules (not just the page). The Firebase apiKey being public is normal.
