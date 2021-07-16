'use strict';

const path = require('path');
const fs = require('fs');
const {pipeline} = require('stream');
const {format, promisify} = require('util');
const {execSync} = require('child_process');

const _ = require('lodash');
const fetch = require('node-fetch');
const tar = require('tar');
const archiver = require('archiver');
const {Command} = require('commander');

const streamPipeline = promisify(pipeline);

const program = new Command();
program
    .description('Node.js C++ Addon node-gyp offline install')
    .option('-p, --platform [value]', 'target platform')
    .option('-a, --arch [value]', 'target arch')
    .option('-v, --version [value]', 'target version')
    .option('-m, --mirror [value]', 'Node.js mirror');

program.addHelpText('after', `

  Example call:
    $ node index.js -p win32 -a x64 -v 14.17.3 -m https://npm.taobao.org/mirrors/node/`);

program.parse();

const args = program.opts();
console.log('args', args);

const HOST_PLATFORM = process.platform;
const TARGET_PLATFORM = process.env.TARGET_PLATFORM || args.platform || HOST_PLATFORM;                                      // win32 linux
const TARGET_ARCH = process.env.TARGET_ARCH || args.arch || process.arch;                                                   // x86 x64 armv7l arm64
const TRARGET_VERSION = subVersion(process.env.TRARGET_VERSION) || subVersion(args.version) || subVersion(process.version); // 14.17.3
const NODEJS_MIRROR = padURL(process.env.NODEJS_MIRROR) || padURL(args.mirror) || 'https://nodejs.org/dist/'; // https://npm.taobao.org/mirrors/node/
const NODEJS_ALL_INFO_URL = NODEJS_MIRROR + 'index.json';

const DOWNLOAD_FOLDER_NAME = format('node-gyp-offline-install-%s-%s', TARGET_PLATFORM, TARGET_ARCH);
const CURRENT_PATH = __dirname;
const DOWNLOAD_PATH = path.join(CURRENT_PATH, DOWNLOAD_FOLDER_NAME);
let NODE_GYP_CACHE_PATH = '';
let INSTALL_SHELL_FILE_NAME = '';
if ('win32' === TARGET_PLATFORM) {
    INSTALL_SHELL_FILE_NAME = 'node-gyp-offline-install.bat';
    NODE_GYP_CACHE_PATH = path.join(DOWNLOAD_PATH, 'node-gyp', 'Cache');
} else if ('linux' === TARGET_PLATFORM) {
    INSTALL_SHELL_FILE_NAME = 'node-gyp-offline-install.sh';
    NODE_GYP_CACHE_PATH = path.join(DOWNLOAD_PATH, 'node-gyp');
} else {
}

main();

