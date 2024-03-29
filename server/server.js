const restClient = require('./rest.js');
const rest = new restClient();
const fsPromises = require('fs').promises;
const express = require('express');
const request = require('request');
const app = express();
app.use(express.json());

// const port = process.env.PORT || 5000;
const port = normalizePort(process.env.OPENSHIFT_NODEJS_PORT || '5000');
let ip = process.env.OPENSHIFT_NODEJS_IP;
if (typeof ip === "undefined") {
    //  Log errors on OpenShift but continue w/ 127.0.0.1 - this
    //  allows us to run/test the app locally.
    console.warn('No OPENSHIFT_NODEJS_IP var, using 127.0.0.1');
    ip = "127.0.0.1";
}

// let jobsQueue = [];
let jobsServicesDeploymentConfigs = {};
// let deletedQueueNames = new Set();
let lastRunningJobName = null;
let lastCompletedJobName = null;

// async function checkRunningJob() {
//
//     let jobs = await rest.getJobs();
//     let runningJobs = await getRunningJobs(jobs, []);
//     console.log("Checking running jobs:");
//     console.log(runningJobs);
//     console.log("Last completed job:");
//     console.log(lastCompletedJobName);
//
//     if (lastCompletedJobName != null) {
//         // rest.removeJob(lastRunningJobName);
//         let knownPodsNames = await readPodsFromFile();
//         let jobItems = await rest.getJob(lastCompletedJobName);
//         let job = jobItems.body;
//         console.log("Last completed job body:");
//         console.log(job);
//         // console.log(job.status);
//         // console.log(job.status.succeeded);
//         if (!(lastCompletedJobName in knownPodsNames)) {//&& jobs.hasOwnProperty(lastCompletedJobName)
//             if (job.status.succeeded === 1) {
//                 let lastCompletedJobPodName = await rest.getPodName(getDeploymentConfigTaskManagerName(lastCompletedJobName));
//                 console.log("lastCompletedJobPodName:");
//                 console.log(lastCompletedJobPodName);
//                 knownPodsNames[lastCompletedJobName] = lastCompletedJobPodName;
//                 await fsPromises.writeFile('/nfs/pods.json', JSON.stringify(knownPodsNames));
//                 await removeJobDependencies(lastCompletedJobName);
//                 lastCompletedJobName = null;
//             }
//         }
//     }
//
//     // if (await rest.hasJobSucceeded(lastRunningJobName)) {
//     //     lastCompletedJobName = lastRunningJobName;
//     //     lastRunningJobName = null;
//     // }
//
//     if ((typeof runningJobs === 'undefined' || runningJobs.length === 0) && jobsQueue.length > 0) {
//
//         let jobParameters = jobsQueue.shift();
//         while (deletedQueueNames.has(jobParameters.jobName)) {
//             jobParameters = jobsQueue.shift();
//         }
//         console.log("Checking parameters:");
//         console.log(jobParameters);
//         await prepareAndRunNewJob({"body": jobParameters});
//     }
// }

// setInterval(checkRunningJob, 10000);

// console.log that your server is up and running
app.listen(port, () => console.log(`${ip}:${port}`));

app.get('/', (req, res) => {
    res.redirect('/express_backend');
});

// create a GET route
app.get('/express_backend', (req, res) => {
    res.send({express: 'Backend connected'});
});

