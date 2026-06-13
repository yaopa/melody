const logger = require('consola');
const asyncFs = require('../../utils/fs');
const genUUID = require('../../utils/uuid');
const { lock, unlock } = require('../../utils/simple_locker');
const JobStatus = require('../../consts/job_status');
const path = require('path');

const DataPath = `${__dirname}/../../../.profile/data`;
const JobDataPath = `${DataPath}/jobs`;
const JobIdPattern = /^[a-f0-9]{32}$/;

function isValidJobId(jobId) {
    return jobId && typeof jobId === 'string' && JobIdPattern.test(jobId);
}

function isPathWithinJobDir(filePath, userJobPath) {
    const normalizedFilePath = path.normalize(filePath);
    const normalizedUserJobPath = path.normalize(userJobPath);
    return normalizedFilePath.startsWith(normalizedUserJobPath + path.sep) ||
           normalizedFilePath === normalizedUserJobPath;
}

const JobManagerInitTime = Date.now();

async function listJobs(uid) {
    const list = [];
    const jobs = await getUserJobs(uid);
    for (const jobId in jobs) {
        const job = await getJob(uid, jobId);
        if (!job) {
            continue;
        }
        job.id = jobId;
        list.push(job);
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
}

async function getJob(uid, jobId) {
    const jobFile = await getJobFilePath(uid, jobId, false);
    if (!jobFile || !await asyncFs.asyncFileExisted(jobFile)) {
        return null;
    }
    const fileText = await asyncFs.asyncReadFile(jobFile);
    if (fileText == "") {
        return null;
    }
    return JSON.parse(fileText);
}

async function updateJob(uid, jobId, info) {
    const lockKey = getJobLockKey(jobId);
    if (!await lock(lockKey, 5)) {
        logger.error(`get job locker failed, uid: ${uid}, job: ${jobId}`);
        return false;
    }
    const job = await getJob(uid, jobId);
    if (!job) {
        unlock(lockKey);
        return false;
    }
    if (info.desc) {
        job.desc = info.desc;
    }
    if (info.progress !== undefined && info.progress !== null) {
        job.progress = info.progress;
    }
    if (info.status) {
        job.status = info.status;
    }
    if (info.tip) {
        job.tip = info.tip;
        if (!info.log) {
            info.log = info.tip
        }
    }
    if (info.log) {
        if (!job.logs) {
            job.logs = [];
        }
        job.logs.push({
            time: Date.now(),
            info: info.log
        });
    }
    if (info.data) {
        job.data = info.data;
    }
    const jobFile = await getJobFilePath(uid, jobId);
    if (!jobFile) {
        unlock(lockKey);
        return false;
    }
    await asyncFs.asyncWriteFile(jobFile, JSON.stringify(job));
    
    unlock(lockKey);
}

async function createJob(uid, job = {
    name: '',
    type: '',
    desc: '',
    progress: 0,
    tip: '',
    status: '',
    logs: [],
    data: {},
    createdAt: Date.now(),
}) {
    const jobId = genUUID();
    const jobFile = await getJobFilePath(uid, jobId);
    await asyncFs.asyncWriteFile(jobFile, JSON.stringify(job));
    
    await addJobIdToUserJobList(uid, jobId);
    return jobId;
}

async function deleteJob(uid, jobId) {
    if (!isValidJobId(jobId)) {
        return false;
    }
    await removeJobIdFromUserJobList(uid, jobId);
    const jobFile = await getJobFilePath(uid, jobId, false);
    if (jobFile && await asyncFs.asyncFileExisted(jobFile)) {
        await asyncFs.asyncUnlinkFile(jobFile);
    }
    return true;
}

async function addJobIdToUserJobList(uid, jobId) {
    const lockKey = getJobListLockKey(uid);
    if (!await lock(lockKey, 5)) {
        logger.error(`get job_list locker failed, uid: ${uid}`);
        return false;
    }
    const jobs = await getUserJobs(uid);
    jobs[jobId] = {
        createdAt: Date.now(),
    };
    await asyncFs.asyncWriteFile(await getJobListFilePath(uid), JSON.stringify(jobs));
    unlock(lockKey);
}

async function removeJobIdFromUserJobList(uid, jobId) {
    const lockKey = getJobListLockKey(uid);
    if (!await lock(lockKey, 5)) {
        logger.error(`get job_list locker failed, uid: ${uid}`);
        return false;
    }
    const jobs = await getUserJobs(uid);
    delete jobs[jobId];
    await asyncFs.asyncWriteFile(await getJobListFilePath(uid), JSON.stringify(jobs));
    unlock(lockKey);
}

function getJobListLockKey(uid) {
    return `job_list_${uid}`;
}

function getJobLockKey(jobId) {
    return `job_${jobId}`;
}

async function getUserJobs(uid) {
    const jobListFile = await getJobListFilePath(uid);
    return JSON.parse(await asyncFs.asyncReadFile(jobListFile));
}

async function getJobFilePath(uid, jobId, createIfNotExist = true) {
    if (!isValidJobId(jobId)) {
        return null;
    }
    const userJobPath = await getUserJobPath(uid);
    const constructedPath = `${userJobPath}/${jobId}`;
    const normalizedPath = path.normalize(constructedPath);
    if (!isPathWithinJobDir(normalizedPath, userJobPath)) {
        logger.error(`invalid job path, uid: ${uid}, jobId: ${jobId}`);
        return null;
    }
    if (createIfNotExist && !await asyncFs.asyncFileExisted(normalizedPath)) {
        await asyncFs.asyncWriteFile(normalizedPath, '{}');
    }
    return normalizedPath;
}

async function getJobListFilePath(uid, createIfNotExist = true) {
    const listFilePath = `${await getUserJobPath(uid)}/list`;
    if (createIfNotExist && !await asyncFs.asyncFileExisted(listFilePath)) {
        await asyncFs.asyncWriteFile(listFilePath, '{}');
    }
    return listFilePath;
}

async function getUserJobPath(uid, createIfNotExist = true) {
    const dirPath = `${JobDataPath}/${uid}`;
    if (createIfNotExist && !await asyncFs.asyncFileExisted(dirPath)) {
        await asyncFs.asyncMkdir(dirPath, { recursive: true });
    }
    return dirPath;
}

async function findActiveJobByArgs(uid, args) {
    const jobs = await listJobs(uid);
    return jobs.find(job => {
        if (job['args'] === args && job['status'] !== JobStatus.Failed && job['status'] !== JobStatus.Finished) {
            // 如果创建时间 早于 组件 init 时间，那么认为是无效的 job（意味着服务重启了，而目前 job 不支持重启服务后继续 run）
            if (job['createdAt'] < JobManagerInitTime) {
                return false;
            }
            // 超过 1 小时也认为超时
            if (Date.now() - job['createdAt'] > 1000 * 60 * 60) {
                return false;
            }
            return job;
        }
    });
}

module.exports = {
    listJobs: listJobs,
    createJob: createJob,
    findActiveJobByArgs: findActiveJobByArgs,
    deleteJob: deleteJob,
    getJob: getJob,
    updateJob: updateJob,
}