async function main() {
    if ('win32' === TARGET_PLATFORM && 'linux' === HOST_PLATFORM) {
        console.log('not support win32 on linux');
        return;
    }

    const response = await fetch(NODEJS_ALL_INFO_URL);
    const nodeJSAllInfo = await response.json();
    const nodeLatestLTSInfo = getNodeLatestLTS(nodeJSAllInfo);
    console.log('Node.js latest LTS Version ', nodeLatestLTSInfo.version, nodeLatestLTSInfo.date);

    if (fs.existsSync(DOWNLOAD_PATH)) {
        fs.rmdirSync(DOWNLOAD_PATH, {recursive : true});
    }
    fs.mkdirSync(NODE_GYP_CACHE_PATH, {recursive : true});

    // 1. download Node.js executable
    console.log('1. download Node.js executable');
    let nodeJSExeName;
    let nodeJSExeUrl;
    if ('win32' === TARGET_PLATFORM) {
        // https://npm.taobao.org/mirrors/node/v14.17.3/node-v14.17.3-x64.msi
        nodeJSExeName = format('node-v%s-%s.msi', TRARGET_VERSION, TARGET_ARCH);
        nodeJSExeUrl = format('%sv%s/node-v%s-%s.msi', NODEJS_MIRROR, TRARGET_VERSION, TRARGET_VERSION, TARGET_ARCH);
    } else if ('linux' === TARGET_PLATFORM) {
        // https://npm.taobao.org/mirrors/node/v14.17.3/node-v14.17.3-linux-x64.tar.gz
        nodeJSExeName = format('node-v%s-linux-%s.tar.gz', TRARGET_VERSION, TARGET_ARCH);
        nodeJSExeUrl = format('%sv%s/node-v%s-linux-%s.tar.gz', NODEJS_MIRROR, TRARGET_VERSION, TRARGET_VERSION, TARGET_ARCH);
    } else {
    }
    await downloadRemoteFile(nodeJSExeUrl, format('%s/%s', DOWNLOAD_PATH, nodeJSExeName));

    // 2. download Node.js headers
    console.log('2. download Node.js headers');
    // https://npm.taobao.org/mirrors/node/v14.17.3/node-v14.17.3-headers.tar.gz
    let nodeJSHeadersUrl = format('%sv%s/node-v%s-headers.tar.gz', NODEJS_MIRROR, TRARGET_VERSION, TRARGET_VERSION);
    let nodeJSHeadersFileName = format('node-v%s-headers.tar.gz', TRARGET_VERSION);
    await downloadRemoteFile(nodeJSHeadersUrl, path.join(NODE_GYP_CACHE_PATH, nodeJSHeadersFileName));
    // unzip Node.js headers
    await uncompressTgz(path.join(NODE_GYP_CACHE_PATH, nodeJSHeadersFileName), NODE_GYP_CACHE_PATH, true);
    // rename Node.js headers folder
    fs.renameSync(path.join(NODE_GYP_CACHE_PATH, format('node-v%s', TRARGET_VERSION)),
                  path.join(NODE_GYP_CACHE_PATH, TRARGET_VERSION));

    // 3. write installVersion
    console.log('3. write installVersion');
    fs.writeFileSync(path.join(path.join(NODE_GYP_CACHE_PATH, TRARGET_VERSION), 'installVersion'), '9');

    // 4. download node.lib (only windows)
    console.log('4. download node.lib (only windows)');
    if ('win32' === TARGET_PLATFORM) {
        // https://npm.taobao.org/mirrors/node/v14.17.3/win-x86/node.lib
        // https://npm.taobao.org/mirrors/node/v14.17.3/win-x64/node.lib
        let nodeJSX86LibUrl = format('%sv%s/win-%s/node.lib', NODEJS_MIRROR, TRARGET_VERSION, 'x86');
        let nodeJSX64LibUrl = format('%sv%s/win-%s/node.lib', NODEJS_MIRROR, TRARGET_VERSION, 'x64');
        let nodeJSX86LocalDir = path.join(NODE_GYP_CACHE_PATH, TRARGET_VERSION, 'ia32');
        let nodeJSX64LocalDir = path.join(NODE_GYP_CACHE_PATH, TRARGET_VERSION, 'x64');
        fs.mkdirSync(nodeJSX86LocalDir, {recursive : true});
        fs.mkdirSync(nodeJSX64LocalDir, {recursive : true});
        await downloadRemoteFile(nodeJSX86LibUrl, path.join(nodeJSX86LocalDir, 'node.lib'));
        await downloadRemoteFile(nodeJSX64LibUrl, path.join(nodeJSX64LocalDir, 'node.lib'));
    } else {
        // console.log('only windows need node.lib');
    }

    // 5. download latest node-gyp
    console.log('5. download latest node-gyp');
    if ('win32' === TARGET_PLATFORM) {
        if ('win32' === HOST_PLATFORM) {
            // .
            // ├─node_modules
            // │  └─node-gyp
            // ├─node-gyp
            // ├─node-gyp.cmd
            // └─node-gyp.ps1
            execSync(format('npm i node-gyp -g --prefix ./%s/node-gyp-module/npm', DOWNLOAD_FOLDER_NAME), {cwd : CURRENT_PATH});
        } else if ('linux' === HOST_PLATFORM) {
            // TODO:not support
        } else {
        }
    } else if ('linux' === TARGET_PLATFORM) {
        if ('win32' === HOST_PLATFORM) {
            execSync(format('npm i node-gyp -g --prefix ./%s/node-gyp-module/lib', DOWNLOAD_FOLDER_NAME), {cwd : CURRENT_PATH});
            fs.rmSync(path.join(DOWNLOAD_PATH, 'node-gyp-module/lib/node-gyp'));
            fs.rmSync(path.join(DOWNLOAD_PATH, 'node-gyp-module/lib/node-gyp.cmd'));
            fs.rmSync(path.join(DOWNLOAD_PATH, 'node-gyp-module/lib/node-gyp.ps1'));
        } else if ('linux' === HOST_PLATFORM) {
            // .
            // ├── bin // need to remove
            // │   └── node-gyp -> ../lib/node_modules/node-gyp/bin/node-gyp.js
            // └── lib
            //     └── node_modules
            //         └── node-gyp
            execSync(format('npm i node-gyp -g --prefix ./%s/node-gyp-module', DOWNLOAD_FOLDER_NAME), {cwd : CURRENT_PATH});
            fs.rmdirSync(path.join(DOWNLOAD_PATH, 'node-gyp-module/bin'), {recursive : true});
        } else {
        }
    } else {
    }

    // 6. create install shell
    console.log('6. create install shell');
    if ('win32' === TARGET_PLATFORM) {
        createWin32InstallShell(path.join(path.join(DOWNLOAD_PATH, INSTALL_SHELL_FILE_NAME)), TRARGET_VERSION, TARGET_ARCH);
        // windows copy 7za.exe
        fs.copyFileSync(path.join(CURRENT_PATH, '7za.exe'), path.join(DOWNLOAD_PATH, '7za.exe'));
    } else if ('linux' === TARGET_PLATFORM) {
        createLinuxInstallShell(path.join(path.join(DOWNLOAD_PATH, INSTALL_SHELL_FILE_NAME)), TRARGET_VERSION, TARGET_ARCH);
    } else {
    }

    // 7. compress node-gyp.zip and node-gyp-cache.zip
    console.log('7. compress node-gyp.zip and node-gyp-cache.zip');
    if ('win32' === TARGET_PLATFORM) {
        if ('win32' === HOST_PLATFORM) {
            compressFolderZip(path.join(DOWNLOAD_PATH, 'node-gyp'), path.join(DOWNLOAD_PATH, 'node-gyp-cache.zip'), true, true);
            compressFolderZip(path.join(DOWNLOAD_PATH, 'node-gyp-module'), path.join(DOWNLOAD_PATH, 'node-gyp-module.zip'), true, false);
            // compressFolderZip(DOWNLOAD_PATH, path.join(CURRENT_PATH, format('%s.zip', DOWNLOAD_FOLDER_NAME)), true);
        } else if ('linux' === HOST_PLATFORM) {
            // TODO:
        } else {
        }
    } else if ('linux' === TARGET_PLATFORM) {
        if ('win32' === HOST_PLATFORM) {
            compressFolderTgz(path.join(DOWNLOAD_PATH, 'node-gyp'), path.join(DOWNLOAD_PATH, 'node-gyp-cache.tar.gz'), true, true);
            compressFolderTgz(path.join(DOWNLOAD_PATH, 'node-gyp-module'), path.join(DOWNLOAD_PATH, 'node-gyp-module.tar.gz'), true, false);
        } else if ('linux' === HOST_PLATFORM) {
            compressFolderTgz(path.join(DOWNLOAD_PATH, 'node-gyp'), path.join(DOWNLOAD_PATH, 'node-gyp-cache.tar.gz'), true, true);
            compressFolderTgz(path.join(DOWNLOAD_PATH, 'node-gyp-module'), path.join(DOWNLOAD_PATH, 'node-gyp-module.tar.gz'), true, false);
        } else {
        }
    } else {
    }
};

