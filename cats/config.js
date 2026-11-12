// Same Firebase project/config as chess. (Public web-app config; the real guard is database.rules.)
export const firebaseConfig = {
  apiKey: "AIzaSyAMRpHwcRYyZJI4Ie1UptWKnNulNoaOL2M",
  authDomain: "davemost.com",
  databaseURL: "https://davemostdotcom-default-rtdb.firebaseio.com",
  projectId: "davemostdotcom",
  storageBucket: "davemostdotcom.firebasestorage.app",
  messagingSenderId: "662026952237",
  appId: "1:662026952237:web:0dee8293768f5a874a62a4",
};

// Only these Google accounts can play. The SAME uids must also be in database.rules.fragment.json.
// TODO: add the second daughter's UID here (she can sign in and copy it from the locked screen).
export const ALLOWED_UIDS = [
  "CRG0lLi3cTUkKFSOcfGEtNBRHbh2", // Dad, for testing
  "Q07t4Utravf5VKV2PcsWiRLpFIM2", // Reagan
];

// Cat looks. Swap colors/markings here to match real cat photos later.
// variants: alternate fur palettes (sold in the shop as "Looks"); the base look above always stays the identity.
// markings: "stripes" | "patches" | "none"
export const CATS = [
  { id: "cat1", name: "Cat 1", body: "#f2a65a", belly: "#fff3e0", markings: "stripes", markingColor: "#c46a2b", eyes: "#7ccf5a", nose: "#f48fb1",
    variants: [{ id: "cocoa", name: "Cocoa", body: "#9a6a4a", belly: "#f1dcc4", markingColor: "#5e3b26" }, { id: "snow", name: "Snowy", body: "#fff4e8", belly: "#ffffff", markingColor: "#f0c9a0" }] },
  { id: "cat2", name: "Cat 2", body: "#f3f0f4", belly: "#ffffff", markings: "patches", markingColor: "#8d97ad", eyes: "#5bb8f0", nose: "#f6a6b8",
    variants: [{ id: "midnight", name: "Midnight", body: "#4b4e6d", belly: "#c9cbe0", markingColor: "#2b2d45" }, { id: "peach", name: "Peachy", body: "#ffd9c7", belly: "#ffffff", markingColor: "#ffab91" }] },
];
