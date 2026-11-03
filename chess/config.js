// Paste your Firebase web-app config here (Firebase console > Project settings > Your apps).
// The apiKey being public is normal for Firebase web apps.
export const firebaseConfig = {
  apiKey: "PASTE_ME",
  authDomain: "PASTE_ME",
  databaseURL: "PASTE_ME", // looks like https://your-project-default-rtdb.firebaseio.com
  projectId: "PASTE_ME",
  storageBucket: "PASTE_ME",
  messagingSenderId: "PASTE_ME",
  appId: "PASTE_ME",
};

// The two players. w = white (blue ink, moves first), b = black (red ink).
// Names are shown in the game. The same two UIDs must ALSO be pasted into database.rules.json.
export const PLAYERS = { w: { name: "Dad", uid: "PASTE_DAD_UID" }, b: { name: "Kiddo", uid: "PASTE_HER_UID" } };
