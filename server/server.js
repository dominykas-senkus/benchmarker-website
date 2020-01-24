// const rest = require('../client/rest');
const express = require('express');
const app = express();

app.use(express.json());

const openshiftRestClient = require('openshift-rest-client').OpenshiftClient;
const projectName = '2262804sproject';
const settings = {};

settings.config = {
    url: 'https://idagpu-head.dcs.gla.ac.uk:8443',
    // url: 'https://console.ida.dcs.gla.ac.uk',
    auth: {
        username: '2262804s',
        password: 'bench12356'
    },
    insecureSkipTlsVerify: true
};


// const port = process.env.PORT || 5000;
const port = normalizePort(process.env.OPENSHIFT_NODEJS_PORT || '5000');
let ip = process.env.OPENSHIFT_NODEJS_IP;
if (typeof ip === "undefined") {
    //  Log errors on OpenShift but continue w/ 127.0.0.1 - this
    //  allows us to run/test the app locally.
    console.warn('No OPENSHIFT_NODEJS_IP var, using 127.0.0.1');
    ip = "127.0.0.1";
}

let jobsQueue = [];
let deletedQueueNames = new Set();

function checkRunningJob() {
    getJobs()
        .then(jobs => {
            // console.log(jobs);
            let runningJobs = getRunningJobs(jobs);
            console.log("Checking running jobs:");
            console.log(runningJobs);
            if ((typeof runningJobs === 'undefined' || runningJobs.length === 0) && jobsQueue.length > 0) {
                let jobParameters = jobsQueue.shift();
                while (deletedQueueNames.has(jobParameters.jobName)) {
                    jobParameters = jobsQueue.shift();
                }
                console.log("Checking parameters:");
                console.log(jobParameters);
                createNewJob(jobParameters);
                // res.redirect('/new');
            }
        });
}

setInterval(checkRunningJob, 10000);

// console.log that your server is up and running
app.listen(port, () => console.log(`${ip}:${port}`));

app.get('/', (req, res) => {
    res.redirect('/express_backend');
});

// create a GET routeL
app.get('/express_backend', (req, res) => {
    res.send({express: 'YOUR EXPRESS BACKEND IS CONNECTED TO REACT'});
});

app.post('/new_job', (req, res) => {
    // console.log(req);
    getJobs()
        .then(jobs => {
            // console.log(jobs);
            let runningJobs = getRunningJobs(jobs);
            console.log("running jobs:");
            console.log(runningJobs);
            req.body.jobName = req.body.jobType + req.body.jobName;
            if (typeof runningJobs === 'undefined' || runningJobs.length === 0) {

                let serviceJobManagerName = req.body.jobName.replace("job-", "srv-jobmanager-");
                let serviceTaskManagerName = req.body.jobName.replace("job-", "srv-taskmanager-");
                let deploymentConfigName = req.body.jobName.replace("job-", "dc-");
                let deploymentConfigJobManagerName = deploymentConfigName.replace("-flinksim-", "-flinksim-jobmanager-");
                let deploymentConfigTaskManagerName = deploymentConfigName.replace("-flinksim-", "-flinksim-taskmanager-");
                console.log(serviceJobManagerName);
                console.log(serviceTaskManagerName);
                console.log(deploymentConfigJobManagerName);
                console.log(deploymentConfigTaskManagerName);
                createJobManagerService(req.body, serviceJobManagerName);
                createTaskManagerService(req.body, serviceTaskManagerName);
                deployJobManager(req.body, serviceJobManagerName, deploymentConfigJobManagerName);
                deployTaskManager(req.body, serviceTaskManagerName, deploymentConfigTaskManagerName);
                createNewJob(req.body);
                // res.send({alerts:'New test created.'});
                res.redirect('/new');
            } else {
                jobsQueue.push(req.body);
                // res.send({alerts:'New test added to a queue.'});
                console.log("Jobs queue:");
                console.log(jobsQueue);
            }
        });
    return true;
});

app.post('/remove_job', (req, res) => {
    console.log("app.post removing name:");
    console.log(req.body.name);
    removeJob(req.body.name);
    // res.redirect('/new');
});

app.post('/remove_from_queue', (req, res) => {
    console.log("app.post removing name from queue:");
    console.log(req.body.name);
    deletedQueueNames.add(req.body.name);
    console.log(deletedQueueNames);
    // removeJob(req.body.name);
    // res.redirect('/new');
});