async function prepareAndRunNewJob(req) {
    let jobName = req.body.jobName;
    lastCompletedJobName = lastRunningJobName;
    lastRunningJobName = jobName;
    let serviceJobManagerName = getServiceJobManagerName(jobName);//req.body.jobName.replace("job-", "srv-jobmanager-");
    let serviceTaskManagerName = getServiceTaskManagerName(jobName);//req.body.jobName.replace("job-", "srv-taskmanager-");
    let imageStreamStartName = getImageStreamStartName(jobName);
    let buildConfigStartName = getBuildConfigStartName(jobName);
    let deploymentConfigJobManagerName = getDeploymentConfigJobManagerName(jobName);
    let deploymentConfigTaskManagerName = getDeploymentConfigTaskManagerName(jobName);

    jobsServicesDeploymentConfigs[jobName] = {
        "jobName": jobName,
        "serviceJobManagerName": serviceJobManagerName,
        "serviceTaskManagerName": serviceTaskManagerName,
        "deploymentConfigJobManagerName": deploymentConfigJobManagerName,//deploymentConfigJobManagerName,
        "deploymentConfigTaskManagerName": deploymentConfigTaskManagerName//deploymentConfigTaskManagerName
    };
    console.log("/new_job jobsServicesDeploymentConfigs:");
    console.log(jobsServicesDeploymentConfigs);
    await rest.patchPrometheusConfigMap(serviceJobManagerName, serviceTaskManagerName);
    await rest.createJobManagerService(serviceJobManagerName);
    await rest.createTaskManagerService(serviceTaskManagerName);
    await rest.createStartImageStream(imageStreamStartName);
    await rest.createStartBuildConfig(serviceJobManagerName, buildConfigStartName, imageStreamStartName);
    setTimeout(async function () {
        await rest.buildStartBuildConfig(buildConfigStartName);
    }, 5000);
    setTimeout(async function () {
        await rest.deployJobManager(serviceJobManagerName, deploymentConfigJobManagerName);
    }, 20000);
    setTimeout(async function () {
        await rest.deployTaskManager(serviceJobManagerName, serviceTaskManagerName, deploymentConfigTaskManagerName);
    }, 40000);
    setTimeout(function () {
        request.post(
            'http://prom-2262804sproject.ida.dcs.gla.ac.uk/-/reload',
            {json: {}},
            function (error, response, body) {
                if (!error && response.statusCode === 200) {
                    console.log(body);
                }
            }
        );
    }, 50000);
    setTimeout(async function () {
        await rest.patchFlinkConfigMap(serviceJobManagerName);
        await rest.patchComponentsConfigMap(req.body);
        await rest.createNewJob(jobName, serviceJobManagerName, imageStreamStartName,
            req.body.simulatorLimitCpu, req.body.simulatorLimitMemory, req.body.simulatorRequestCpu, req.body.simulatorRequestMemory)
    }, 70000);
}

app.post('/new_job', async (req, res) => {
    // let jobs = await rest.getJobs();
    // let runningJobs = await getRunningJobs(jobs, []);
    // console.log("running jobs:");
    // console.log(runningJobs);
    if (req.body.jobType === "job-appsimulator-flinksim-") {
        req.body.jobName = req.body.jobType + req.body.jobName;
        // if (typeof runningJobs === 'undefined' || runningJobs.length === 0) {
        await prepareAndRunNewJob(req);

        res.redirect('/new');
        // } else {
        //     jobsQueue.push(req.body);
        //     console.log("Jobs queue:");
        //     console.log(jobsQueue);
        // }
    }
    if (req.body.jobType === "job-vbcar-") {
        // let dataSplit = req.body.vbCarDataSplit.split("_").join("-");
        let jobName = req.body.jobType + req.body.vbCarDataSet.charAt(0) + req.body.vbCarDataSplit.slice(-1) + req.body.vbCarEmbedSize + "-" + req.body.vbCarJobName;
        let configName = 'vbcar-' + req.body.vbCarJobName + '.json';
        await createRecommenderConfigFile("VBCAR", configName, req.body.vbCarDataSet, req.body.vbCarDataSplit, req.body.vbCarEmbedSize);
        console.log(req.body);
        await rest.createNewRecommenderJob(jobName, "train_vbcar.py", configName,
            req.body.vbCarLimitCpu, req.body.vbCarLimitMemory, req.body.vbCarLimitGpu, req.body.vbCarRequestCpu, req.body.vbCarRequestMemory, req.body.vbCarRequestGpu)
    }
    if (req.body.jobType === "job-triple2vec-") {
        let jobName = req.body.jobType + req.body.triple2vecDataSet.charAt(0) + req.body.triple2vecDataSplit.slice(-1) + req.body.triple2vecEmbedSize + "-" + req.body.triple2vecJobName;
        let configName = 'triple2vec-' + req.body.triple2vecJobName + '.json';
        await createRecommenderConfigFile("Triple2vec", configName, req.body.triple2vecDataSet, req.body.triple2vecRequestMemory, req.body.triple2vecEmbedSize);
        console.log(req.body);
        await rest.createNewRecommenderJob(jobName, "train_triple2vec.py", configName,
            req.body.triple2vecLimitCpu, req.body.triple2vecLimitMemory, req.body.triple2vecLimitGpu, req.body.triple2vecRequestCpu, req.body.triple2vecRequestGpu, req.body.triple2vecRequestGpu)
    }
    if (req.body.jobType === "job-neumf-") {
        let jobName = req.body.jobType + req.body.neumfDataSet.charAt(0) + req.body.neumfDataSplit.slice(-1) + req.body.neumfEmbedSize + "-" + req.body.neumfJobName;
        let configName = 'neumf-' + req.body.neumfJobName + '.json';
        await createNeumfConfigFile(configName, req.body.neumfDataSet, req.body.neumfDataSplit, req.body.neumfEmbedSize);
        console.log(req.body);
        await rest.createNewRecommenderJob(jobName, "train_nmf.py", configName,
            req.body.neumfLimitCpu, req.body.neumfLimitMemory, req.body.neumfLimitGpu, req.body.neumfRequestCpu, req.body.neumfRequestMemory, req.body.neumfRequestGpu)
    }
});

