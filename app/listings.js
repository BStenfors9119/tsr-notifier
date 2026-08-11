const ns = require('node-schedule'),
    moment = require('moment'),
    momentTz = require('moment-timezone'),
    bytes = require('utf8-length')
    scores = require('./scores');

// EVERY feed promise must go through this. An unguarded reject here was the
// outage: Promise.all below rejects, the `.then` that calls res() never runs, so
// getScores NEVER SETTLES — and the surrounding try/catch can't see an async
// rejection. On Node >= 15 (this image is node:16) that unhandled rejection also
// TERMINATES the process; `--restart unless-stopped` then bounces the container,
// which wipes the in-memory `todaysScores` baseline, so the first tick after
// restart treats every game as new and sends nothing. Crash faster than two
// ticks and it can never push an update at all — a live-looking container
// emitting silence. One flaky ESPN endpoint was enough to trigger the whole
// chain. An empty scoreboard is always a safe substitute for a failed one.
const guard = (promise, label) =>
    promise.catch((err) => {
        console.warn(`[scores] ${label} feed failed:`, err && err.message);
        return JSON.stringify({ events: [] });
    });

const getScores = (tzOffset, gameDay) => {
    let allScores = [];
    return new Promise((res, rej) => {
        let nflScorePromise = guard(scores.loadNflScores(tzOffset, gameDay), 'nfl');
        let nbaScoresPromise = guard(scores.loadNbaScores(tzOffset, gameDay), 'nba');
        let mlbScoresPromise = guard(scores.loadMlbScores(tzOffset, gameDay), 'mlb');
        let nhlScoresPromise = guard(scores.loadNhlScores(tzOffset, gameDay), 'nhl');
        let ncaafScoresPromise = guard(scores.loadNcaafScores(tzOffset, gameDay), 'ncaaf');
        let ncaabScoresPromise = guard(scores.loadNcaabScores(tzOffset, gameDay), 'ncaab');
        // Soccer scoreboards — must mirror backend/app/game/games.api.js so the
        // notifier pushes live updates for the same competitions the forecast
        // attaches (the client matches pushes to listings by ESPN uid). Same
        // ESPN soccer URL via loadSoccerScores; each .catch-guarded so one bad
        // league can't reject Promise.all and stop ALL score pushes.
        const soccerLeagues = [
            'uefa.champions',                                              // UEFA Champions League
            'eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1',                  // top European leagues
            'usa.1', 'mex.1', 'arg.copa_lpf',                             // MLS, Liga MX, Argentina
            'fifa.worldq.conmebol', 'fifa.worldq.uefa', 'fifa.worldq.concacaf', // WC qualifiers
            'fifa.friendly', 'conmebol.america'                            // friendlies, Copa America
        ];
        const soccerScorePromises = soccerLeagues.map((league) =>
            guard(scores.loadSoccerScores(league, tzOffset, gameDay), `soccer:${league}`));
        // FIFA World Cup uses its own named loader (the marquee competition).
        const fifaWorldCupPromise = guard(
            scores.loadFifaWorldCupScores(tzOffset, gameDay), 'fifa.world');

        Promise.all([nflScorePromise, nbaScoresPromise, mlbScoresPromise, nhlScoresPromise,
            ncaafScoresPromise, ncaabScoresPromise,
            fifaWorldCupPromise, ...soccerScorePromises])
            .then((leagueResults) => {
                leagueResults.forEach((leagueScores) => {
                    // Body may be unparseable even on a 200 (ESPN occasionally
                    // serves an HTML error page). Never let that kill the batch.
                    try {
                        const events = JSON.parse(leagueScores).events;
                        if (events !== undefined) allScores.push(...events);
                    } catch (err) {
                        console.warn('[scores] unparseable feed body:', err && err.message);
                    }
                });
                res(allScores);
            })
            // Belt to guard()'s braces: even with every feed caught, a throw
            // inside the .then above would otherwise leave this promise pending
            // forever. Resolve with whatever we have rather than hanging.
            .catch((err) => {
                console.warn('[scores] batch failed, using partial set:', err && err.message);
                res(allScores);
            });
    })

}

const HEARTBEAT_MS = 5 * 60 * 1000;