app.get('/running_jobs', (req, res) => {
    getJobs()
        .then(jobs => {
            console.log(jobs);
            let runningJobs = getRunningJobs(jobs);
            let queueNames = getQueueNames();
            res.send({
                data: jobs,
                runningJobs: runningJobs,
                queueNames: queueNames,
                deletedQueueNames: deletedQueueNames
            });
        })
});

app.get('/completed_jobs', (req, res) => {
    getJobs()
        .then(jobs => {
            // console.log(jobs);
            let jobsNames = [];
            for (let job in jobs.body.items) {
                // console.log("aaa");
                // console.log(job);
                if (jobs.body.items.hasOwnProperty(job)) {
                    if (jobs.body.items[job].status.succeeded === 1) {
                        jobsNames.push(jobs.body.items[job].metadata.name);
                        // console.log(jobs.body.items[job].metadata.name);
                    }
                }
            }
            // console.log("Job names: ");
            // console.log(jobsNames);
            res.send({data: jobs, jobsNames: jobsNames});
        })
});

async function removeJob(name) {
    const client = await openshiftRestClient(settings);
    console.log("Trying to remove job:");
    console.log(name);
    const job = await client.apis.batch.v1.ns(projectName).jobs(name).delete();
    console.log("Job:", job);
    return job;
}

async function getJobs() {
    const client = await openshiftRestClient(settings);
    // GET /apis/batch/v1/namespaces/$NAMESPACE/jobs HTTP/1.1
    const completedJobs = await client.apis.batch.v1.ns(projectName).jobs().get();
    // console.log("Completed Jobs:", completedJobs);
    return completedJobs;
}

function getQueueNames() {
    let jobsQueueNames = [];
    for (let name in jobsQueue) {
        if (jobsQueue.hasOwnProperty(name) && !deletedQueueNames.has(jobsQueue[name].jobName)) {
            console.log("Adding to queue:");
            console.log(jobsQueue[name].jobName);
            console.log(deletedQueueNames);
            jobsQueueNames.push(jobsQueue[name].jobName);
        }
    }
    return jobsQueueNames;
}

function getRunningJobs(jobs) {
    let runningJobs = [];
    for (let job in jobs.body.items) {
        // console.log("aaa");
        // console.log(job);
        if (jobs.body.items.hasOwnProperty(job)) {
            if (jobs.body.items[job].status.succeeded !== 1) {
                runningJobs.push(jobs.body.items[job].metadata.name);
                console.log(jobs.body.items[job].metadata.name);
            }
        }
    }
    console.log("Running jobs: ");
    console.log(runningJobs);
    return runningJobs;
}

async function createJobManagerService(values, serviceJobManagerName) {
    const client = await openshiftRestClient(settings);
    //job-appsimulator-flinksim-a
    // let name = values.jobName.replace("job-", "srv-jobmanager-");
// POST /api/v1/namespaces/$NAMESPACE/services HTTP/1.1
    let a = await client.api.v1.ns(projectName).services.post({
        "body":
            {
                "apiVersion": "v1",
                "kind": "Service",
                "metadata": {
                    "name": serviceJobManagerName,
                    "namespace": projectName
                },
                "spec": {
                    "ports": [
                        {
                            "name": "6123",
                            "port": 6123,
                            "targetPort": 6123
                        },
                        {
                            "name": "6124",
                            "port": 6124,
                            "targetPort": 6124
                        },
                        {
                            "name": "8081",
                            "port": 8081,
                            "targetPort": 8081
                        },
                        {
                            "name": "9250",
                            "port": 9250,
                            "targetPort": 9250
                        }
                    ],
                    "selector": {
                        "group": "appsimulator-flink-jobmanager"
                    }
                },
                "status": {
                    "loadBalancer": {}
                }
            }
    });
}

