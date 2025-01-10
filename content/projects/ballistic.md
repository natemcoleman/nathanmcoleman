---
title: 'Simulating Missiles'
description: "Simple representations of complex engagements"
# date: January 2025
draft: true
weight: 200
tags: ["python"]
cover:
    # image: "projects/thegame/cover.gif"
---

[GitHub Repository](https://github.com/natemcoleman/ballistic)



<!DOCTYPE html>
<div style="display: flex; justify-content: space-between;">
    <div style="display: flex; flex-direction: column; width: 20%;">
        <button id="toggleButton">Toggle Animation</button>
        <input type="range" id="speedSlider" min="1" max="100" value="50">
        <button id="startButton">Start Simulation</button>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <div style="width: 75%;">
        <canvas id="trajectoryChart"></canvas>
    </div>
</div>

<script>
    const ctx = document.getElementById('trajectoryChart').getContext('2d');
    let animation;
    let speed = 50;
    const data = {
        labels: Array.from({length: 100}, (_, i) => i),
        datasets: [{
            label: 'Ballistic Trajectory',
            data: [],
            borderColor: 'rgba(75, 192, 192, 1)',
            borderWidth: 1,
            fill: false,
            tension: 0.1
        }]
    };

    const config = {
        type: 'line',
        data: data,
        options: {
            animation: {
                duration: 0
            },
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom'
                }
            }
        }
    };

    const trajectoryChart = new Chart(ctx, config);

    function simulateTrajectory() {
        const g = 9.81;
        const v0 = speed;
        const angle = Math.PI / 4;
        const data = [];
        for (let t = 0; t <= 10; t += 0.1) {
            const x = v0 * t * Math.cos(angle);
            const y = v0 * t * Math.sin(angle) - 0.5 * g * t * t;
            if (y < 0) break;
            data.push({x, y});
        }
        return data;
    }

    function updateChart() {
        trajectoryChart.data.datasets[0].data = simulateTrajectory();
        trajectoryChart.update();
    }

    document.getElementById('toggleButton').addEventListener('click', () => {
        if (animation) {
            clearInterval(animation);
            animation = null;
        } else {
            animation = setInterval(updateChart, 100);
        }
    });

    document.getElementById('speedSlider').addEventListener('input', (event) => {
        speed = event.target.value;
        updateChart();
    });

    document.getElementById('startButton').addEventListener('click', () => {
        updateChart();
    });

    updateChart();
</script>