/**
 * subVersion
 *
 * @param {string} version
 * @return {string} 
 */
function subVersion(version) {
    if (_.isEmpty(version)) {
        return version;
    } else {
        return _.startsWith(version, 'v') ? version.substring(1) : version;
    }
}

/**
 * padURL
 *
 * @param {string} url
 * @return {string} 
 */
function padURL(url) {
    if (_.isEmpty(url)) {
        return url;
    } else {
        return _.endsWith(url, '/') ? url : url + '/';
    }
}

/**
 * getNodeLatestLTS
 * @param {string} nodeJSAllInfo
 * @return {json}
 */
function getNodeLatestLTS(nodeJSAllInfo) {
    // {"version":"v14.17.3","date":"2021-07-05","lts":"Fermium"}
    let nodeLatestLTSIndex = _.findIndex(nodeJSAllInfo, (nodeInfo) => { return nodeInfo.lts; });
    let nodeLatestLTS = nodeJSAllInfo[nodeLatestLTSIndex];
    // console.log(JSON.stringify(nodeLatestLTS));
    return nodeLatestLTS;
}

/**
 * createWin32InstallShell
 *
 * @param {string} installShellFilePath
 * @param {string} nodeVersion
 * @param {string} arch
 */
function createWin32InstallShell(installShellFilePath, nodeVersion, arch) {
    let installShellStr = '';
    if ('win32' === HOST_PLATFORM) {
        installShellStr =
            `@echo off

SET CURRENT_PWD=%~dp0
        
echo install node-gyp for Node.js v${nodeVersion} ${arch}

%CURRENT_PWD%/7za.exe x -tzip -y -o%USERPROFILE%/AppData/Roaming/ node-gyp-module.zip
        
echo install node-gyp depend
%CURRENT_PWD%/7za.exe x -tzip -y -o%USERPROFILE%/AppData/Local/ node-gyp-cache.zip
        
pause
`;
    } else if ('linux' === HOST_PLATFORM) {
        // TODO: not support
    } else {
    }

    fs.writeFileSync(installShellFilePath, installShellStr);
}

