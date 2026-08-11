const fbAdmin = require('firebase-admin'),
      fbServiceAccount = require('./firebase-account-key.json');
const {startMonitoringListings} = require("./app/listings");

// LAST RESORT. This image is node:16, where the default for an unhandled
// rejection is to TERMINATE — which is how a single flaky ESPN feed took the
// whole notifier down. Docker's `--restart unless-stopped` then made it worse,
// not better: `todaysScores` lives only in memory, so every bounce erased the
// baseline and the first tick after restart treated every game as new and
// pushed nothing. Crash-looping faster than two ticks meant a container that
// looked healthy and emitted silence for hours.
//
// app/listings.js now guards each feed, the batch, and the whole tick. These
// handlers exist so that anything still escaping is LOUD and survivable rather
// than fatal. If these ever fire, the stack tells you what the guards missed —
// treat that as a bug to fix, not as normal operation.
process.on('unhandledRejection', (reason) => {
    console.error('[notifier] UNHANDLED REJECTION (staying up):',
        reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
    console.error('[notifier] UNCAUGHT EXCEPTION (staying up):',
        err && err.stack ? err.stack : err);
});

fbAdmin.initializeApp({
    credential: fbAdmin.credential.cert(fbServiceAccount),
    databaseURL: "https://the-sports-remote-272021.firebaseio.com"
});

startMonitoringListings(fbAdmin);
