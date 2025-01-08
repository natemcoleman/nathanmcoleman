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
            grid-template-columns: repeat(10, 20px);
            grid-template-rows: repeat(10, 20px);
            gap: 2px;
        }
        .cell {
            width: 20px;
            height: 20px;
            border: 1px solid #ccc;
        }
        .state-0 { background-color: #1e81b0; } /* Water */
        .state-1 { background-color: #7f4a1a; } /* Sand */
        .state-2 { background-color: #a0b741; } /* Grass */
        .state-3 { background-color: #b3b3b3; } /* Mountain */
        .state-4 { background-color: #ffffff; } /* Snow */
    </style>
</head>
<body>
    <button id="collapseOneButton">Collapse One Cell</button>
    <button id="resetButton">Collapse Grid</button>
    <div class="grid" id="grid"></div>
    <script>
        const gridElement = document.getElementById('grid');
        const resetButton = document.getElementById('resetButton');
        const gridSize = 10;
        const states = [0, 1, 2, 3, 4];
        let grid = [];
        function initializeGrid() {
            grid = Array.from({ length: gridSize }, () => 
                Array.from({ length: gridSize }, () => [...states])
            );
            const randomX = Math.floor(Math.random() * gridSize);
            const randomY = Math.floor(Math.random() * gridSize);
            const randomState = states[Math.floor(Math.random() * states.length)];
            grid[randomX][randomY] = [randomState];
            propagate(randomX, randomY, randomState);
            renderGrid();
        }
        function collapseCell(x, y) {
            const possibleStates = grid[x][y];
            const state = possibleStates[Math.floor(Math.random() * possibleStates.length)];
            grid[x][y] = [state];
            propagate(x, y, state);
            //renderGrid();
        }
        function propagate(x, y, state) {
            renderGrid();
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
        }
        function isValidNeighbor(state, neighborState) {
            const rules = {
                0: [1, 2, 3, 4],
                1: [0, 2, 3, 4],
                4: [0, 1, 2, 3],
                2: [0, 1, 3, 4],
                3: [0, 1, 2, 4],
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
        function collapseGrid() {
            let cellsToCollapse = [];
            for (let x = 0; x < gridSize; x++) {
                for (let y = 0; y < gridSize; y++) {
                    cellsToCollapse.push([x, y]);
                }
            }
            while (cellsToCollapse.length > 0) {
                const [x, y] = cellsToCollapse.splice(Math.floor(Math.random() * cellsToCollapse.length), 1)[0];
                if (grid[x][y].length > 1) {
                    collapseCell(x, y);    }
                //console.log(grid);
            }
        }
        resetButton.addEventListener('click', () => {
            initializeGrid();
            //collapseGrid();
        });
        function collapseOneCell() {
            let cellsToCollapse = [];
            for (let x = 0; x < gridSize; x++) {
                for (let y = 0; y < gridSize; y++) {
                    cellsToCollapse.push([x, y]);
                }
            }
            if (cellsToCollapse.length > 0) {
                const [x, y] = cellsToCollapse.splice(Math.floor(Math.random() * cellsToCollapse.length), 1)[0];
                if (grid[x][y].length > 1) {
                    collapseCell(x, y);
                }
            }
        }
        collapseOneButton.addEventListener('click', () => {
            collapseOneCell();
        });
        // initializeGrid();
        // collapseGrid();
        // renderGrid();
    </script>
</body>
</html>