async function createTaskManagerService(values, serviceTaskManagerName) {
    const client = await openshiftRestClient(settings);
    //job-appsimulator-flinksim-a
    // let name = values.jobName.replace("job-", "srv-jobmanager-");
// POST /api/v1/namespaces/$NAMESPACE/services HTTP/1.1
    let a = await client.api.v1.ns(projectName).services.post({
        "body":
            {
                "apiVersion": "v1",
                "kind": "Service",
                "metadata": {
                    "name": serviceTaskManagerName,
                    "namespace": projectName
                },
                "spec": {
                    "ports": [
                        {
                            "name": "9250",
                            "port": 9250,
                            "targetPort": 9250
                        },
                        {
                            "name": "6121",
                            "port": 6121,
                            "targetPort": 6121
                        },
                        {
                            "name": "6122",
                            "port": 6122,
                            "targetPort": 6122
                        }
                    ],
                    "selector": {
                        "group": "appsimulator-flink-taskmanager"
                    }
                },
                "status": {
                    "loadBalancer": {}
                }
            }
    });
}

async function deployJobManager(values, serviceJobManagerName, deploymentConfigJobManagerName) {
    const client = await openshiftRestClient(settings);
    // console.log(name);
    // console.log(serviceName);
    // GET /oapi/v1/namespaces/$NAMESPACE/deploymentconfigs HTTP/1.1
    // let b = await client.oapi.v1.ns(projectName).deploymentconfigs.get();
    // console.log(b);
    //POST /oapi/v1/namespaces/$NAMESPACE/deploymentconfigs HTTP/1.1
//POST /apis/apps.openshift.io/v1/namespaces/$NAMESPACE/deploymentconfigs HTTP/1.1
    let a = await client.apis.app.v1.ns(projectName).deploymentconfigs.post({
            "body": {
                "apiVersion": "apps.openshift.io/v1",
                "kind": "DeploymentConfig",
                "metadata": {
                    "name": deploymentConfigJobManagerName,
                    "namespace": projectName
                },
                "spec": {
                    "replicas": 1,
                    "strategy": {
                        "resources": {}
                    },
                    "template": {
                        "metadata": {
                            "labels": {
                                "deploymentconfig": deploymentConfigJobManagerName,
                                "app": "appsimulator",
                                "group": "appsimulator-flink-jobmanager"
                            }
                        },
                        "spec": {
                            "containers": [
                                {
                                    "image": " ",
                                    "name": "jobmanager",
                                    "args": [
                                        "jobmanager"
                                    ],
                                    "env": [
                                        {
                                            "name": "JOB_MANAGER_RPC_ADDRESS",
                                            "value": serviceJobManagerName
                                        }
                                    ],
                                    "ports": [
                                        {
                                            "containerPort": 6123
                                        },
                                        {
                                            "containerPort": 6124
                                        },
                                        {
                                            "containerPort": 8081
                                        },
                                        {
                                            "containerPort": 9250
                                        }
                                    ],
                                    "resources": {}
                                }
                            ]
                        }
                    },
                    "restartPolicy": "Never",
                    "triggers": [
                        {
                            "type": "ConfigChange"
                        },
                        {
                            "type": "ImageChange",
                            "imageChangeParams": {
                                "automatic": true,
                                "containerNames": [
                                    "jobmanager"
                                ],
                                "from": {
                                    "kind": "ImageStreamTag",
                                    "name": "is-appsimulator-bench:v1"
                                }
                            }
                        }
                    ]
                },
                "status": {}
            }
        }
    );
    // return name;
}

async function deployTaskManager(values, serviceJobManagerName, deploymentConfigJobManagerName) {
    const client = await openshiftRestClient(settings);
    let a = await client.apis.app.v1.ns(projectName).deploymentconfigs.post({
        "body": {
            "apiVersion": "apps.openshift.io/v1",
            "kind": "DeploymentConfig",
            "metadata": {
                "name": deploymentConfigJobManagerName,
                "namespace": projectName
            },
            "spec": {
                "replicas": 1,
                "strategy": {
                    "resources": {}
                },
                "template": {
                    "metadata": {
                        "labels": {
                            "deploymentconfig": deploymentConfigJobManagerName,
                            "app": "appsimulator",
                            "group": "appsimulator-flink-taskmanager"
                        }
                    },
                    "spec": {
                        "containers": [
                            {
                                "args": [
                                    "taskmanager"
                                ],
                                "env": [
                                    {
                                        "name": "JOB_MANAGER_RPC_ADDRESS",
                                        "value": serviceJobManagerName
                                    }
                                ],
                                "image": " ",
                                "name": "taskmanager",
                                "ports": [
                                    {
                                        "containerPort": 6121
                                    },
                                    {
                                        "containerPort": 6122
                                    },
                                    {
                                        "containerPort": 9250
                                    }
                                ],
                                "resources": {}
                            }
                        ]
                    }
                },
                "restartPolicy": "Never",
                "triggers": [
                    {
                        "type": "ConfigChange"
                    },
                    {
                        "type": "ImageChange",
                        "imageChangeParams": {
                            "automatic": true,
                            "containerNames": [
                                "taskmanager"
                            ],
                            "from": {
                                "kind": "ImageStreamTag",
                                "name": "is-appsimulator-bench:v1"
                            }
                        }
                    }
                ]
            },
            "status": {}
        }


    });
}