async function removeJobDependencies(jobName) {
    await rest.removeService(getServiceTaskManagerName(jobName));
    await rest.removeService(getServiceJobManagerName(jobName));
    await rest.removeDeploymentConfig(getDeploymentConfigTaskManagerName(jobName));
    await rest.removeDeploymentConfig(getDeploymentConfigJobManagerName(jobName));
    await rest.removeStartBuildConfig(getBuildConfigStartName(jobName));
    await rest.removeStartImageStream(getImageStreamStartName(jobName));
}

app.post('/remove_job', async (req, res) => {
    console.log("app.post removing name:");
    let jobName = req.body.name;
    console.log(jobName);
    lastRunningJobName = null;
    let podName = await rest.getPodName(jobName, "job-name");
    console.log(podName);
    await rest.removeJob(jobName);
    let knownPodsNames = await readPodsFromFile();//JSON.parse(podsJSON.toString());
    delete knownPodsNames[jobName];
    await fsPromises.writeFile('/nfs/pods.json', JSON.stringify(knownPodsNames));
    if (typeof podName !== 'undefined') {
        await rest.removePod(podName);

    }
    let jobParameters = jobsServicesDeploymentConfigs[jobName];
    if (typeof jobParameters !== 'undefined') {
        removeJobDependencies(jobName);
        delete jobsServicesDeploymentConfigs[jobName];


    }
    // res.redirect('/new');
});

app.post('/remove_from_queue', async (req, res) => {
    console.log("app.post removing name from queue:");
    console.log(req.body.name);
    // deletedQueueNames.add(req.body.name);
    // console.log(deletedQueueNames);
    await rest.removeJob(req.body.name);
    // res.redirect('/new');
});

app.get('/running_jobs', async (req, res) => {
    let jobs = await rest.getJobs();
    console.log(jobs);
    let queueNames = await getQueueNames(jobs);
    let podsNames = {};
    let runningJobs = await getRunningJobs(jobs, queueNames);
    // let runningJobsNames = [];
    for (let job in runningJobs) {
        if (runningJobs.hasOwnProperty(job)) {
            let jobName = runningJobs[job];//.metadata.name;
            console.log(job);
            // runningJobsNames.push(jobName);
            // if (runningJobs[job].metadata.labels.app === "appsimulator") {
            //     let deploymentConfigTaskManagerName = getDeploymentConfigTaskManagerName(jobName);
                // let podTaskManagerName = await rest.getPodName(deploymentConfigTaskManagerName) ;
                // podsNames[jobName] = await rest.getPodName(deploymentConfigTaskManagerName)//runningJobs[job], "job-name");
            // } else {
                podsNames[jobName] = await rest.getPodName(jobName, "job-name");
            // }
        }
    }
    console.log("Pods Names");
    console.log(podsNames);
    res.send({
        data: jobs,
        runningJobs: runningJobs,
        queueNames: queueNames,
        // deletedQueueNames: deletedQueueNames,
        podsNames: podsNames
    });
});

