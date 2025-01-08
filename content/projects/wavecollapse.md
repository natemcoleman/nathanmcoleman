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

Create a Wave Function Collapse (WFC) algorithm in JavaScript with the following features:

Grid Setup: Create a 10x10 grid where each cell can collapse into one of 5 possible states, represented by integers 0 through 4.
State Visualization: Use HTML and CSS to display each cell of the grid as a colored square, with each state having a unique color.
WFC Logic: Implement the following steps for the algorithm:
Initialize all grid cells with all possible states (0-4).
Randomly choose a cell and collapse it to a single state.
Propagate constraints to neighboring cells by removing incompatible states based on simple adjacency rules (e.g., state 0 cannot neighbor state 1).
Repeat until all cells are collapsed.
Interactivity: Add a button to reset the grid and re-run the WFC.
Make sure to include comments explaining each step of the algorithm.

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wave Function Collapse</title>
    <style>
        .grid {
            display: grid;
            grid-template-columns: repeat(15, 20px);
            grid-template-rows: repeat(15, 20px);
            gap: 2px;
        }
        .cell {
            width: 20px;
            height: 20px;
            border: 1px solid #ccc;
        }
        .state-0 { background-color: #1e81b0; } /* Water */
        .state-1 { background-color:rgb(187, 120, 57); } /* Sand */
        .state-2 { background-color: #a0b741; } /* Grass */
        .state-3 { background-color: #b3b3b3; } /* Mountain */
        .state-4 { background-color: #ffffff; } /* Snow */
    </style>
</head>
<body>
    <button id="resetButton">Reset</button>
    <button id="collapseOneButton">Collapse One Cell</button>
    <button id="collapseButton">Collapse Grid</button>
    <div class="grid" id="grid"></div>
    <script>
        const gridElement = document.getElementById('grid');
        const resetButton = document.getElementById('resetButton');
        const gridSize = 15;
        const states = [0, 1, 2, 3, 4];
        //const states = [0, 1, 2];
        let grid = [];
        initializeGrid();
        function initializeGrid() {
            grid = Array.from({ length: gridSize }, () => 
                Array.from({ length: gridSize }, () => [...states])
            );
            renderGrid();
        }
        function collapseCell(x, y) {
            const possibleStates = grid[x][y];
            const state = possibleStates[Math.floor(Math.random() * possibleStates.length)];
            grid[x][y] = [state];
            propagate(x, y, state);
        }
        function propagate(x, y, state) {
            const neighbors = [
                [x - 1, y], [x + 1, y],
                [x, y - 1], [x, y + 1]
            ];
            for (let [nx, ny] of neighbors) {
                if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) {
                    grid[nx][ny] = grid[nx][ny].filter(s => isValidNeighbor(state, s));
                    if (grid[nx][ny].length > 1) {
                        if (grid[nx][ny].length === 1) {
                            setTimeout(() => propagate(nx, ny, grid[nx][ny][0]), 1000);
                        }
                    }
                }
            }
            renderGrid();
        }
        function isValidNeighbor(state, neighborState) {
            const rules = {
                0: [0, 0, 0, 1],
                1: [0, 1, 1, 2],
                2: [1, 2, 2, 3],
                3: [2, 3, 3, 4],
                4: [3, 4, 4, 4],
            };
            return rules[state].includes(neighborState);
        }
        function averageColor(states) {
            const colors = {
                0: [30, 129, 176],
                1: [127, 74, 26],
                2: [160, 183, 65],
                3: [179, 179, 179],
                4: [255, 255, 255]
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
                //propagate(x, y, grid[x][y][0]);
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
                console.log(cellsWithZeroStates)
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
            if (cellsToCollapse.length > 0) {
                cellsWithZeroStates = cellsToCollapse.filter(([x, y]) => grid[x][y].length === 0);
                console.log(cellsWithZeroStates)
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
            }
        }
        collapseButton.addEventListener('click', () => {
            collapseGrid();
            console.log(grid);
        });
        collapseOneButton.addEventListener('click', () => {
            collapseOneCell();
        });
        resetButton.addEventListener('click', () => {
            initializeGrid();
        });
        // initializeGrid();
        // collapseGrid();
        // renderGrid();
    </script>
</body>
</html>
