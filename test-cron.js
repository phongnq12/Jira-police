require('dotenv').config();
const { runDailyReport } = require('./src/controllers/cron.controller');

console.log('--- BẮT ĐẦU CHẠY TEST LOCAL CRONJOB ---');
runDailyReport()
    .then(() => {
        console.log('--- KẾT THÚC TEST ---');
        process.exit(0);
    })
    .catch((err) => {
        console.error('Lỗi khi test:', err);
        process.exit(1);
    });
