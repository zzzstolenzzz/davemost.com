// Paste your Firebase web-app config here (Firebase console > Project settings > Your apps).
// The apiKey being public is normal for Firebase web apps.
export const firebaseConfig = {
  apiKey: "AIzaSyAMRpHwcRYyZJI4Ie1UptWKnNulNoaOL2M",
  authDomain: "davemost.com",
  databaseURL: "https://davemostdotcom-default-rtdb.firebaseio.com",
  projectId: "davemostdotcom",
  storageBucket: "davemostdotcom.firebasestorage.app",
  messagingSenderId: "662026952237",
  appId: "1:662026952237:web:0dee8293768f5a874a62a4",
};

// The two players. w = white (blue ink, moves first), b = black (red ink).
// Names are shown in the game. The same two UIDs must ALSO be pasted into database.rules.json.
export const PLAYERS = { w: { name: "Dad", uid: "CRG0lLi3cTUkKFSOcfGEtNBRHbh2" }, b: { name: "Kiddo", uid: "Q07t4Utravf5VKV2PcsWiRLpFIM2" } };