app.get('/completed_jobs', async (req, res) => {
    let jobItems = await rest.getJobs();
    let jobsNames = [];
    let podsNames = {};
    let startTimes = {};
    let completionTimes = {};
    let jobs = jobItems.body.items;
    // let podsJSON = await fsPromises.readFile('/nfs/pods.json');
    let knownPodsNames = await readPodsFromFile();//JSON.parse(podsJSON.toString());
    console.log("Pod names from JSON");
    console.log(knownPodsNames);
    for (let job in jobs) {
        if (jobs.hasOwnProperty(job)) {
            if (jobs[job].status.succeeded === 1) {
                let jobName = jobs[job].metadata.name;
                let startTime = new Date(jobs[job].status.startTime.replace("T", " ").slice(0, -1)).getTime();
                console.log(startTime);
                let completionTime = new Date(jobs[job].status.completionTime.replace("T", " ").slice(0, -1)).getTime();
                console.log(completionTime);
                // let b1 = completionTime.replace("T", " ").slice(0, -1);
                // b1 = b1.replace("Z", "");
                // a1 = new Date(b1).getTime();
                startTimes[jobName] = startTime;
                completionTimes[jobName] = completionTime;

                jobsNames.push(jobName);

                if (jobs[job].metadata.labels.app === "appsimulator") {
                    let deploymentConfigTaskManagerName = getDeploymentConfigTaskManagerName(jobName);
                    let deploymentConfigJobManagerName = getDeploymentConfigJobManagerName(jobName);
                    // let serviceTaskManagerName = getServiceTaskManagerName(jobName);
                    // let serviceJobManagerName = getServiceJobManagerName(jobName);
                    let podTaskManagerName;
                    let podJobManagerName;
                    if (jobName in knownPodsNames) {
                        podTaskManagerName = knownPodsNames[jobName];
                    } else {
                        podTaskManagerName = await rest.getPodName(deploymentConfigTaskManagerName);//completedJob.deploymentConfigTaskManagerName);
                        podJobManagerName = await rest.getPodName(deploymentConfigJobManagerName);//completedJob.deploymentConfigTaskManagerName);
                        knownPodsNames[jobName] = podTaskManagerName;
                        removeJobDependencies(jobName);
                    }
                    console.log(jobName);
                    console.log(deploymentConfigTaskManagerName);
                    console.log("POD NAME");
                    console.log(podTaskManagerName);
                    podsNames[jobName] = podTaskManagerName;
                    console.log(podsNames);

                    delete jobsServicesDeploymentConfigs[jobName];
                } else {
                    console.log("ABC");
                    console.log(jobName);
                    podsNames[jobName] = await rest.getCompletedPodName(jobName);
                }
            }
        }
    }
    console.log("PODS NAMESSS");
    console.log(podsNames);
    console.log("KNOWN PODS NAMESSS");
    console.log(knownPodsNames);
    await fsPromises.writeFile('/nfs/pods.json', JSON.stringify(knownPodsNames));

    res.send({
        data: jobs,
        jobsNames: jobsNames,
        podsNames: podsNames,
        startTimes: startTimes,
        completionTimes: completionTimes
    });

});

async function getQueueNames(jobs) {
    let jobsQueueNames = [];
    for (let job in jobs.body.items) {
        if (jobs.body.items.hasOwnProperty(job)) {
            let jobName = jobs.body.items[job].metadata.name;
            // jobNames.push(jobName);
            let pending = await rest.checkIfPodIsPending(jobName);
            if (pending !== '') {
                jobsQueueNames.push(jobName);
            }
            // if (jobs.body.items[job].status.phase === "Pending") {
            //     jobsQueueNames.push(jobName);
            // }
            // if (jobs.body.items[job].status.succeeded !== 1) {
            //     runningJobs.push(jobName);
            // }
        }
    }
    // for (let name in jobsQueue) {
    //     if (jobsQueue.hasOwnProperty(name) && !deletedQueueNames.has(jobsQueue[name].jobName)) {
    //         console.log("Adding to queue:");
    //         console.log(jobsQueue[name].jobName);
    //         console.log(deletedQueueNames);
    //         jobsQueueNames.push(jobsQueue[name].jobName);
    //     }
    // }
    return jobsQueueNames;
}

async function getRunningJobs(jobs, queueNames) {
    let jobNames = [];
    let runningJobs = [];
    for (let job in jobs.body.items) {
        if (jobs.body.items.hasOwnProperty(job)) {
            let jobName = jobs.body.items[job].metadata.name;
            jobNames.push(jobName);
            // if (jobs.body.items[job].status.phase === "Pending") {
            //     jobsQueue.push(jobName);
            // }
            console.log("getRunningJObs queuenames");
            console.log(queueNames);
            if (!queueNames.includes(jobName) && jobs.body.items[job].status.succeeded !== 1) {
                runningJobs.push(jobName);
            }
        }
    }

    for (let job in jobsServicesDeploymentConfigs) {
        if (!jobNames.includes(job)) {
            runningJobs.push(job);
        }
    }
    console.log("Running jobs: ");
    console.log(runningJobs);
    return runningJobs;
}

function getBuildConfigStartName(jobName) {
    let buildConfigName = jobName.replace("job-", "bc-");
    return buildConfigName.replace("appsimulator-flinksim-", "appsimulator-start-");
}

function getImageStreamStartName(jobName) {
    let imageStreamName = jobName.replace("job-", "is-");
    return imageStreamName.replace("appsimulator-flinksim-", "appsimulator-start-");
}

function getDeploymentConfigJobManagerName(jobName) {
    let deploymentConfigName = jobName.replace("job-", "dc-");
    return deploymentConfigName.replace("-flinksim-", "-flinksim-jobmanager-");
}

function getDeploymentConfigTaskManagerName(jobName) {
    let deploymentConfigName = jobName.replace("job-", "dc-");
    return deploymentConfigName.replace("-flinksim-", "-flinksim-taskmanager-");
}

