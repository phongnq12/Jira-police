require('dotenv').config();
const jiraService = require('./src/services/jira.service');

async function compareSprintQueries() {
    try {
        const projectKey = "V.25.G.RD.C12.43.S";
        
        let jql = `project = "${projectKey}" AND resolution = Unresolved AND sprint IN openSprints()`;
        let data = await jiraService.searchIssues(jql, ['summary', 'status']);
        let openSprintKeys = data.issues.map(i => i.key);
        
        jql = `project = "${projectKey}" AND resolution = Unresolved`;
        data = await jiraService.searchIssues(jql, ['summary', 'status']);
        let allUnresolvedKeys = data.issues.map(i => i.key);
        
        let notInOpenSprint = allUnresolvedKeys.filter(k => !openSprintKeys.includes(k));
        
        console.log(`Open Sprints: ${openSprintKeys.length} issues`);
        console.log(`All Unresolved: ${allUnresolvedKeys.length} issues`);
        console.log(`Unresolved missing from Open Sprints: ${notInOpenSprint.join(', ')}`);
        
    } catch(err) {
        console.error(err);
    }
}
compareSprintQueries();