/**
 * createLinuxInstallShell
 *
 * @param {string} installShellFilePath
 * @param {string} nodeVersion
 * @param {string} arch
 */
function createLinuxInstallShell(installShellFilePath, nodeVersion, arch) {
    let installShellStr = '';
    installShellStr =
        `#!/bin/bash

CURRENT_PWD=$(cd "$(dirname "$0")";pwd)

echo '1. install Node.js v${nodeVersion} ${arch}'
mkdir -p ~/software
sudo rm -rf ~/software/node-v${nodeVersion}-linux-${arch}
tar -zxvf node-v${nodeVersion}-linux-${arch}.tar.gz -C ~/software

echo '2. install node-gyp for Node.js v${nodeVersion} ${arch}'
tar zxvf node-gyp-module.tar.gz -C ~/software/node-v${nodeVersion}-linux-${arch}
chmod +x ~/software/node-v${nodeVersion}-linux-${arch}/lib/node_modules/node-gyp/bin/node-gyp.js
ln -sb ~/software/node-v${nodeVersion}-linux-${arch}/lib/node_modules/node-gyp/bin/node-gyp.js ~/software/node-v${nodeVersion}-linux-${arch}/bin/node-gyp

echo '3. install node-gyp cache for Node.js v${nodeVersion} ${arch}'
tar zxvf node-gyp-cache.tar.gz -C ~/.cache

sudo ln -sb ~/software/node-v${nodeVersion}-linux-${arch}/bin/* /usr/local/bin/

node -v
node-gyp -v
`;

    fs.writeFileSync(installShellFilePath, installShellStr, {mode : 0o755});
}

/**
 * compressFolderZip
 *
 * @param {string} sourceFolder
 * @param {string} desPath
 * @param {bool} isRemoveFolder
 * @param {bool} isContainRootFolder
 * @return {bool} 
 */
async function compressFolderZip(sourceFolder, desPath, isRemoveFolder, isContainRootFolder) {
    return new Promise(function(resolve, reject) {
        try {
            let output = fs.createWriteStream(desPath);
            let archive = archiver('zip', {zlib : {level : 9}});

            output.on('close', function() {
                if (isRemoveFolder) {
                    fs.rmdirSync(sourceFolder, {recursive : true});
                }
                resolve(true);
            });

            archive.on('error', function(error) {
                console.log(error.message);
                resolve(false);
            });

            archive.pipe(output);
            archive.directory(sourceFolder, isContainRootFolder ? sourceFolder.substr(path.dirname(sourceFolder).length + 1) : false);
            archive.finalize();
        } catch (error) {
            console.log(error.message);
            resolve(false);
        }
    });
}

/**
 * compressFolderTgz
 *
 * @param {string} sourceFolder
 * @param {string} desPath
 * @param {bool} isRemoveFolder
 * @param {bool} isContainRootFolder
 * @return {bool} 
 */
async function compressFolderTgz(sourceFolder, desPath, isRemoveFolder, isContainRootFolder) {
    return new Promise(function(resolve, reject) {
        try {
            let output = fs.createWriteStream(desPath);
            let archive = archiver('tar', {gzip : true}); // gzip for tar.gz

            output.on('close', function() {
                if (isRemoveFolder) {
                    fs.rmdirSync(sourceFolder, {recursive : true});
                }
                resolve(true);
            });

            archive.on('error', function(error) {
                console.log(error.message);
                resolve(false);
            });

            archive.pipe(output);
            archive.directory(sourceFolder, isContainRootFolder ? sourceFolder.substr(path.dirname(sourceFolder).length + 1) : false);
            archive.finalize();
        } catch (error) {
            console.log(error.message);
            resolve(false);
        }
    });
}

/**
 * uncompress tar.gz
 * 
 * @param {string} tgzFilePath
 * @param {string} desPath
 * @param {bool} isRemoveTgz
 * @return {bool} 
 */
async function uncompressTgz(tgzFilePath, desPath, isRemoveTgz) {
    return new Promise(function(resolve, reject) {
        tar.extract({
               file : tgzFilePath,
               cwd : desPath
           })
            .then(res => {
                if (isRemoveTgz) {
                    fs.rmSync(tgzFilePath);
                }
                resolve(true);
            })
            .catch(error => {
                console.log(error.message);
                resolve(false);
            })
    });
}

/**
 * downloadRemoteFile
 * 
 * @param {string} url download file remote url
 */
async function downloadRemoteFile(url, localFullFileName) {
    const response = await fetch(url);
    if (!response.ok) {
        console.log(format('unexpected response %s', response.statusText));
    } else {
        await streamPipeline(response.body, fs.createWriteStream(localFullFileName));
    }
}