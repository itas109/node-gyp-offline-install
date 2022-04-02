'use strict';

const path = require('path');
const fs = require('fs');
const {pipeline} = require('stream');
const {format, promisify} = require('util');
const {execSync} = require('child_process');

const _ = require('lodash');
const fetch = require('node-fetch');
const archiver = require('archiver');
const {Command} = require('commander');

const streamPipeline = promisify(pipeline);

const program = new Command();
program
    .description('Node.js C++ Addon node-gyp offline install')
    .option('-p, --platform [value]', 'target platform, default current platform')
    .option('-a, --arch [value]', 'target arch, default current arch')
    .option('-v, --version [value]', 'target version, default current version')
    .option('-alc, --autoLTSCount [value]', 'auto download last count lts, default 1') // -alc higher than -v 
    .option('-m, --mirror [value]', 'Node.js mirror, default taobao mirror');

program.addHelpText('after', `

  Example call:
    $ node index.js -p win32 -a x64 -v 16.14.0 -m https://npm.taobao.org/mirrors/node/
    $ node index.js -p win32 -a x64 -alc 1 -m https://npm.taobao.org/mirrors/node/`);

program.parse();

const args = program.opts();
console.log('args', args);

const HOST_PLATFORM = process.platform;
const TARGET_PLATFORM = process.env.TARGET_PLATFORM || args.platform || HOST_PLATFORM;                                      // win32 linux
const TARGET_ARCH = process.env.TARGET_ARCH || args.arch || process.arch;                                                   // x86 x64 armv7l arm64
let TRARGET_VERSION = subVersion(process.env.TRARGET_VERSION) || subVersion(args.version) || subVersion(process.version);   // 16.14.0
const AUTO_LTS_COUNT = args.autoLTSCount;
const NODEJS_MIRROR = padURL(process.env.NODEJS_MIRROR) || padURL(args.mirror) || 'https://npm.taobao.org/mirrors/node/';   // https://nodejs.org/dist/
const NODEJS_ALL_INFO_URL = NODEJS_MIRROR + 'index.json';

let configInfo = format('\nConfig Info\nPlatform: %s\nArch: %s\nVersion: %s\nMirror: %s\n',
                        TARGET_PLATFORM, TARGET_ARCH, TRARGET_VERSION, NODEJS_MIRROR);
console.log(configInfo);

let CURRENT_PATH = __dirname;
let DOWNLOAD_FOLDER_NAME = '';
let DOWNLOAD_PATH = '';
let NODE_GYP_CACHE_PATH = '';
let CMAKE_JS_CACHE_PATH = '';
let INSTALL_SHELL_FILE_NAME = '';

function setParam(){
    console.log(format('Download Version %s\n', TRARGET_VERSION));
    DOWNLOAD_FOLDER_NAME = format('node-gyp-offline-install-%s-%s-v%s', TARGET_PLATFORM, TARGET_ARCH, TRARGET_VERSION);
    DOWNLOAD_PATH = path.join(CURRENT_PATH, DOWNLOAD_FOLDER_NAME);
    if ('win32' === TARGET_PLATFORM) {
        INSTALL_SHELL_FILE_NAME = 'node-gyp-offline-install.bat';
        NODE_GYP_CACHE_PATH = path.join(DOWNLOAD_PATH, 'node-gyp', 'Cache');
        CMAKE_JS_CACHE_PATH = path.join(DOWNLOAD_PATH, '.cmake-js');
    } else if ('linux' === TARGET_PLATFORM) {
        INSTALL_SHELL_FILE_NAME = 'node-gyp-offline-install.sh';
        NODE_GYP_CACHE_PATH = path.join(DOWNLOAD_PATH, 'node-gyp');
        CMAKE_JS_CACHE_PATH = path.join(DOWNLOAD_PATH, '.cmake-js');
    } else {
    }
}

(async () => {
    if(AUTO_LTS_COUNT){
        const response = await fetch(NODEJS_ALL_INFO_URL);
        const nodeJSAllInfo = await response.json();
        let nodeLTS = getNodeLTS(nodeJSAllInfo);
        for(let i=0; i < AUTO_LTS_COUNT; i++){
            TRARGET_VERSION = nodeLTS[i].version.substr(1); // remove char v
            setParam();
            await run();
        }
    }else{
        setParam();
        await run();
    }
})();

