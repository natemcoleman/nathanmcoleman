---
title: "How to Win the Lottery"
description: "Regardless of the year, the same winning numbers appear"
# date: January 2025
draft: false
weight: 200
tags: ["matlab"]
cover:
    image: "projects/lottery/cover.gif"
---

# Introduction
Lotteries are one of the simplest and most ancient scams known to mankind. The prospect of winning big overshadows the obvious underpining of the game - nearly no one will win. By looking at 1,000,000+ publically availible winning <a href="https://catalog.data.gov/dataset/?tags=winning" target="_blank">lottery numbers</a> , in part from the New York State Lottery from 1987 to 2014, we can gain some insights to what strategies have above average odds of winning. One would expect in a random distribution of numbers, however, an initial analysis shows that some numbers occur less frequently: 

<div style="text-align: center;">
    <img src="/projects/lottery/numsZeroToTenFrequency2.png" alt="numbers" style="display: block; margin-left: auto; margin-right: auto;">
</div>

Here's the same set zoomed in: 

<div style="text-align: center;">
    <img src="/projects/lottery/numsZeroToTenFrequency2_zoomed.png" alt="numbers2" style="display: block; margin-left: auto; margin-right: auto;">
</div>

This shows that some numbers, especially 8 and 9, occur significantly less frequently than others.

# Birthyears as a Strategy
A common strategy when choosing lottery numbers is to choose a birthday for yourself or someone close. For all living humans, birthyears fall between 1900 and 2060 (just go with me on this), and so we can see how often birth years might win by checking the series for occurances of teh numbers 190-206. 

<div style="text-align: center;">
    <img src="/projects/lottery/decades_blueOrange_cropped.png" alt="decades" style="display: block; margin-left: auto; margin-right: auto;">
</div>

Well isn't that strange? I guess if you were born in the 1920's or the 2020's you're in luck, but other than that, it appears that you have extremely slim chances of winning using your birthyear. By extending the strategy of searching for the frequency of each triplet, some clear patterns start to come out. 

<div style="text-align: center;">
    <img src="/projects/lottery/frequencyPerYearSince20132023_AllBlue_VeryFast.gif" alt="decades" style="display: block; margin-left: auto; margin-right: auto;">
</div>

**Regardless of the year of the lottery, the same pattern emerges.** The probability we saw with each individual number is propogated to the triplets, meaning that numbers with 8's and 9's, like "815" and "956", are less likely to appear, and numbers like "002" and "014" are much more likely to be chosen. The point of this isn't really that you can win, it really just shows that any time you think you can win at a chance based game, chances are good that you have no chance. 


<!-- ![Main](/projects/lottery/numsZeroToTenFrequency2.png)
![Main](/projects/lottery/numsZeroToTenFrequency2_zoomed.png)
![GIF](/projects/lottery/frequencyPerYearSince20132023_AllBlue_VeryFast.gif) -->