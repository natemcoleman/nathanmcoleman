---
title: '(COMING SOON) Value of Communication in "The Game"'
description: "Probability of success without teamwork"
# date: January 2025
draft: false
weight: 300
tags: ["matlab"]
cover:
    image: "projects/thegame/cover.gif"
---

"The Game" is a cooperative card game where players work together to play cards in numerical order on multiple piles. **"The Game" requires strategic planning and communication among players to ensure that cards are played in the most efficient order possible.** We can quanitfy the value of communication by looking at the odds of winning without any coopertive play between players. Anecdotely, in a group of 4 people, the group wins around 25%-50% of games. To demonstrate this, here’s a brief overview of how the game works:

Objective
- The goal of "The Game" is to play as many cards as possible in ascending or descending order on four different piles.

Components
- 98 Cards: Numbered from 2 to 99.
- 4 Piles: Two ascending piles and two descending piles.

Setup
- Shuffle the deck of cards.
- Deal a certain number of cards to each player (depending on the number of players).
- Place the four pile cards in the center of the table:
- Two piles start with the number 1 (ascending piles).
- Two piles start with the number 100 (descending piles).

Gameplay
- Players take turns in clockwise order.
- On a player's turn, they must play at least two cards from their hand onto the piles.
- Cards on ascending piles must be higher than the top card.
- Cards on descending piles must be lower than the top card.
- After playing cards, the player draws back up to their hand limit.
- The game continues until the deck is exhausted and players can no longer play cards according to the rules.

Special Rule
- Players can play a card exactly 10 higher or 10 lower than the top card on the pile, which can help reset the pile and provide more - flexibility.

Winning and Losing
- The game ends when players can no longer play any cards.
- The fewer cards left unplayed, the better the team has performed.


# Python 
By including these simple rules in Python, we can simulate the basic gameplay. More advanced mechanics, like optimizing each move to be the best for the entire group and maximize the chances of winning, is quite a bit more complicated, so this example uses a greedy algorithm to allow each player to do the best move for themselves. This simulates non-cooperative play, and we can see what percentage of games are won with a different number of players.

![Main](/projects/thegame/100cards.png)

Well that's disappointing. This suggests in a 100 card game, it is essentially impossible to win without communicating at all. Because we're already here, let's compare to games with a fewer number of cards.

![GIF](/projects/thegame/50to100_NotSaved_Repeated.gif)

For the source code and additional materials, you can visit the GitHub repository:
<a href="https://github.com/natemcoleman/TheGame" target="_blank">GitHub Repository</a>