function getServiceTaskManagerName(jobName) {
    return jobName.replace("job-", "srv-taskmanager-");
}

function getServiceJobManagerName(jobName) {
    return jobName.replace("job-", "srv-jobmanager-");
}

async function readPodsFromFile() {
    let podsJSON = await fsPromises.readFile('/nfs/pods.json');
    // let knownPodsNames;
    // if (podsJSON == null) {
    //     knownPodsNames = null;
    // } else {
    //     knownPodsNames = JSON.parse(podsJSON.toString());
    // }
    return JSON.parse(podsJSON.toString());
}

async function createRecommenderConfigFile(model, configName, dataSet, dataSplit, embedSize) {
    let configFile = {
        "model": model,//"VBCAR",
        "config_id": "default",//"vbcar_dunnhumby_leave_one_basket_0_.01_.0005_lrelu_rmsprop_32",
        "dataset": dataSet,
        "data_split": dataSplit,
        "data_split_comment": "options:temporal leave_one_out",
        "temp_train": 0,
        "temp_train_comment": "options: 0,10,20,30,40,50,100",
        "percent": 1,
        "n_sample": 10000,
        "metrics": ["ndcg_at_k", "precision_at_k", "recall_at_k", "map_at_k"],
        "late_dim": 512,
        "emb_dim": parseInt(embedSize),
        "n_neg": 5,
        "batch_size": 256,
        "alpha": 0.01,
        "alpha_comment": "options: 0.0001,0.001,0.005,0.01,0.05,0.1,0.5",
        "user_fea_dim": 512,
        "item_fea_dim": 512,
        "device": "gpu",
        "feature_type": "random",
        "activator": "lrelu",
        "activator_comment": "options:relu, tanh",
        "optimizer": "rmsprop",
        "optimizer_comment": "options:adam, rmsprop",
        "lr": 5.0E-4,
        "lr_comment": "options:0.0001, 0.0025, 0.005, 0.01",
        "l2_regularization": 0.01,
        "num_epoch": 120,
        "result_file": "results.csv",
        "log_dir": "/logs/",
        "result_dir": "/results/",
        "checkpoint_dir": "/checkpoints/",
        "dataset_dir": "/datasets/",
        "sample_dir": "/samples/",
        "run_dir": "/runs/",
        "root_dir": "/nfs/tr_rec/"
    };
    await fsPromises.writeFile('/nfs/tr_rec/configs/' + configName, JSON.stringify(configFile));
}

async function createNeumfConfigFile(configName, dataSet, dataSplit, embedSize) {
    let configFile = {
        "model": "neumf",
        "config_id": "default",//"neumf_dunnhumby_leave_one_basket_0_.005_rmsprop_128",
        "root_dir": "/nfs/tr_rec/",
        "common_config": {
            "dataset": dataSet,//"dunnhumby",
            "data_split": dataSplit,//"leave_one_basket",
            "temp_train": 0,
            "emb_dim": parseInt(embedSize),//128,
            "num_negative": 4,
            "batch_size": 1024,
            "metrics": ["ndcg_at_k", "precision_at_k", "recall_at_k", "map_at_k"],
            "device": "gpu",
            "optimizer": "rmsprop",
            "lr": 0.005,
            "num_epoch": 50,
            "result_file": "results.csv",
            "log_dir": "/logs/",
            "result_dir": "/results/",
            "checkpoint_dir": "/checkpoints/",
            "dataset_dir": "/datasets/",
            "run_dir": "/runs/"
        },
        "gmf_config": {
            "name": "gmf",
            "latent_dim": 16,
            "save_name": "gmf.model"
        },
        "mlp_config": {
            "name": "mlp",
            "latent_dim": 16,
            "layers": [32, 64, 32, 16, 8],
            "save_name": "mlp.model",
            "pretrain_gmf": "gmf.model"
        },
        "neumf_config": {
            "name": "neumf",
            "latent_dim_gmf": 16,
            "latent_dim_mlp": 16,
            "layers": [32, 64, 32, 8],
            "pretrain_gmf": "gmf.model",
            "pretrain_mlp": "mlp.model",
            "save_name": "neumf.model"
        },
        "checkpoint_dir": "/checkpoints/",
        "sample_dir": null,
        "run_dir": "/runs/",
        "dataset_dir": "/datasets/",
        "result_dir": "/results/",
        "result_file": "results.csv",
        "log_dir": "/logs/"
    };
    await fsPromises.writeFile('/nfs/tr_rec/configs/' + configName, JSON.stringify(configFile));
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
