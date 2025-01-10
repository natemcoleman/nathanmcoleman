---
title: "Wave Function Collapse"
description: "Generating pseudo-random scenes"
# date: January 2025
draft: false
weight: 50
tags: ["python"]
cover:
    image: "projects/wavecollapse/wc7.gif"
---

Read about the Wave Function Collapse algorithm below, or [skip](#interactive-example) to the interactive example!

# Introduction
The Wave Function Collapse (WFC) algorithm is a way to procedurally generate content used to create unique patterns or structures based on a given input. It works by using an example, which can be rules that tell it how the pattern should look or an existing pattern it can analyze, and then generating a large output that follows the rules established. 

The algorithm is inspired by quantum mechanics, where the "wave function" represents all possible states of a system until the system is observed, collapsing it into a single observable state. In the context of WFC, each cell, pixel, or unit in the output grid can be in multiple states (e.g., different tiles or patterns) until constraints from neighboring cells restrict or collapse it into a single state. This process continues until the entire grid is filled with a coherent pattern that resembles the input. <a href="https://robertheaton.com/2018/12/17/wavefunction-collapse-algorithm/" target="_blank">Robert Heaton</a> gives a very clear explanation of how the WFC algorithm works using examples and illustrations.

<div style="text-align: center;">
    <img src="/projects/wavecollapse/matlab/WaveCollapse13.gif" alt="GIF" style="display: block; margin-left: auto; margin-right: auto;">
</div>

# Terrain Example
Imagine a simple map, which may show features like water, grass, trees, mountains, snow, cliffs, deserts, etc. Intuitively, you might expect cliffs to be near mountains, snow to fall on top of a mountain rather than in the ocean, or some sort of bank to be between grass and water. If we want to create a terrain map that looks like this simple map, we can include all of these rules that explain how we expect the terrain to look. When we initialize our new map, any of the map can be any of the features - we haven't told it anything about how to begin! We can pick one or more places to have specific features, like putting a snow-capped mountain in the northeast, a river in the west, or a meadow in the south. Because we have now restricted the map in a location, we have "collapsed" the possibilities around it! Desert should not border snow, and so there are less possibilities next to our new mountain. Our algorithm now finds the place on our map with the least possibilities and randomly picks one of its possible states to restrict it. Perhaps our fresh snow can only be next to other snow, or mountain, whereas any of the other places on the map still have many possibilities, the algorithm may randomly chooses snow for the area next to it. Now there are two places on our map which have only one state, the areas directly surrounding them have two possibilities (snow and mountain), and every other place can be any of the possible states. The process of finding the area with the least number of possibilities and restricting it continues until the whole map is defined by terrain! 

<div style="text-align: center;">
    <img src="/projects/wavecollapse/matlab/WaveCollapse25.gif" alt="GIF"  style="display: block; margin-left: auto; margin-right: auto;">
</div>

One benefit of the versatility of the WFC method is that multiple rounds of the wave function collapse algorithm can be used to first generate "biomes", like forest, sea, etc., and then generate terrain specific to those biomes to give a more refined look. Additionally, more complex rules can be used, such as weighting the possible neighbors, so that for example grass can be by water, but has a higher liklihood of being next to sand instead. You can see more examples like these at the bottom of the page! 

<div style="text-align: center;">
    <img src="/projects/wavecollapse/wc33.gif" alt="GIF"  style="display: block; margin-left: auto; margin-right: auto;">
</div>

# Additional Resources
WFC is particularly useful in applications like terrain generation and level design in games, where it can produce unique, complex, and varied results from simple examples. It can also be used for much more than the simple terrain generation shown on this site - check out <a href="https://github.com/mxgmn/WaveFunctionCollapse" target="_blank">the official GitHub repository</a>  for the Wave Function Collapse algorithm, containing the source code and documentation, as well as some cool examples of how it can be used in a variety of ways! 

If you're still interested, you can watch <a href="https://m.youtube.com/watch?v=qRtrj6Pua2A" target="_blank">Coding Train teach how to create your own WFC algorithm</a> with additional examples, or visit my GitHub repositories for this project in <a href="https://github.com/natemcoleman/MatlabWaveCollapseFunction" target="_blank">Matlab</a> and <a href="https://github.com/natemcoleman/WaveCollapsePython" target="_blank">Python</a>. 

# Interactive Example
Play with the example below and watch terrain be generated using this method to create a map-like scene with water, sand, grass, rocks, and snow. Use the slider to control the speed, and click the button to create a new map!

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wave Function Collapse</title>
    <style>
        .grid {
            display: grid;
            grid-template-columns: repeat(35, 10px);
            grid-template-rows: repeat(35, 10px);
            gap: 0px;
            margin-bottom: 20px;
        }
        .cell {
            width: 20px;
            height: 20px;
            border: 0px solid #ccc;
        }
        .state-0 { background-color:rgb(41, 140, 185); } /* Water */
        .state-1 { background-color: #e1bf92; } /* Sand */
        .state-2 { background-color: #a0b741; } /* Grass */
        .state-3 { background-color:rgb(113, 113, 113); } /* Mountain */
        .state-4 { background-color: #ffffff; } /* Snow */
    </style>
</head>
<style>
    .button-container {
        display: flex;
        gap: 10px;
        margin-top: 10px;
        justify-content: center;
    }
    .button-container button {
        background-color: #4CAF50;
        color: white;
        border: none;
        border-radius: 12px;
        padding: 10px 20px;
        text-align: center;
        text-decoration: none;
        display: inline-block;
        font-size: 16px;
        margin: 4px 2px;
        cursor: pointer;
        transition-duration: 0.4s;
    }
</style>
    <div class="grid" id="grid"></div>
     <div style="display: flex; flex-direction: row; align-items: center; gap: 35px; justify-content: center;">     <div class="button-container">
            <button id="resetButton">Reset</button>
        </div>
        <input type="range" id="speedSlider" name="speedSlider" min="1" max="10" value="5", style="width: 200px;">
        <script>
            const speedSlider = document.getElementById('speedSlider');
            const sliderValue = document.getElementById('sliderValue');
            speedSlider.addEventListener('input', () => {
                sliderValue.textContent = speedSlider.value;
            });
        </script>       
    </div>
    <script>
        //<label for="speedSlider">Speed: <span id="sliderValue">5</span></label>
        //<button id="collapseButton">Collapse Grid</button>
         //<button id="collapseOneButton">Create</button>
        const gridElement = document.getElementById('grid');
        const resetButton = document.getElementById('resetButton');
        const gridSize = 35;
        const states = [0, 1, 2, 3, 4];
        let grid = [];
        initializeGrid();
        function initializeGrid() {
            grid = Array.from({ length: gridSize }, () => 
                Array.from({ length: gridSize }, () => [...states])
            );
            const n = 8; // Number of cells to be state 0
            const m = 8; // Number of cells to be state 6
            function setRandomCellsToState(state, count) {
                let cellsSet = 0;
                while (cellsSet < count) {
                    const x = Math.floor(Math.random() * gridSize);
                    const y = Math.floor(Math.random() * gridSize);
                    if (grid[x][y].length === states.length) {
                        grid[x][y] = [state];
                        propagate(x, y, state);
                        cellsSet++;
                    }
                }
            }
            setRandomCellsToState(0, n);
            setRandomCellsToState(4, m);
            renderGrid();
        }
        function collapseCell(x, y) {
            const possibleStates = grid[x][y];
            let rand_num = Math.random();
            const state = possibleStates[Math.floor(rand_num * possibleStates.length)];
            grid[x][y] = [state];
            propagate(x, y, state);
        }
        function propagate(x, y, state) {
            const neighbors = [
                [x - 1, y], [x + 1, y],
                [x, y - 1], [x, y + 1],
                [x - 1, y - 1], [x + 1, y + 1],
                [x + 1, y - 1], [x - 1, y + 1]
            ];
            for (let [nx, ny] of neighbors) {
                if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) {
                    if (grid[nx][ny].length > 1) {
                         grid[nx][ny] = grid[nx][ny].filter(s => isValidNeighbor(state, s));
                        if (grid[nx][ny].length === 1) {
                            propagate(nx, ny, grid[nx][ny][0])
                        }
                    }
                }
            }
            renderGrid();
        }
        function isValidNeighbor(state, neighborState) {
            const rules = {
                0: [0, 1],
                1: [0, 1, 2],
                2: [1, 2, 3],
                3: [2, 3, 4],
                4: [3, 4],
            };
            return rules[state].includes(neighborState);
        }
        function averageColor(states) {
            const colors = {
                0: [19,  89,  121],
                1: [187, 120, 57],
                2: [160, 183, 65],
                3: [13,  59,  22],
                4: [113, 113, 113],
            };
            const avgColor = states.reduce((acc, state) => {
                acc[0] += colors[state][0];
                acc[1] += colors[state][1];
                acc[2] += colors[state][2];
                return acc;
            }, [0, 0, 0]).map(c => Math.floor(c / states.length));
            return `rgb(${avgColor.join(',')})`;
        }
        function renderGrid() {
            gridElement.innerHTML = '';
            gridElement.style.display = 'grid';
            gridElement.style.justifyContent = 'center';
            gridElement.style.alignItems = 'center';
            for (let row of grid) {
                for (let cell of row) {
                    const cellElement = document.createElement('div');
                    cellElement.classList.add('cell');
                    if (cell.length === 1) {
                        cellElement.classList.add(`state-${cell[0]}`);
                    } else {
                        cellElement.style.backgroundColor = averageColor(cell);
                    }
                    gridElement.appendChild(cellElement);
                }
            }
        }
        function pickNeighbor(x, y) {
            const neighbors = [
                [x - 1, y], [x + 1, y],
                [x, y - 1], [x, y + 1]
            ];
            const validNeighbors = neighbors.filter(([nx, ny]) => 
                nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize && grid[nx][ny].length === 1
            );
            if (validNeighbors.length > 0) {
                const [nx, ny] = validNeighbors[Math.floor(Math.random() * validNeighbors.length)];
                grid[x][y] = [...grid[nx][ny]];
            }
        }
        function collapseGrid() {
            let cellsToCollapse = [];
            for (let x = 0; x < gridSize; x++) {
                for (let y = 0; y < gridSize; y++) {
                    cellsToCollapse.push([x, y]);
                }
            }
            cellsWithMultipleStates = cellsToCollapse.filter(([x, y]) => grid[x][y].length > 1);
            while (cellsWithMultipleStates.length > 0) {
                cellsWithZeroStates = cellsToCollapse.filter(([x, y]) => grid[x][y].length === 0);
                while (cellsWithZeroStates.length > 0) {
                    const [x, y] = cellsWithZeroStates[Math.floor(Math.random() * cellsWithZeroStates.length)];
                    pickNeighbor(x, y);
                    cellsWithZeroStates = cellsToCollapse.filter(([x, y]) => grid[x][y].length === 0);
                }
                const minStates = Math.min(...cellsWithMultipleStates.map(([x, y]) => grid[x][y].length));
                const minStateCells = cellsWithMultipleStates.filter(([x, y]) => grid[x][y].length === minStates);
                const [x, y] = minStateCells[Math.floor(Math.random() * minStateCells.length)];
                collapseCell(x, y);
                cellsWithMultipleStates = cellsToCollapse.filter(([x, y]) => grid[x][y].length > 1);
            }
        }
        function collapseOneCell() {
            let cellsToCollapse = [];
            for (let x = 0; x < gridSize; x++) {
                for (let y = 0; y < gridSize; y++) {
                    if (grid[x][y].length > 1) { // Only include cells that have not been collapsed
                        cellsToCollapse.push([x, y]);
                    }
                }
            }
            const speedSlider = document.getElementById('speedSlider');
            const sliderValue = speedSlider.value * 2;
            for (let i = 0; i < sliderValue; i++) {
                if (cellsToCollapse.length > 0) {
                    const cellsWithZeroStates = cellsToCollapse.filter(([x, y]) => grid[x][y].length === 0);
                    if (cellsWithZeroStates.length > 0) {
                        const [x, y] = cellsWithZeroStates[Math.floor(Math.random() * cellsWithZeroStates.length)];
                        pickNeighbor(x, y);
                        cellsToCollapse = cellsToCollapse.filter(([cx, cy]) => grid[cx][cy].length > 1); // Update cellsToCollapse
                    }
                    const cellsWithMultipleStates = cellsToCollapse.filter(([x, y]) => grid[x][y].length > 1);
                    if (cellsWithMultipleStates.length > 0) {
                        const minStates = Math.min(...cellsWithMultipleStates.map(([x, y]) => grid[x][y].length));
                        const minStateCells = cellsWithMultipleStates.filter(([x, y]) => grid[x][y].length === minStates);
                        const [x, y] = minStateCells[Math.floor(Math.random() * minStateCells.length)];
                        collapseCell(x, y);
                        cellsToCollapse = cellsToCollapse.filter(([cx, cy]) => grid[cx][cy].length > 1); // Update cellsToCollapse
                    }
                }
            }
        }
        // function collapseOneCell() {
        //     let cellsToCollapse = [];
        //     for (let x = 0; x < gridSize; x++) {
        //         for (let y = 0; y < gridSize; y++) {
        //             cellsToCollapse.push([x, y]);
        //         }
        //     }
        //     const speedSlider = document.getElementById('speedSlider');
        //     const sliderValue = speedSlider.value*2;
        //     for (let i = 0; i < sliderValue; i++) {
        //         if (cellsToCollapse.length > 0) {
        //             cellsWithZeroStates = cellsToCollapse.filter(([x, y]) => grid[x][y].length === 0);
        //             if (cellsWithZeroStates.length > 0) {
        //                 const [x, y] = cellsWithZeroStates[Math.floor(Math.random() * cellsWithZeroStates.length)];
        //                 pickNeighbor(x, y);
        //                 cellsWithZeroStates = cellsToCollapse.filter(([x, y]) => grid[x][y].length === 0);
        //             }
        //             const cellsWithMultipleStates = cellsToCollapse.filter(([x, y]) => grid[x][y].length > 1);
        //             if (cellsWithMultipleStates.length > 0) {
        //                 const minStates = Math.min(...cellsWithMultipleStates.map(([x, y]) => grid[x][y].length));
        //                 const minStateCells = cellsWithMultipleStates.filter(([x, y]) => grid[x][y].length === minStates);
        //                 const [x, y] = minStateCells[Math.floor(Math.random() * minStateCells.length)];
        //                 collapseCell(x, y);
        //             }   
        //         }
        //     }
        // }
        //collapseButton.addEventListener('click', () => {
        //    collapseGrid();
        //});
        let intervalId; // To store the interval ID
        window.onload = function() {
            intervalId = setInterval(collapseOneCell, 250);
        };
        //collapseOneButton.addEventListener('click', () => {
        //    collapseOneCell();
        //});
        resetButton.addEventListener('click', () => {
            initializeGrid();
            let intervalId; // To store the interval ID
            window.onload = function() {
                intervalId = setInterval(collapseOneCell, 250);
            };
        });
    </script>
</body>
</html>

<br><br><br>
# Additional Examples
<div style="text-align: center;">
    <img src="/projects/wavecollapse/matlab/WaveCollapse23.gif" alt="GIF"  style="display: block; margin-left: auto; margin-right: auto;">
    <img src="/projects/wavecollapse/matlab/WaveCollapse24.gif" alt="GIF"  style="display: block; margin-left: auto; margin-right: auto;">
    <img src="/projects/wavecollapse/wc23.gif" alt="GIF"  style="display: block; margin-left: auto; margin-right: auto;">
    <img src="/projects/wavecollapse/wc31.gif" alt="GIF"  style="display: block; margin-left: auto; margin-right: auto;">
    <img src="/projects/wavecollapse/matlab/300x300Pic.png" alt="Main"  style="display: block; margin-left: auto; margin-right: auto;">
</div>


