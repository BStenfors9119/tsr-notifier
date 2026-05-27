require('request');
require('moment');
const rp = require('request-promise');

    const loadNflScores = async (tzOffset, gameDay) => {
        let scores = rp(
            `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?calendar=blacklist&dates=${gameDay}`);

        return scores;
    }

    const loadMlbScores = async (tzOffset, gameDay) => {
        let scores = rp(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?calendar=blacklist&dates=${gameDay}`);

        return scores;
    }

    const loadNbaScores = async (tzOffset, gameDay) => {
        let scores = rp(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?calendar=blacklist&dates=${gameDay}`);

        return scores;
    }

    const loadNhlScores = async (tzOffset, gameDay) => {
        let scores = rp(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?calendar=blacklist&dates=${gameDay}`);

        return scores;
    }

    const loadNcaafScores = async (tzOffset, gameDay) => {
        let scores = rp(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?calendar=blacklist&dates=${gameDay}&limit=400`);

        return scores;
    }

    const loadNcaabScores = async (tzOffset, gameDay) => {
        let scores = rp(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?calendar=blacklist&dates=${gameDay}&limit=100&groups=50`);

        return scores;
    }

    const loadSoccerScores = async (league, tzOffset, gameDay) => {
        let scores = rp(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard`);

        return scores;
    }

module.exports = {
    loadNflScores: loadNflScores,
    loadMlbScores: loadMlbScores,
    loadNbaScores: loadNbaScores,
    loadNhlScores: loadNhlScores,
    loadNcaafScores: loadNcaafScores,
    loadNcaabScores: loadNcaabScores,
    loadSoccerScores: loadSoccerScores
}
