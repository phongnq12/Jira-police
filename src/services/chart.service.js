const { createCanvas } = require('canvas');
const { Chart, registerables } = require('chart.js');

// Đăng ký tất cả các component Chart.js (bắt buộc cho Node.js)
Chart.register(...registerables);

/**
 * Chart Service — Render biểu đồ thành Buffer ảnh PNG
 * Sử dụng 'canvas' (node-canvas) + Chart.js.
 * Không cần Puppeteer, không cần trình duyệt.
 */
class ChartService {
    /**
     * Tạo Radar Chart — Đánh giá sức khỏe dự án theo 4 chỉ số
     * @param {object} data { overdue, blocked, missingInfo, unloggedWork } (giá trị 0-100 %)
     * @param {string} projectName Tên dự án hiển thị trên chart
     * @returns {Buffer} PNG image buffer
     */
    renderRadarChart(data, projectName = 'Project Health') {
        const width = 600;
        const height = 600;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, width, height);

        const chart = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: ['Overdue', 'Blocked', 'Missing Info', 'Unlogged Work'],
                datasets: [{
                    label: projectName,
                    data: [
                        data.overdue || 0,
                        data.blocked || 0,
                        data.missingInfo || 0,
                        data.unloggedWork || 0
                    ],
                    backgroundColor: 'rgba(255, 99, 132, 0.25)',
                    borderColor: 'rgba(255, 99, 132, 1)',
                    borderWidth: 2,
                    pointBackgroundColor: 'rgba(255, 99, 132, 1)',
                    pointRadius: 5
                }]
            },
            options: {
                responsive: false,
                animation: false,
                plugins: {
                    title: {
                        display: true,
                        text: `🏥 ${projectName} — Health Radar`,
                        color: '#e0e0e0',
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        labels: { color: '#e0e0e0' }
                    }
                },
                scales: {
                    r: {
                        min: 0,
                        max: 100,
                        ticks: {
                            stepSize: 20,
                            color: '#aaa',
                            backdropColor: 'transparent'
                        },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        angleLines: { color: 'rgba(255,255,255,0.1)' },
                        pointLabels: {
                            color: '#e0e0e0',
                            font: { size: 13 }
                        }
                    }
                }
            }
        });

        const buffer = canvas.toBuffer('image/png');
        chart.destroy();
        return buffer;
    }

    /**
     * Tạo Bar Chart — So sánh Original Estimate vs Time Spent theo Assignee
     * @param {Array} assigneeData [{ name, estimateHours, spentHours }]
     * @param {string} title
     * @returns {Buffer} PNG image buffer
     */
    renderEfficiencyBarChart(assigneeData, title = 'Efficiency: Estimate vs Actual') {
        const width = 800;
        const height = 500;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, width, height);

        const labels = assigneeData.map(d => d.name.length > 12 ? d.name.substring(0, 12) + '…' : d.name);

        const chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Original Estimate (h)',
                        data: assigneeData.map(d => d.estimateHours),
                        backgroundColor: 'rgba(54, 162, 235, 0.7)',
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 1
                    },
                    {
                        label: 'Time Spent (h)',
                        data: assigneeData.map(d => d.spentHours),
                        backgroundColor: 'rgba(255, 159, 64, 0.7)',
                        borderColor: 'rgba(255, 159, 64, 1)',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: false,
                animation: false,
                plugins: {
                    title: {
                        display: true,
                        text: `📊 ${title}`,
                        color: '#e0e0e0',
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        labels: { color: '#e0e0e0' }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#e0e0e0', font: { size: 11 } },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#e0e0e0' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        title: { display: true, text: 'Hours', color: '#aaa' }
                    }
                }
            }
        });

        const buffer = canvas.toBuffer('image/png');
        chart.destroy();
        return buffer;
    }

    /**
     * Tạo Cumulative Flow Diagram (CFD)
     * Dùng dữ liệu snapshot lịch sử để vẽ stacked area chart
     * @param {Array} snapshots Mảng snapshots từ DB
     * @param {string} projectName
     * @returns {Buffer} PNG image buffer
     */
    renderCFDChart(snapshots, projectName = 'Project') {
        const width = 800;
        const height = 500;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, width, height);

        const labels = snapshots.map(s => {
            const d = new Date(s.snapshot_date);
            return `${d.getDate()}/${d.getMonth() + 1}`;
        });

        const chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Done',
                        data: snapshots.map(s => s.done_tasks),
                        backgroundColor: 'rgba(75, 192, 192, 0.3)',
                        borderColor: 'rgba(75, 192, 192, 1)',
                        fill: true,
                        tension: 0.3
                    },
                    {
                        label: 'Blocked',
                        data: snapshots.map(s => s.blocked_tasks),
                        backgroundColor: 'rgba(255, 99, 132, 0.3)',
                        borderColor: 'rgba(255, 99, 132, 1)',
                        fill: true,
                        tension: 0.3
                    },
                    {
                        label: 'Overdue',
                        data: snapshots.map(s => s.overdue_tasks),
                        backgroundColor: 'rgba(255, 205, 86, 0.3)',
                        borderColor: 'rgba(255, 205, 86, 1)',
                        fill: true,
                        tension: 0.3
                    },
                    {
                        label: 'Total Tasks',
                        data: snapshots.map(s => s.total_tasks),
                        backgroundColor: 'rgba(153, 102, 255, 0.15)',
                        borderColor: 'rgba(153, 102, 255, 1)',
                        fill: true,
                        tension: 0.3,
                        borderDash: [5, 5]
                    }
                ]
            },
            options: {
                responsive: false,
                animation: false,
                plugins: {
                    title: {
                        display: true,
                        text: `📈 ${projectName} — Cumulative Flow`,
                        color: '#e0e0e0',
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        labels: { color: '#e0e0e0' }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#e0e0e0', maxRotation: 45 },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    },
                    y: {
                        beginAtZero: true,
                        stacked: false,
                        ticks: { color: '#e0e0e0' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        title: { display: true, text: 'Tasks', color: '#aaa' }
                    }
                }
            }
        });

        const buffer = canvas.toBuffer('image/png');
        chart.destroy();
        return buffer;
    }

    /**
     * Tạo Burndown Chart — Theo dõi tiến độ Sprint
     * @param {Array} snapshots Mảng snapshots từ DB
     * @param {string} sprintName
     * @returns {Buffer} PNG image buffer
     */
    renderBurndownChart(snapshots, sprintName = 'Sprint') {
        const width = 800;
        const height = 500;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, width, height);

        const labels = snapshots.map(s => {
            const d = new Date(s.snapshot_date);
            return `${d.getDate()}/${d.getMonth() + 1}`;
        });

        // Remaining = total - done
        const remainingData = snapshots.map(s => s.total_tasks - s.done_tasks);

        // Ideal burndown line (đường lý tưởng)
        const totalStart = remainingData[0] || 0;
        const idealData = snapshots.map((_, i) => {
            return Math.max(0, totalStart - (totalStart / (snapshots.length - 1)) * i);
        });

        const chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Remaining Tasks',
                        data: remainingData,
                        borderColor: 'rgba(255, 99, 132, 1)',
                        backgroundColor: 'rgba(255, 99, 132, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.2,
                        pointRadius: 4,
                        pointBackgroundColor: 'rgba(255, 99, 132, 1)'
                    },
                    {
                        label: 'Ideal Burndown',
                        data: idealData,
                        borderColor: 'rgba(75, 192, 192, 0.7)',
                        borderWidth: 2,
                        borderDash: [8, 4],
                        fill: false,
                        tension: 0,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: false,
                animation: false,
                plugins: {
                    title: {
                        display: true,
                        text: `🔥 Burndown — ${sprintName}`,
                        color: '#e0e0e0',
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        labels: { color: '#e0e0e0' }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#e0e0e0' },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#e0e0e0' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        title: { display: true, text: 'Tasks Remaining', color: '#aaa' }
                    }
                }
            }
        });

        const buffer = canvas.toBuffer('image/png');
        chart.destroy();
        return buffer;
    }
}

module.exports = new ChartService();
