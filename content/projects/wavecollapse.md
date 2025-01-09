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

The Wave Function Collapse (WFC) algorithm is a procedural content generation technique used to create unique and visually appealing patterns or structures based on a given input. It works by analyzing a small example pattern and then generating a larger output that maintains the local properties and rules of the input.

The algorithm is inspired by quantum mechanics, where the "wave function" represents all possible states of a system. In the context of WFC, each cell in the output grid can be in multiple states (e.g., different tiles or patterns) until constraints from neighboring cells collapse it into a single state. This process continues until the entire grid is filled with a coherent pattern that resembles the input.
<div style="text-align: center;">
    <img src="/projects/wavecollapse/matlab/WaveCollapse13.gif" alt="GIF" style="display: block; margin-left: auto; margin-right: auto;">
</div>

WFC is particularly useful in applications like terrain generation, texture synthesis, and level design in games, where it can produce complex and varied results from simple examples.

You can watch terrain be generated using this method to create a map-like scene with water, sand, grass, rocks, and snow. Use the slider to control the speed, and click the button to create a new map! You can also see some other examples from my GitHub repos below. 

For more detailed information, you can check out the following resources:

<a href="https://robertheaton.com/2018/12/17/wavefunction-collapse-algorithm/" target="_blank">Wave Function Collapse Algorithm by Robert Heaton</a>: A very good, simple explanation of how the Wave Function Collapse Algorithm works by Robert Heaton. He uses some good examples and illustrations.

<a href="https://github.com/mxgmn/WaveFunctionCollapse" target="_blank">Wave Function Collapse GitHub Repository</a>: The official GitHub repository for the Wave Function Collapse algorithm, containing the source code and documentation, as well as some cool examples of how it can be used in a variety of circumstances. 

<a href="https://m.youtube.com/watch?v=qRtrj6Pua2A" target="_blank">Wave Function Collapse YouTube Video</a>: A YouTube video that visually demonstrates the Wave Function Collapse algorithm in action and how to go about coding it.

<a href="https://github.com/natemcoleman/MatlabWaveCollapseFunction" target="_blank">My GitHub repo</a> for a wave collapse algorithm in Matlab

<a href="https://github.com/natemcoleman/WaveCollapsePython" target="_blank">My GitHub repo</a> for a wave collapse algorithm in Python


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
        .state-1 { background-color:rgb(187, 120, 57); } /* Sand */
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
                    cellsToCollapse.push([x, y]);
                }
            }
            const speedSlider = document.getElementById('speedSlider');
            const sliderValue = speedSlider.value*2;
            for (let i = 0; i < sliderValue; i++) {
                if (cellsToCollapse.length > 0) {
                    cellsWithZeroStates = cellsToCollapse.filter(([x, y]) => grid[x][y].length === 0);
                    if (cellsWithZeroStates.length > 0) {
                        const [x, y] = cellsWithZeroStates[Math.floor(Math.random() * cellsWithZeroStates.length)];
                        pickNeighbor(x, y);
                        cellsWithZeroStates = cellsToCollapse.filter(([x, y]) => grid[x][y].length === 0);
                    }
                    const cellsWithMultipleStates = cellsToCollapse.filter(([x, y]) => grid[x][y].length > 1);
                    if (cellsWithMultipleStates.length > 0) {
                        const minStates = Math.min(...cellsWithMultipleStates.map(([x, y]) => grid[x][y].length));
                        const minStateCells = cellsWithMultipleStates.filter(([x, y]) => grid[x][y].length === minStates);
                        const [x, y] = minStateCells[Math.floor(Math.random() * minStateCells.length)];
                        collapseCell(x, y);
                    }   
                //else
                //    clearInterval(intervalId);
                }
            }
        }
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
<!-- 
<html>
<style>
.center-image {
    display: block;
    margin-left: auto;
    margin-right: auto;
    text-align: center;
    }
</style>
<img src="/projects/wavecollapse/matlab/WaveCollapse13.gif" alt="Image description" class="center-image" />
</html> -->


<br>


<div style="text-align: center;">
    <img src="/projects/wavecollapse/matlab/WaveCollapse23.gif" alt="GIF">
    <img src="/projects/wavecollapse/matlab/WaveCollapse24.gif" alt="GIF">
    <img src="/projects/wavecollapse/matlab/WaveCollapse25.gif" alt="GIF">
    <img src="/projects/wavecollapse/wc23.gif" alt="GIF">
    <img src="/projects/wavecollapse/wc31.gif" alt="GIF">
    <img src="/projects/wavecollapse/wc33.gif" alt="GIF">
    <img src="/projects/wavecollapse/matlab/300x300Pic.png" alt="Main">
</div>

<!-- ![GIF](/projects/wavecollapse/matlab/WaveCollapse13.gif) make the last three above repeat
![GIF](/projects/wavecollapse/matlab/WaveCollapse21.gif)
![GIF](/projects/wavecollapse/matlab/WaveCollapse22.gif)
![GIF](/projects/wavecollapse/matlab/WaveCollapse23.gif)
![GIF](/projects/wavecollapse/matlab/WaveCollapse24.gif)
![GIF](/projects/wavecollapse/matlab/WaveCollapse25.gif)
![Main](/projects/wavecollapse/matlab/300x300Pic.png) -->

