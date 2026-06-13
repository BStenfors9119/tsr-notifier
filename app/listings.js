const ns = require('node-schedule'),
    moment = require('moment'),
    momentTz = require('moment-timezone'),
    bytes = require('utf8-length')
    scores = require('./scores');

const getScores = (tzOffset, gameDay) => {
    let allScores = [];
    console.log('get scores: ', gameDay);
    return new Promise((res, rej) => {
        let nflScorePromise = scores.loadNflScores(tzOffset, gameDay);
        let nbaScoresPromise = scores.loadNbaScores(tzOffset, gameDay);
        let mlbScoresPromise = scores.loadMlbScores(tzOffset, gameDay);
        let nhlScoresPromise = scores.loadNhlScores(tzOffset, gameDay);
        let ncaafScoresPromise = scores.loadNcaafScores(tzOffset, gameDay);
        let ncaabScoresPromise = scores.loadNcaabScores(tzOffset, gameDay);
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
            scores.loadSoccerScores(league, tzOffset, gameDay)
                .catch(() => JSON.stringify({ events: [] })));
        // FIFA World Cup uses its own named loader (the marquee competition).
        const fifaWorldCupPromise = scores.loadFifaWorldCupScores(tzOffset, gameDay)
            .catch(() => JSON.stringify({ events: [] }));

        try {
            console.time("get Scores time");
            Promise.all([nflScorePromise, nbaScoresPromise, mlbScoresPromise, nhlScoresPromise,
                ncaafScoresPromise, ncaabScoresPromise,
                fifaWorldCupPromise, ...soccerScorePromises])
                .then(async (scores) => {
                    // console.log('day: ', day);
                    scores.forEach((leagueScores) => {
                        // console.log('league scores');
                        // console.log(leagueScores);
                        let events = JSON.parse(leagueScores).events;
                        if (events !== undefined) {
                            allScores.push(...events);
                        }
                    });

                    res(allScores);
                });
            console.timeEnd("get Scores time");
        } catch (err) {
            // console.log('Error loading scores', err);
            rej('Error loading scores');
        }
    })

}

const startMonitoringListings = async (fbAdmin) => {
    const tz = "America/Los_Angeles";
    let todaysScores = [];
    ns.scheduleJob('*/15 * * * * *', async () => {
        const today = momentTz().tz(tz).format("YYYYMMDD");
        console.log('today: ', today);
        let updatedScores = [];
        // console.log('scheduled job: ', todaysScores.length);
        if(todaysScores.length > 0) {
            todaysScores.forEach((score, idx, arr) => {
                // console.log('score date: ', moment(score.date));
                const scoreDate = momentTz(score.date).tz(tz).isBefore(today);
                console.log('score date: ', score.date, scoreDate);
                if (scoreDate) {
                    arr.splice(idx, 1);
                }
            })
        }
        // console.log('monitoring: ', todaysScores.length);
        const scores = await getScores('', today)
        scores.forEach(score => {
            const scoreOne = score.competitions[0].competitors[1].score;
            const scoreTwo = score.competitions[0].competitors[0].score;
            const lastPlay = score.competitions[0].situation !== undefined
            && score.competitions[0].situation.lastPlay !== undefined
                ? score.competitions[0].situation.lastPlay.text : '';
            const timeAndPeriod = score.status.type.detail;
            // console.log('score name: ', score.id, score.name, scoreOne, scoreTwo);
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
                    todaysScores.splice(scoreExistsIndex, 1);
                    updatedScores.push(newScore);
                    console.log('score updated: ', score.name, `( ${lastPlay} )`);
                }
            }
        });


        // console.log('scores: ', todaysScores.length);
        if(updatedScores.length > 0) {
            console.log(bytes(JSON.stringify(updatedScores)));
            sendScoreUpdateMessage(updatedScores, fbAdmin);
        }
        // console.log('scores', scores);
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