const startMonitoringListings = async (fbAdmin) => {
    const tz = "America/Los_Angeles";
    let todaysScores = [];
    let lastHeartbeat = 0;
    // The whole tick is wrapped: node-schedule does not catch throws from an
    // async callback, so anything escaping here became an unhandled rejection
    // and (Node >= 15) took the process down. A bad tick must cost one tick,
    // never the service — a restart is what wipes `todaysScores` and blinds the
    // next tick's diff.
    ns.scheduleJob('*/15 * * * * *', async () => {
      try {
        const today = momentTz().tz(tz).format("YYYYMMDD");
        let updatedScores = [];
        // Drop anything from a previous day. Rebuilt with filter() rather than
        // splice()-inside-forEach, which shifts the array under the iterator and
        // skips every element after a removal. `date` is already a YYYYMMDD
        // string, so compare as strings — re-parsing it through moment was both
        // needless and per-item log spam (~140 cached games x 4 ticks/min).
        if (todaysScores.length > 0) {
            const before = todaysScores.length;
            todaysScores = todaysScores.filter((s) => s.date >= today);
            if (before !== todaysScores.length) {
                console.log(`[scores] purged ${before - todaysScores.length} stale game(s)`);
            }
        }
        // console.log('monitoring: ', todaysScores.length);
        const scores = await getScores('', today)
        scores.forEach(score => {
            // Every read below was unguarded. A single event missing
            // competitions/competitors/status — postponed games and some soccer
            // fixtures ship exactly that — threw inside this forEach, and with
            // no try/catch anywhere up the stack that became an unhandled
            // rejection and killed the process. One bad event must never cost us
            // the other ~140.
            const competition = score && score.competitions && score.competitions[0];
            const competitors = (competition && competition.competitors) || [];
            const detail = score && score.status && score.status.type
                && score.status.type.detail;
            if (!competition || competitors.length < 2 || !detail) return;

            const scoreOne = competitors[1].score;
            const scoreTwo = competitors[0].score;
            const lastPlay = competition.situation !== undefined
            && competition.situation.lastPlay !== undefined
                ? competition.situation.lastPlay.text : '';
            const timeAndPeriod = detail;
            const scoreDate = momentTz(score.date).tz(tz).format("YYYYMMDD");

            const scoreExistsIndex = todaysScores.findIndex(s => s.id === score.uid);
            const newScore = {
                id: score.uid,
                date: scoreDate,
                scoreOne: scoreOne,
                scoreTwo: scoreTwo,
                timeAndPeriod: timeAndPeriod,
                lp: lastPlay
            }

            // newScore.teams.push(teamOne);
            // newScore.teams.push(teamTwo);

            // console.log('score exists: ', scoreExistsIndex);
            if (scoreDate === today
                && scoreExistsIndex === -1) {
                todaysScores.push(newScore);
            }

            if (scoreExistsIndex > -1) {
                const existingScore = todaysScores[scoreExistsIndex];
                if (existingScore.scoreOne !== scoreOne
                    || existingScore.scoreTwo !== scoreTwo
                    || existingScore.timeAndPeriod !== timeAndPeriod) {
                    // REPLACE in place. The old code spliced the game out and
                    // never put it back, so the next tick re-added it via the
                    // "new game" branch above — meaning a change could only be
                    // detected every OTHER tick (30s, not 15s) and the tick that
                    // re-added it silently swallowed whatever changed meanwhile.
                    todaysScores[scoreExistsIndex] = newScore;
                    updatedScores.push(newScore);
                    console.log('score updated: ', score.name, `( ${lastPlay} )`);
                }
            }
        });

        if(updatedScores.length > 0) {
            console.log(`[scores] pushing ${updatedScores.length} update(s), ${bytes(JSON.stringify(updatedScores))} bytes`);
            await sendScoreUpdateMessage(updatedScores, fbAdmin);
        }

        // Heartbeat. Without it a silent notifier and a working one look
        // identical in the logs, which is what made this outage hard to spot.
        const now = Date.now();
        if (now - lastHeartbeat > HEARTBEAT_MS) {
            lastHeartbeat = now;
            console.log(`[scores] alive — tracking ${todaysScores.length} game(s) for ${today}`);
        }
      } catch (err) {
        console.error('[scores] tick failed (service continues):', err && err.stack ? err.stack : err);
      }
    })

    const sendScoreUpdateMessage = async (updatedScores, fbAdmin) => {
            let topic = "scores_updated";
            // let replyTopic = messageInfo.replyTopic !== undefined ? messageInfo.replyTopic.toString() : '';

            let message = {
                data: {
                    updatedScores: JSON.stringify(updatedScores),
                    setting: "scores_updated"
                },
                apns:{
                    payload: {
                        aps: {
                            'content-available': true
                        }
                    }
                },
                topic: topic
            };

        // console.log('msg info payload');
        // console.log(message);


        try {
            const msgSent = await fbAdmin.messaging().send(message);
            console.log('msg sent: ', msgSent);
        } catch (err) {
            console.log('Error sending score pub / sub: ', err);
        }

        // console.log('msg sent result: ', msgSentResult);
    }
}

module.exports = {
    startMonitoringListings
}
