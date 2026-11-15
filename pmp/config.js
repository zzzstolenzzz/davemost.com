// Same Firebase project as chess/cats. The apiKey being public is normal for Firebase web apps.
export const firebaseConfig = {
  apiKey: "AIzaSyAMRpHwcRYyZJI4Ie1UptWKnNulNoaOL2M",
  authDomain: "davemost.com",
  databaseURL: "https://davemostdotcom-default-rtdb.firebaseio.com",
  projectId: "davemostdotcom",
  storageBucket: "davemostdotcom.firebasestorage.app",
  messagingSenderId: "662026952237",
  appId: "1:662026952237:web:0dee8293768f5a874a62a4",
};

// The only account allowed in. Must match the "pmp" rule in database.rules.json.
export const OWNER_UID = "CRG0lLi3cTUkKFSOcfGEtNBRHbh2";
