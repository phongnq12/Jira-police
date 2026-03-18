const messageService = require('./src/services/message.service');

async function testNoActiveLogic() {
    const mockData = [
        { key: 'V25-1', status: 'To Do', assignee: 'Phong Nguyen' },
        { key: 'V25-2', status: 'Open', assignee: 'Phong Nguyen' },
        { key: 'V25-3', status: 'In Progress', assignee: 'Dev A' },
        { key: 'V25-4', status: 'To Do', assignee: 'Dev B' },
    ];

    const userActivityTracker = {};
    const passiveStatuses = ['to do', 'open', 'reopen'];

    mockData.forEach(issue => {
        const assigneeName = issue.assignee;
        const status = issue.status;
        const key = issue.key;

        if (!userActivityTracker[assigneeName]) {
            userActivityTracker[assigneeName] = {
                displayName: assigneeName,
                activeCount: 0,
                passiveCount: 0,
                passiveKeys: []
            };
        }

        const isPassive = passiveStatuses.includes(status.toLowerCase());

        if (isPassive) {
            userActivityTracker[assigneeName].passiveCount++;
            userActivityTracker[assigneeName].passiveKeys.push(key);
        } else {
            userActivityTracker[assigneeName].activeCount++;
        }
    });

    console.log('User Activity Distribution:');
    for (const [userId, activity] of Object.entries(userActivityTracker)) {
        console.log(`- ${userId}: Active=${activity.activeCount}, Passive=${activity.passiveCount} (${activity.passiveKeys.join(', ')})`);
        
        if (activity.activeCount === 0 && activity.passiveCount > 0) {
            console.log(`  👉 TRIGGER ALERT for ${activity.displayName}`);
            const msg = messageService.noActiveTaskAlert(activity.displayName, activity.passiveKeys);
            console.log('--- Message Preview ---');
            console.log(msg);
            console.log('----------------------\n');
        }
    }
}

testNoActiveLogic();
