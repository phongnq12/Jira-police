require('dotenv').config();
const jiraService = require('./src/services/jira.service');

async function testStatusFilter() {
    try {
        const projectKey = "V.25.G.RD.C12.43.S";
        const jql = `project = "${projectKey}" AND sprint IN openSprints()`;
        console.log('Testing JQL:', jql);
        
        const data = await jiraService.searchIssues(jql, ['summary', 'status', 'issuetype']);
        console.log(`Found ${data.issues.length} total issues in sprint.`);

        const exemptParentTypes = ['epic', 'story', 'user story', 'task'];
        
        let activeCount = 0;
        let cancelledCount = 0;
        let parentCount = 0;

        data.issues.forEach(issue => {
            const status = issue.fields.status.name.toLowerCase();
            const type = issue.fields.issuetype.name.toLowerCase();
            
            if (status === 'cancelled') {
                cancelledCount++;
            } else if (exemptParentTypes.includes(type)) {
                parentCount++;
            } else {
                activeCount++;
            }
        });

        console.log(`- Active Sub-tasks/Bugs: ${activeCount}`);
        console.log(`- Cancelled Tasks: ${cancelledCount}`);
        console.log(`- Parent Tickets (Epic/Story/Task): ${parentCount}`);
        
        console.log('\nVerification Logic:');
        console.log('Issues skipped in Effort Check should be:', cancelledCount + parentCount);
        console.log('Issues processed should be:', activeCount);

    } catch (err) {
        console.error('Error:', err.message);
    }
}

testStatusFilter();
