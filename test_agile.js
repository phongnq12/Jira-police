require('dotenv').config();
const axios = require('axios');
const config = require('./src/config/env');

async function testAgileAPI() {
    try {
        const authtoken = Buffer.from(`${config.JIRA.USERNAME}:${config.JIRA.API_TOKEN}`).toString('base64');
        const api = axios.create({
            baseURL: `${config.JIRA.BASE_URL}/rest/agile/1.0`,
            headers: { 'Authorization': `Basic ${authtoken}` }
        });

        const boardId = 856; 
        console.log(`Getting backlog for board ${boardId}`);
        const backlogRes = await api.get(`/board/${boardId}/backlog`);
        const backlogKeys = backlogRes.data.issues.map(i => i.key);
        console.log(`Backlog keys (${backlogKeys.length}):`, backlogKeys.join(', '));
        
        const sprintId = 1188; 
        console.log(`\nGetting sprint issues for sprint ${sprintId}`);
        const sprintRes = await api.get(`/sprint/${sprintId}/issue`);
        const sprintKeys = sprintRes.data.issues.map(i => i.key);
        console.log(`Sprint keys (${sprintKeys.length}):`, sprintKeys.join(', '));

        const jiraService = require('./src/services/jira.service');
        const jql = `project = "V.25.G.RD.C12.43.S" AND resolution = Unresolved AND sprint IN openSprints() AND sprint NOT IN futureSprints()`;
        let data = await jiraService.searchIssues(jql, ['summary']);
        const openSprintKeys = data.issues.map(i => i.key);

        const backlogIntersection = openSprintKeys.filter(k => backlogKeys.includes(k));
        console.log(`\nIntersection between openSprints() result and Agile Backlog:`, backlogIntersection);

    } catch(err) {
        console.error(err.message);
    }
}

testAgileAPI();
