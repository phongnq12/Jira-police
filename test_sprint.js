require('dotenv').config();
const jiraService = require('./src/services/jira.service');

async function testSprintFilter() {
    try {
        const projectKey = "V.25.G.RD.C12.43.S";
        // Thử nghiệm JQL cuối cùng: Loại bỏ Future Sprints và Parent Types
        const jql = `project = "${projectKey}" AND issuetype NOT IN (Epic, Story, Task, "User Story") AND resolution = Unresolved AND sprint IN openSprints() AND sprint NOT IN futureSprints()`;
        console.log('Testing Final JQL:', jql);
        
        // Request thêm trường 'sprint' để kiểm tra xem nó thuộc sprint nào
        const data = await jiraService.searchIssues(jql, ['summary', 'status', 'sprint']);
        
        console.log(`Found ${data.issues.length} issues.`);
        
        data.issues.forEach(issue => {
            const sprintData = issue.fields.sprint;
            // Sprint field có thể là array hoặc object tùy Jira version
            let sprintInfo = 'No Sprint Data (Field exists but empty?)';
            if (sprintData) {
                if (Array.isArray(sprintData)) {
                    sprintInfo = sprintData.map(s => `${s.name} (ID: ${s.id}, State: ${s.state})`).join(', ');
                } else {
                    sprintInfo = `${sprintData.name} (ID: ${sprintData.id}, State: ${sprintData.state})`;
                }
            }
            console.log(`- [${issue.key}] ${issue.fields.summary} | Sprint: ${sprintInfo} | Status: ${issue.fields.status.name}`);
        });

    } catch (err) {
        console.error('Error:', err.message);
    }
}

testSprintFilter();
