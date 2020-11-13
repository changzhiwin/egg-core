'use strict';

const path = require('path');


module.exports = {

    /**
     * Load app/service
     * @function EggLoader#loadService
     * @param {Object} opt - LoaderOptions
     * @since 1.0.0
     */
    loadService(opt) {
        this.timing.start('Load Service');
        // 载入到 app.serviceClasses
        opt = Object.assign({
            call: true, // call这个配置，在FileLoader里面有用，用于如果export的是函数，那么就调用这个函数
            caseStyle: 'lower',
            fieldClass: 'serviceClasses',
            // getLoadUnits 这个函数返回所有egg框架链上的根路径，按照约定app/service就是定义service的位置
            directory: this.getLoadUnits().map(unit => path.join(unit.path, 'app/service')), // 这一句牛，相当于load了所有约定目录下的service
        }, opt);
        const servicePaths = opt.directory;
        this.loadToContext(servicePaths, 'service', opt);
        this.timing.end('Load Service');
    },

};