async function run() {
    if ('win32' === TARGET_PLATFORM && 'linux' === HOST_PLATFORM) {
        console.log('not support win32 on linux');
        return;
    }

    const response = await fetch(NODEJS_ALL_INFO_URL);
    const nodeJSAllInfo = await response.json();
    const nodeLatestLTSInfo = getNodeLatestLTS(nodeJSAllInfo);
    console.log(format('Node.js latest LTS Version %s %s\n', nodeLatestLTSInfo.version, nodeLatestLTSInfo.date));

    if (fs.existsSync(DOWNLOAD_PATH)) {
        fs.rmdirSync(DOWNLOAD_PATH, {recursive : true});
    }
    fs.mkdirSync(DOWNLOAD_PATH, {recursive : true});

    // 1. download Node.js executable
    console.log('1. download Node.js executable');
    let nodeJSExeName;
    let nodeJSExeUrl;
    if ('win32' === TARGET_PLATFORM) {
        // https://npm.taobao.org/mirrors/node/v16.14.0/node-v16.14.0-x64.msi
        nodeJSExeName = format('node-v%s-%s.msi', TRARGET_VERSION, TARGET_ARCH);
        nodeJSExeUrl = format('%sv%s/node-v%s-%s.msi', NODEJS_MIRROR, TRARGET_VERSION, TRARGET_VERSION, TARGET_ARCH);
    } else if ('linux' === TARGET_PLATFORM) {
        // https://npm.taobao.org/mirrors/node/v16.14.0/node-v16.14.0-linux-x64.tar.gz
        nodeJSExeName = format('node-v%s-linux-%s.tar.gz', TRARGET_VERSION, TARGET_ARCH);
        nodeJSExeUrl = format('%sv%s/node-v%s-linux-%s.tar.gz', NODEJS_MIRROR, TRARGET_VERSION, TRARGET_VERSION, TARGET_ARCH);
    } else {
    }
    await downloadRemoteFile(nodeJSExeUrl, format('%s/%s', DOWNLOAD_PATH, nodeJSExeName));

    // 2. download Node.js headers
    console.log('2. download Node.js headers');
    // https://npm.taobao.org/mirrors/node/v16.14.0/node-v16.14.0-headers.tar.gz
    let nodeJSHeadersUrl = format('%sv%s/node-v%s-headers.tar.gz', NODEJS_MIRROR, TRARGET_VERSION, TRARGET_VERSION);
    let nodeJSHeadersFileName = format('node-v%s-headers.tar.gz', TRARGET_VERSION);
    await downloadRemoteFile(nodeJSHeadersUrl, path.join(DOWNLOAD_PATH, nodeJSHeadersFileName));

    // 3. download node.lib (only windows)
    console.log('3. download node.lib (only windows)');
    if ('win32' === TARGET_PLATFORM) {
        fs.mkdirSync(NODE_GYP_CACHE_PATH, {recursive : true});
        fs.mkdirSync(path.join(CMAKE_JS_CACHE_PATH, "node-ia32"), {recursive : true});
        fs.mkdirSync(path.join(CMAKE_JS_CACHE_PATH, "node-x64"), {recursive : true});

        // https://npm.taobao.org/mirrors/node/v16.14.0/win-x86/node.lib
        // https://npm.taobao.org/mirrors/node/v16.14.0/win-x64/node.lib
        // A. node-gyp lib
        let nodeJSX86LibUrl = format('%sv%s/win-%s/node.lib', NODEJS_MIRROR, TRARGET_VERSION, 'x86');
        let nodeJSX64LibUrl = format('%sv%s/win-%s/node.lib', NODEJS_MIRROR, TRARGET_VERSION, 'x64');
        let nodegypX86LocalDir = path.join(NODE_GYP_CACHE_PATH, TRARGET_VERSION, 'ia32');
        let nodegypX64LocalDir = path.join(NODE_GYP_CACHE_PATH, TRARGET_VERSION, 'x64');
        fs.mkdirSync(nodegypX86LocalDir, {recursive : true});
        fs.mkdirSync(nodegypX64LocalDir, {recursive : true});
        await downloadRemoteFile(nodeJSX86LibUrl, path.join(nodegypX86LocalDir, 'node.lib'));
        await downloadRemoteFile(nodeJSX64LibUrl, path.join(nodegypX64LocalDir, 'node.lib'));
        // B. cmake-js lib
        let cmakejsX86LocalDir = path.join(CMAKE_JS_CACHE_PATH, "node-ia32", format('v%s', TRARGET_VERSION), 'win-x86');
        let cmakejsX64LocalDir = path.join(CMAKE_JS_CACHE_PATH, "node-x64", format('v%s', TRARGET_VERSION), 'win-x64');
        fs.mkdirSync(cmakejsX86LocalDir, {recursive : true});
        fs.mkdirSync(cmakejsX64LocalDir, {recursive : true});
        fs.copyFileSync(path.join(nodegypX86LocalDir, 'node.lib'), path.join(cmakejsX86LocalDir, 'node.lib'));
        fs.copyFileSync(path.join(nodegypX64LocalDir, 'node.lib'), path.join(cmakejsX64LocalDir, 'node.lib'));
    } else {
        // console.log('only windows need node.lib');
    }

    // 4. download latest node-gyp
    console.log('4. download latest node-gyp and cmake-js');
    if ('win32' === TARGET_PLATFORM) {
        if ('win32' === HOST_PLATFORM) {
            // .
            // ├─node_modules
            // │  └─node-gyp
            // ├─node-gyp
            // ├─node-gyp.cmd
            // └─node-gyp.ps1
            execSync(format('npm i node-gyp cmake-js node-addon-api -g --prefix ./%s/node-gyp-module/npm', DOWNLOAD_FOLDER_NAME), {cwd : CURRENT_PATH});
        } else if ('linux' === HOST_PLATFORM) {
            // TODO:not support
        } else {
        }
    } else if ('linux' === TARGET_PLATFORM) {
        if ('win32' === HOST_PLATFORM) {
            execSync(format('npm i node-gyp cmake-js node-addon-api -g --prefix ./%s/node-gyp-module/lib', DOWNLOAD_FOLDER_NAME), {cwd : CURRENT_PATH});
            fs.rmSync(path.join(DOWNLOAD_PATH, 'node-gyp-module/lib/node-gyp'));
            fs.rmSync(path.join(DOWNLOAD_PATH, 'node-gyp-module/lib/node-gyp.cmd'));
            fs.rmSync(path.join(DOWNLOAD_PATH, 'node-gyp-module/lib/node-gyp.ps1'));
            fs.rmSync(path.join(DOWNLOAD_PATH, 'node-gyp-module/lib/cmake-js'));
            fs.rmSync(path.join(DOWNLOAD_PATH, 'node-gyp-module/lib/cmake-js.cmd'));
            fs.rmSync(path.join(DOWNLOAD_PATH, 'node-gyp-module/lib/cmake-js.ps1'));
        } else if ('linux' === HOST_PLATFORM) {
            // .
            // ├── bin // need to remove
            // │   └── node-gyp -> ../lib/node_modules/node-gyp/bin/node-gyp.js
            // └── lib
            //     └── node_modules
            //         └── node-gyp
            execSync(format('npm i node-gyp cmake-js node-addon-api -g --prefix ./%s/node-gyp-module', DOWNLOAD_FOLDER_NAME), {cwd : CURRENT_PATH});
            fs.rmdirSync(path.join(DOWNLOAD_PATH, 'node-gyp-module/bin'), {recursive : true});
        } else {
        }
    } else {
    }

    // 5. create install shell
    console.log('5. create install shell');
    if ('win32' === TARGET_PLATFORM) {
        createWin32InstallShell(path.join(path.join(DOWNLOAD_PATH, INSTALL_SHELL_FILE_NAME)), TRARGET_VERSION, TARGET_ARCH);
        // windows copy 7za.exe
        fs.copyFileSync(path.join(CURRENT_PATH, '7za.exe'), path.join(DOWNLOAD_PATH, '7za.exe'));
    } else if ('linux' === TARGET_PLATFORM) {
        createLinuxInstallShell(path.join(path.join(DOWNLOAD_PATH, INSTALL_SHELL_FILE_NAME)), TRARGET_VERSION, TARGET_ARCH);
        // linux copy 7za
        fs.copyFileSync(path.join(CURRENT_PATH, '7za'), path.join(DOWNLOAD_PATH, '7za'));
    } else {
    }

    // 6. compress node-gyp.zip and node-gyp-cache.zip
    console.log('6. compress node-gyp.zip and node-gyp-cache.zip');
    if ('win32' === TARGET_PLATFORM) {
        if ('win32' === HOST_PLATFORM) {
            compressFolderZip(path.join(DOWNLOAD_PATH, 'node-gyp'), path.join(DOWNLOAD_PATH, 'node-gyp-cache.zip'), true, true);
            compressFolderZip(path.join(DOWNLOAD_PATH, '.cmake-js'), path.join(DOWNLOAD_PATH, 'cmake-js-cache.zip'), true, true);
            compressFolderZip(path.join(DOWNLOAD_PATH, 'node-gyp-module'), path.join(DOWNLOAD_PATH, 'node-gyp-module.zip'), true, false);
            // compressFolderZip(DOWNLOAD_PATH, path.join(CURRENT_PATH, format('%s.zip', DOWNLOAD_FOLDER_NAME)), true);
        } else if ('linux' === HOST_PLATFORM) {
            // TODO:
        } else {
        }
    } else if ('linux' === TARGET_PLATFORM) {
        if ('win32' === HOST_PLATFORM) {
           compressFolderZip(path.join(DOWNLOAD_PATH, 'node-gyp-module'), path.join(DOWNLOAD_PATH, 'node-gyp-module.zip'), true, false);
        } else if ('linux' === HOST_PLATFORM) {
            compressFolderZip(path.join(DOWNLOAD_PATH, 'node-gyp-module'), path.join(DOWNLOAD_PATH, 'node-gyp-module.zip'), true, false);
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
    // {"version":"v16.14.0","date":"2022-02-08","lts":"Gallium"}
    let nodeLatestLTSIndex = _.findIndex(nodeJSAllInfo, (nodeInfo) => { return nodeInfo.lts; });
    let nodeLatestLTS = nodeJSAllInfo[nodeLatestLTSIndex];
    // console.log(JSON.stringify(nodeLatestLTS));
    return nodeLatestLTS;
}

/**
 * getNodeLatestMainVersion
 * @param {string} nodeJSAllInfo
 * @return [{json}]
 */
function getNodeLatestMainVersion(nodeJSAllInfo) {
    let hash = {};
    return nodeJSAllInfo.reduce(function (item, next) {
        //{"version":"v16.14.0","date":"2022-02-08","lts":"Gallium"}
        let version = next.version;
        let versionArray = version.match(/v(\d*)\.(\d*)\.(\d*)$/);
        if (null == versionArray || versionArray.length < 2) {
            return item;
        }
        let mainVersion = versionArray[1];
        // suppose version sort desc
        if (null == hash[mainVersion]) {
            hash[mainVersion] = version;
            item.push(next);
        }
        return item;
    }, [])
}

/**
 * getNodeLTS
 * @param {string} nodeJSAllInfo
 * @return [{json}]
 */
function getNodeLTS(nodeJSAllInfo){
    let latestMainVersion = getNodeLatestMainVersion(nodeJSAllInfo);

    return _.filter(latestMainVersion, "lts");
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

%CURRENT_PWD%/7za.exe x -y -o%USERPROFILE%/AppData/Roaming/ node-gyp-module.zip

echo install node-gyp depend
%CURRENT_PWD%/7za.exe x -y -o%USERPROFILE%/AppData/Local/node-gyp/Cache/ node-v${nodeVersion}-headers.tar.gz
%CURRENT_PWD%/7za.exe rn %USERPROFILE%/AppData/Local/node-gyp/Cache/node-v${nodeVersion}-headers.tar node-v${nodeVersion} ${nodeVersion}
%CURRENT_PWD%/7za.exe x -y -o%USERPROFILE%/AppData/Local/node-gyp/Cache/ %USERPROFILE%/AppData/Local/node-gyp/Cache/node-v${nodeVersion}-headers.tar
%CURRENT_PWD%/7za.exe x -y -o%USERPROFILE%/AppData/Local/ node-gyp-cache.zip
echo 9 > %USERPROFILE%/AppData/Local/node-gyp/Cache/${nodeVersion}/installVersion

echo install cmake-js depend
%CURRENT_PWD%/7za.exe x -y -o%USERPROFILE%/.cmake-js node-v${nodeVersion}-headers.tar.gz
%CURRENT_PWD%/7za.exe rn %USERPROFILE%/.cmake-js/node-v${nodeVersion}-headers.tar  node-v${nodeVersion} v${nodeVersion}
%CURRENT_PWD%/7za.exe x -y -o%USERPROFILE%/.cmake-js/node-ia32 %USERPROFILE%/.cmake-js/node-v${nodeVersion}-headers.tar
%CURRENT_PWD%/7za.exe x -y -o%USERPROFILE%/.cmake-js/node-x64 %USERPROFILE%/.cmake-js/node-v${nodeVersion}-headers.tar
%CURRENT_PWD%/7za.exe x -y -o%USERPROFILE% cmake-js-cache.zip

del /Q /F %USERPROFILE%\\AppData\\Local\\node-gyp\\Cache\\node-v${nodeVersion}-headers.tar
del /Q /F %USERPROFILE%\\.cmake-js\\node-v${nodeVersion}-headers.tar

call node -v
call node-gyp -v
call cmake-js --version

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
HOME_PWD=~
INSTALL_PWD=~/software

chmod +x $CURRENT_PWD/7za

echo '1. install Node.js v${nodeVersion} ${arch}'
mkdir -p $INSTALL_PWD
sudo rm -rf $INSTALL_PWD/node-v${nodeVersion}-linux-${arch}
$CURRENT_PWD/7za x -y -o$INSTALL_PWD node-v${nodeVersion}-linux-${arch}.tar.gz
$CURRENT_PWD/7za x -y -o$INSTALL_PWD $INSTALL_PWD/node-v${nodeVersion}-linux-${arch}.tar
rm -rf $INSTALL_PWD/node-v${nodeVersion}-linux-${arch}.tar

echo '2. install node-gyp for Node.js v${nodeVersion} ${arch}'
$CURRENT_PWD/7za x -y -o$INSTALL_PWD/node-v${nodeVersion}-linux-${arch} node-gyp-module.zip
chmod +x $INSTALL_PWD/node-v${nodeVersion}-linux-${arch}/lib/node_modules/node-gyp/bin/node-gyp.js
ln -sb $INSTALL_PWD/node-v${nodeVersion}-linux-${arch}/lib/node_modules/node-gyp/bin/node-gyp.js $INSTALL_PWD/node-v${nodeVersion}-linux-${arch}/bin/node-gyp
chmod +x $INSTALL_PWD/node-v${nodeVersion}-linux-${arch}/lib/node_modules/cmake-js/bin/cmake-js
ln -sb $INSTALL_PWD/node-v${nodeVersion}-linux-${arch}/lib/node_modules/cmake-js/bin/cmake-js $INSTALL_PWD/node-v${nodeVersion}-linux-${arch}/bin/cmake-js
sudo ln -sb $INSTALL_PWD/node-v${nodeVersion}-linux-${arch}/bin/* /usr/local/bin/

echo '3. install node-gyp depend'
$CURRENT_PWD/7za x -y -o$HOME_PWD/.cache/node-gyp node-v${nodeVersion}-headers.tar.gz
$CURRENT_PWD/7za rn $HOME_PWD/.cache/node-gyp/node-v${nodeVersion}-headers.tar node-v${nodeVersion} ${nodeVersion}
$CURRENT_PWD/7za x -y -o$HOME_PWD/.cache/node-gyp/ $HOME_PWD/.cache/node-gyp/node-v${nodeVersion}-headers.tar
echo 9 > $HOME_PWD/.cache/node-gyp/${nodeVersion}/installVersion

echo '4. install cmake-js depend'
$CURRENT_PWD/7za x -y -o$HOME_PWD/.cmake-js node-v${nodeVersion}-headers.tar.gz
$CURRENT_PWD/7za rn $HOME_PWD/.cmake-js/node-v${nodeVersion}-headers.tar  node-v${nodeVersion} v${nodeVersion}
$CURRENT_PWD/7za x -y -o$HOME_PWD/.cmake-js/node-ia32 $HOME_PWD/.cmake-js/node-v${nodeVersion}-headers.tar
$CURRENT_PWD/7za x -y -o$HOME_PWD/.cmake-js/node-x64 $HOME_PWD/.cmake-js/node-v${nodeVersion}-headers.tar

rm -rf $HOME_PWD/.cache/node-gyp/node-v${nodeVersion}-headers.tar
rm -rf $HOME_PWD/.cmake-js/node-v${nodeVersion}-headers.tar

node -v
node-gyp -v
cmake-js --version
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