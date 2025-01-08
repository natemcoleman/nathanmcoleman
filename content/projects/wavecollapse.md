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
            gap: 0px;
        }
        .cell {
            width: 20px;
            height: 20px;
            border: 0px solid #ccc;
        }
        .state-0 { background-color:rgb(19, 89, 121); } /* Water */
        .state-1 { background-color:rgb(81, 180, 222); } /* Water */
        .state-2 { background-color:rgb(187, 120, 57); } /* Sand */
        .state-3 { background-color: #a0b741; } /* Grass */
        .state-4 { background-color:rgb(13, 59, 22); } /* Grass */
        .state-5 { background-color:rgb(113, 113, 113); } /* Mountain */
        .state-6 { background-color: #ffffff; } /* Snow */
    </style>
</head>
<label for="speedSlider">Cells to add: <span id="sliderValue">5</span></label>
<input type="range" id="speedSlider" name="speedSlider" min="1" max="10" value="5">
<script>
    const speedSlider = document.getElementById('speedSlider');
    const sliderValue = document.getElementById('sliderValue');
    speedSlider.addEventListener('input', () => {
        sliderValue.textContent = speedSlider.value;
    });
</script>
    <button id="resetButton">Reset</button>
    <button id="collapseOneButton">Collapse One Cell</button>
    <button id="collapseButton">Collapse Grid</button>
    <div class="grid" id="grid"></div>
    <script>
        const gridElement = document.getElementById('grid');
        const resetButton = document.getElementById('resetButton');
        const gridSize = 15;
        const states = [0, 1, 2, 3, 4, 5, 6];
        let grid = [];
        initializeGrid();
        function initializeGrid() {
            grid = Array.from({ length: gridSize }, () => 
                Array.from({ length: gridSize }, () => [...states])
            );
            const n = 3; // Number of cells to be state 0
            const m = 3; // Number of cells to be state 6
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
            setRandomCellsToState(6, m);
            renderGrid();
            console.log(grid);
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
                4: [3, 4, 4, 5],
                5: [4, 5, 5, 6],
                6: [5, 5, 6, 6],
            };
            return rules[state].includes(neighborState);
        }
        function averageColor(states) {
            const colors = {
                0: [19,  89,  121],
                1: [81,  180, 222],
                2: [187, 120, 57],
                3: [160, 183, 65],
                4: [13,  59,  22],
                5: [113, 113, 113],
                6: [255, 255, 255],
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
            const sliderValue = speedSlider.value;
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
                }
            }
        }
        collapseButton.addEventListener('click', () => {
            collapseGrid();
        });
        collapseOneButton.addEventListener('click', () => {
            collapseOneCell();
        });
        resetButton.addEventListener('click', () => {
            initializeGrid();
        });
    </script>
</body>
</html>
