'use strict';

let addon = undefined;
try {
    addon = require('./build/Debug/addon.node');
} catch (error) {
    addon = require('./build/Release/addon.node');
}

console.log(addon.hello()); // 'hello world'
