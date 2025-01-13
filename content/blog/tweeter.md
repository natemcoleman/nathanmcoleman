---
title: "Tweets"
description: "A feed of short messages that look like tweets"
draft: true
---

<div id="tweets">
    <div class="tweet">
        <p><strong>@natec</strong> Just finished a new project! #excited</p>
        <p><small>2h ago</small></p>
    </div>
    <div class="tweet">
        <p><strong>@natec</strong> Working on some new ideas for my next blog post. Stay tuned! #blogging</p>
        <p><small>1d ago</small></p>
    </div>
    <div class="tweet">
        <p><strong>@natec</strong> Exploring the world of 3D printing. It's amazing what you can create! #3Dprinting</p>
        <p><small>3d ago</small></p>
    </div>
</div>

<form id="tweetForm">
    <textarea id="tweetText" placeholder="What's happening?" rows="3" style="width: 100%;"></textarea>
    <button type="button" onclick="addTweet()">Tweet</button>
</form>

<style>
.tweet {
    border: 1px solid #e1e8ed;
    padding: 10px;
    margin-bottom: 10px;
    border-radius: 10px;
    background-color: #ffffff;
    color: #000000;
}
.tweet p {
    margin: 5px 0;
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
<!-- 
<script>
function addTweet() {
    const tweetText = document.getElementById('tweetText').value;
    if (tweetText.trim() === '') return;

    const tweetContainer = document.createElement('div');
    tweetContainer.className = 'tweet';
    tweetContainer.innerHTML = `
        <p><strong>@natec</strong> ${tweetText}</p>
        <p><small>Just now</small></p>
    `;

    document.getElementById('tweets').appendChild(tweetContainer);
    document.getElementById('tweetText').value = '';
}
</script> -->


<script>
async function addTweet() {
    const tweetText = document.getElementById('tweetText').value;
    if (tweetText.trim() === '') return;

    const tweet = {
        username: '@natec',
        text: tweetText,
        timestamp: new Date().toISOString(),
    };

    const response = await fetch('/.netlify/functions/addTweet', {
        method: 'POST',
        body: JSON.stringify(tweet),
    });

    if (response.ok) {
        const tweetContainer = document.createElement('div');
        tweetContainer.className = 'tweet';
        tweetContainer.innerHTML = `
            <p><strong>${tweet.username}</strong> ${tweet.text}</p>
            <p><small>Just now</small></p>
        `;

        document.getElementById('tweets').appendChild(tweetContainer);
        document.getElementById('tweetText').value = '';
    } else {
        console.error('Failed to add tweet');
    }
}
</script>

