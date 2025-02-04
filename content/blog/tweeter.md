---
title: "Feed"
description: 
draft: true
weight: 200

---

<div id="tweets">
    <!-- <script>
    document.addEventListener('DOMContentLoaded', loadTweets);
    </script> -->
</div>

<!-- <form id="tweetForm">
    <input type="text" id="username" placeholder="Username" style="width: 100%; margin-bottom: 10px;">
    <textarea id="tweetText" placeholder="What's happening?" rows="3" style="width: 100%;"></textarea>
    <button type="button" onclick="addTweet()">Post</button>
</form> -->

<style>
.tweet {
    border: 1px solid #e1e8ed;
    padding: 10px;
    margin-bottom: 10px;
    border-radius: 10px;
    background-color: #ffffff;
    border: 5px solidrgb(31, 31, 31);
.tweet p {
    margin: 5px 0;
    color:rgb(27, 27, 27); 
}
.tweet strong {
    color: #1da1f2;
}
.tweet small {
    color: #657786;
}
form {
    margin-top: 20px;
}
</style>

<script>
// async function addTweet() {
//     const username = document.getElementById('username').value;
//     const tweetText = document.getElementById('tweetText').value;
//     if (username.trim() === '' || tweetText.trim() === '') return;

//     const tweet = {
//         username: 'Nate',
//         // username: '@n' + username,
//         text: tweetText,
//         timestamp: new Date().toISOString(),
//     };

//     const response = await fetch('/netlify/functions/addTweet.js', {
//         method: 'POST',
//         body: JSON.stringify(tweet),
//     });

//     if (response.ok) {
//         const tweetContainer = document.createElement('div');
//         tweetContainer.className = 'tweet';
//         tweetContainer.innerHTML = `
//             <p><strong>${tweet.username}</strong> ${tweet.text}</p>
//             <p><small>Just now</small></p>
//         `;

//         document.getElementById('tweets').appendChild(tweetContainer);
//         document.getElementById('tweetText').value = '';
//     } else {
//         console.error('Failed to add tweet');
//     }
// }

// <p><strong>${tweet.username}</strong> ${tweet.text}</p>

async function loadTweets() {
    const response = await fetch('/netlify/functions/tweets.json');
    if (response.ok) {
        const tweets = await response.json();
        const tweetsContainer = document.getElementById('tweets');
        tweets.forEach(tweet => {
            const tweetContainer = document.createElement('div');
            tweetContainer.className = 'tweet';
            tweetContainer.innerHTML = `
                <p>${tweet.text}</p>
                <p><small>${new Date(tweet.timestamp).toLocaleDateString()}</small></p>
            `;
            tweetsContainer.appendChild(tweetContainer);
        });
    } else {
        console.error('Failed to load tweets');
    }
}

document.addEventListener('DOMContentLoaded', loadTweets);
</script>