async function createNewJob(values) {
    const client = await openshiftRestClient(settings);
    // console.log(values);
    // let a = await client.api.v1.ns(projectName).configmaps.get();
    // console.log(a);
    // console.log(a.body.items);
    // PATCH /api/v1/namespaces/$NAMESPACE/configmaps/$NAME HTTP/1.1
    let b = await client.api.v1.ns(projectName).configmaps('cm-appsimulator').patch({
            "body": {
                "data": {
                    "components.yaml": "- parents:\n    - 0\n  cpuTime: 5 # ms\n  memoryUsage: " + values.memoryUsage
                        + " # MB\n  outputSize: 1 # KB\n- parents:\n    - 0\n  cpuTime: 5 # ms\n  memoryUsage: " + values.memoryUsage
                        + " # MB\n  outputSize: 1 # KB\n  io:\n    mode: startup # startup, regular, or both\n "
                        + "   numRequests: " + values.numberOfRequests + "\n    responseSize: " + values.responseSize
                        + " # KB\n    latency: " + values.latency + " # ms\n    bandwidth: " + values.bandwidth
                        + " # Mbps\n    intervalBetweenRequests: " + values.intervalBetweenRequests + " # ms\n- parents:\n    - 1\n    - 2\n"
                        + "  cpuTime: 5 # ms\n  memoryUsage: " + values.memoryUsage + " # MB\n  outputSize: 1 # KB\n  io:\n    "
                        + "mode: both # startup, regular, or both\n    numRequests: " + values.numberOfRequests + "\n    responseSize: " +
                        values.responseSize + " # KB\n    latency: " + values.latency + " # ms\n    bandwidth: " + values.bandwidth
                        + " # Mbps\n    intervalBetweenRequests: " + values.intervalBetweenRequests + " # ms"
                }
            }
        }
    ).catch(function (error) {
        console.log(error);
        // Error handling here!
    });

    // let jobname = values.jobType + values.jobName;
    // console.log(jobname);

    // POST /apis/batch/v1/namespaces/$NAMESPACE/jobs HTTP/1.1
    client.apis.batch.v1.ns(projectName).jobs.post({
            "body": {
                "apiVersion": "batch/v1",
                "kind": "Job",
                "metadata": {
                    "name": values.jobName,
                    "namespace": "2262804sproject"
                },
                "spec": {
                    "parallelism": 1,
                    "completions": 1,
                    "template": {
                        "metadata": {
                            "labels": {
                                "deploymentconfig": values.jobName,
                                "app": "appsimulator",
                                "group": "2262804s"
                            }
                        },
                        "spec": {
                            "containers": [
                                {
                                    "name": "flinksim",
                                    "image": "docker-registry.default.svc:5000/2262804sproject/is-appsimulator-start:v1",
                                    "resources": {},
                                    "volumeMounts": [
                                        {
                                            "name": "config-files",
                                            "mountPath": "/opt/flink/config"
                                        }
                                    ],
                                    "env": [
                                        {
                                            "name": "JOB_MANAGER_RPC_ADDRESS",
                                            "value": "srv-jobmanager"
                                        }
                                    ],
                                    "imagePullPolicy": "Always"
                                }
                            ],
                            "volumes": [
                                {
                                    "name": "config-files",
                                    "configMap": {
                                        "name": "cm-appsimulator"
                                    }
                                }
                            ],
                            "restartPolicy": "Never"
                        }
                    }
                },
                "status": {}
            }
        }
    );
}

function normalizePort(val) {
    const port = parseInt(val, 10);
    if (isNaN(port)) {
        // named pipe
        return val;
    }
    if (port >= 0) {
        // port number
        return port;
    }
    return false;
}
