---
title: "Wave Function Collapse"
description: "Generating pseudo-random scenes"
# date: January 2025
draft: false
weight: 100
tags: ["python"]
cover:
    image: "projects/wavecollapse/wc7.gif"
---

<!--
![Main](/projects/wavecollapse/terrainTest2_1.png)
![GIF](/projects/wavecollapse/WaveCollapse1.gif)
-->

I would like to demonstrate a simple wave collapse algorithm. I would like a slider, with ticks from 1 to 10, and a button. Under the button, there should be an n by n grid, where n is 32. Each element of the grid has 5 possible states, where state 1 can be next to state 2, state 2 can be next to states 1 and 3, and so on. When the button is pressed, the wave collapse algorithm starts with states 1 spread randomly throughout the grid in 5 locations. Each state should appear in a unique color.

<script>
    function startWaveCollapse() {
        initializeGrid();
        collapseWave();
        drawGrid();
    }

    function collapseWave() {
        let changed;
        do {
            changed = false;
            for (let x = 0; x < gridSize; x++) {
                for (let y = 0; y < gridSize; y++) {
                    if (grid[x][y] === 0) {
                        const possibleStates = getPossibleStates(x, y);
                        if (possibleStates.length === 1) {
                            grid[x][y] = possibleStates[0];
                            changed = true;
                        }
                    }
                }
            }
        } while (changed);
    }

    function getPossibleStates(x, y) {
        const possibleStates = [1, 2, 3, 4, 5];
        const neighbors = getNeighbors(x, y);

        neighbors.forEach(neighbor => {
            if (neighbor.state !== 0) {
                const index = possibleStates.indexOf(neighbor.state);
                if (index !== -1) {
                    possibleStates.splice(index, 1);
                }
            }
        });

        return possibleStates;
    }

    function getNeighbors(x, y) {
        const neighbors = [];
        if (x > 0) neighbors.push({ state: grid[x - 1][y] });
        if (x < gridSize - 1) neighbors.push({ state: grid[x + 1][y] });
        if (y > 0) neighbors.push({ state: grid[x][y - 1] });
        if (y < gridSize - 1) neighbors.push({ state: grid[x][y + 1] });
        return neighbors;
    }
</script>
<div>
    <label for="slider">Grid Size:</label>
    <input type="range" id="slider" name="slider" min="1" max="10" value="5">
    <button onclick="startWaveCollapse()">Start</button>
</div>
<canvas id="waveCollapseCanvas" width="640" height="640"></canvas>

<script>
    const canvas = document.getElementById('waveCollapseCanvas');
    const ctx = canvas.getContext('2d');
    const gridSize = 32;
    const cellSize = canvas.width / gridSize;
    const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF'];
    let grid = Array(gridSize).fill().map(() => Array(gridSize).fill(0));

    function startWaveCollapse() {
        initializeGrid();
        collapseWave();
        drawGrid();
    }

    function initializeGrid() {
        for (let i = 0; i < 5; i++) {
            const x = Math.floor(Math.random() * gridSize);
            const y = Math.floor(Math.random() * gridSize);
            grid[x][y] = 1;
        }
    }

    function drawGrid() {
        for (let x = 0; x < gridSize; x++) {
            for (let y = 0; y < gridSize; y++) {
                ctx.fillStyle = colors[grid[x][y]];
                ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
            }
        }
    }
</script>
