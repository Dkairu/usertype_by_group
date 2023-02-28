var got = require('got');

/* -------------------CONFIGURATION-------------------------------------- */
var API_KEY = $secure.QUERY_USER_KEY; //API key to query GRAPHQL
var INGEST_KEY = $secure.AUDITEVENT_INGEST_KEY; // add as a secure cred - Used to insert data into NRDB as a custom event.
var GRAPH_API = 'https://api.newrelic.com/graphql';
var HEADERS = { 'Content-Type': 'application/json', 'Api-Key': API_KEY };
var AccountID = 1969751
var EVENTS_API = `https://insights-collector.newrelic.com/v1/accounts/${AccountID}/events`;
var AuthenticationDomainID = '11752ae3-e1d0-41ca-9abc-1e7fe1eefa6d'


async function sendEvents(payload) {
    payload.eventType = "userTypeAuditEvent";
    var h = {
        'Content-Type': 'application/json',
        'Api-Key': INGEST_KEY
    };
    var options = {
        url: EVENTS_API,
        headers: h,
        json: payload
    };
    let resp = await got.post(options);
    if (resp.statusCode == 200) {
        console.log("Done posting to NRDB")
        return 'complete';
    } else {
        console.log('Error posting to NRDB ' + resp.statusCode);
        console.log(resp.body);
        return 'failed';
    };
}

function queryNerdGraph(c) {
    var cursorId = null;
    var cursorPresent = true;
    async function chkUser(c) {
        const checkUserType = `{
            actor {
              organization {
                userManagement {
                  authenticationDomains(id: "${AuthenticationDomainID}") {
                    authenticationDomains {
                      users(cursor: ${c}) {
                        users {
                          email
                          groups {
                            groups {
                              displayName
                            }
                          }
                          type {
                            displayName
                            id
                          }
                          id
                        }
                        nextCursor
                      }
                    }
                  }
                }
              }
            }
          }`

        const opts = {
            url: GRAPH_API,
            headers: HEADERS,
            json: { 'query': checkUserType, 'variables': variable }
        };
        const resp = await got.post(opts)
        const jsonResp = JSON.parse(resp.body);

        return jsonResp
    }
    const createFullUser = `mutation ($userId: ID!) {
        userManagementUpdateUser(updateUserOptions: {id: $userId, userType: FULL_USER_TIER}) {
          user {
            email
            type {
              displayName
            }
          }
        }
      }`;
    const createCoreUser = `mutation ($userId: ID!) {
        userManagementUpdateUser(updateUserOptions: {id: $userId, userType: CORE_USER_TIER}) {
          user {
            email
            type {
              displayName
            }
          }
        }
      }`;
    const createBasicUser = `mutation ($userId: ID!) {
        userManagementUpdateUser(updateUserOptions: {id: $userId, userType: BASIC_USER_TIER}) {
          user {
            email
            type {
              displayName
            }
          }
        }
      }`;
    var fullList = [];
    var q = '';
    var variable = {};

    var results;
    async function gql() {

        while (cursorPresent) {
            const jsonResp = await chkUser(cursorId)
            if (!jsonResp.errors) {
                results = jsonResp.data.actor.organization.userManagement.authenticationDomains.authenticationDomains[0].users.users;
                cursorId = jsonResp.data.actor.organization.userManagement.authenticationDomains.authenticationDomains[0].users.nextCursor
                cursorId = '"' + cursorId + '"'
                fullList = fullList.concat(results)
                if (cursorId.includes("null")) {
                    cursorPresent = false
                    console.log("End of getting users")
                }
            }
            else {
                console.log('Error while running query message:', jsonResp.errors[0].message)
                cursorPresent = false
            }
        }
        processUsers()
    }
    gql()

    function processUsers() {
        var opts = {};
        function options() {
            opts = {
                url: GRAPH_API,
                headers: HEADERS,
                json: { 'query': q, 'variables': variable }
            };
        };
        options()

        fullList.map(email => {
            let auditEvent = {};
            let groupNames = [];
            const groups = email.groups.groups
            groups.map(grp => {
                groupNames.push(grp.displayName)
            });
            const substrings = groupNames.toString();
            if (substrings.includes("FULL")) {
                if (email.type.displayName != 'Full platform') {
                    q = createFullUser;
                    variable = {
                        "userId": email.id
                    };
                    options();
                    got.post(opts).then(resp => {
                        const jsonResp = JSON.parse(resp.body);
                        const userInfo = jsonResp.data.userManagementUpdateUser.user
                        auditEvent = {"email":email.email,"userId":email.id,"description":`${email.email} was changed to a ${userInfo.type.displayName} user from a ${email.type.displayName} user type`}
                        sendEvents(auditEvent)
                        console.log("Full User Type done")
                    });
                }
            }
            else if (substrings.includes("CORE") && !substrings.includes("FULL")) {
                if (email.type.displayName != 'Core') {
                q = createCoreUser;
                variable = {
                    "userId": email.id
                };
                options();
                got.post(opts).then(resp => {
                    const jsonResp = JSON.parse(resp.body);
                    const userInfo = jsonResp.data.userManagementUpdateUser.user
                    auditEvent = {"email":email.email,"userId":email.id,"description":`${email.email} was changed to a ${userInfo.type.displayName} user from a ${email.type.displayName} user type`}
                    sendEvents(auditEvent)
                    console.log("Core User Type done")
                });

            }
            }
            else if ((!substrings.includes("CORE") || !substrings.includes("FULL"))) {
                if (email.type.displayName != 'Basic') {
                    q = createBasicUser;
                    variable = {
                        "userId": email.id
                    };
                    options();
                    got.post(opts).then(resp => {
                        const jsonResp = JSON.parse(resp.body);
                        const userInfo = jsonResp.data.userManagementUpdateUser.user
                        auditEvent = {"email":email.email,"userId":email.id,"description":`${email.email} was changed to a ${userInfo.type.displayName} user from a ${email.type.displayName} user type`}
                        sendEvents(auditEvent)
                        console.log("Basic User Type done")
                    });
                }
            };

        });
    }
    // });
};

queryNerdGraph();