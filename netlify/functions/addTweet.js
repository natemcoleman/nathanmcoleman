// const fs = require('fs');
// const path = require('path');

// const fetch = require('node-fetch');

// exports.handler = async (event, context) => {
//     if (event.httpMethod !== 'POST') {
//         return {
//             statusCode: 405,
//             body: 'Method Not Allowed',
//         };
//     }

//     const tweet = JSON.parse(event.body);
//     const tweetsFilePath = path.join(__dirname, 'tweets.json');

//     let tweets = [];
//     if (fs.existsSync(tweetsFilePath)) {
//         tweets = JSON.parse(fs.readFileSync(tweetsFilePath, 'utf8'));
//     }

//     tweets.push(tweet);

//     fs.writeFileSync(tweetsFilePath, JSON.stringify(tweets, null, 2));

//     await fetch('https://api.netlify.com/build_hooks/6784209abc84a1a685b00e2e', {
//         method: 'POST',
//     });

//     return {
//         statusCode: 200,
//         body: JSON.stringify({ message: 'Tweet added successfully' }),
//     };
// };
const fs = require('fs');
const path = require('path');

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: 'Method Not Allowed',
        };
    }

    const tweet = JSON.parse(event.body);
    const tweetsFilePath = path.join(__dirname, 'tweets.json');

    let tweets = [];
    if (fs.existsSync(tweetsFilePath)) {
        tweets = JSON.parse(fs.readFileSync(tweetsFilePath, 'utf8'));
    }

    tweets.push(tweet);

    fs.writeFileSync(tweetsFilePath, JSON.stringify(tweets, null, 2));

    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Tweet added successfully' }),
    };
};