const fbAdmin = require('firebase-admin'),
      fbServiceAccount = require('./firebase-account-key.json');
const {startMonitoringListings} = require("./app/listings");

fbAdmin.initializeApp({
    credential: fbAdmin.credential.cert(fbServiceAccount),
    databaseURL: "https://the-sports-remote-272021.firebaseio.com"
});

startMonitoringListings(fbAdmin);
