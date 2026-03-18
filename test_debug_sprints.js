require('dotenv').config();
const jiraService = require('./src/services/jira.service');

async function debugSprints() {
    try {
        const projectKey = "V.25.G.RD.C12.43.S";
        
        let jql = `project = "${projectKey}" AND resolution = Unresolved`;
        console.log('Querying:', jql);
        
        let data = await jiraService.searchIssues(jql, ['summary', 'status', 'customfield_10101', 'customfield_10100']);
        
        data.issues.forEach(issue => {
            let sprintData = issue.fields.customfield_10101;
            let sprintStatus = 'NO SPRINT DATA';
            
            if (sprintData) {
                if (Array.isArray(sprintData)) {
                    sprintStatus = sprintData.map(s => {
                        let match = s.match(/state=([^,]+)/);
                        let nameMatch = s.match(/name=([^,\]]+)/);
                        return `[${match ? match[1] : 'Unknown'}: ${nameMatch ? nameMatch[1] : ''}]`;
                    }).join(', ');
                } else if (typeof sprintData === 'object' && sprintData.state) {
                     sprintStatus = `[${sprintData.state}: ${sprintData.name}]`;
                } else {
                     sprintStatus = `RAW: ${sprintData}`;
                }
            }
            console.log(`[${issue.key}] ${issue.fields.summary.padEnd(35)} | Status: ${issue.fields.status.name.padEnd(12)} | Sprints: ${sprintStatus}`);
        });
        
    } catch(err) {
        console.error(err);
    }
}
debugSprints();
