'use strict';

const Application = require('../../egg-core').EggCore;

const app = new Application({
    baseDir: '../explore'
});

//app.beforeStart(() => { console.log('app.beforeStart') })

app.ready(() => app.listen(3000));