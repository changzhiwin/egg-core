'use strict';

const debug = require('debug')('egg-core:config');
const path = require('path');
const extend = require('extend2');
const assert = require('assert');
const { Console } = require('console');

const SET_CONFIG_META = Symbol('Loader#setConfigMeta');

module.exports = {

    /**
     * Load config/config.js
     *
     * Will merge config.default.js 和 config.${env}.js
     *
     * @function EggLoader#loadConfig
     * @since 1.0.0
     */
    loadConfig() {
        this.timing.start('Load Config');
        this.configMeta = {};

        const target = {};

        // Load Application config first
        // 最顶层app定义的配置
        // 这个app的配置，会被load两次，下面这个preload只是给注入到其他配置加载的
        const appConfig = this._preloadAppConfig();

        //   plugin config.default
        //     framework config.default
        //       app config.default
        //         plugin config.{env}
        //           framework config.{env}
        //             app config.{env}
        // 有两个配置文件：config.default/config.{dev}，先加载default，后加载{env}，因为后面的会覆盖前面的属性
        // filename = ['config.default', 'config.local']
        for (const filename of this.getTypeFiles('config')) {
            // getEggPath这个函数里面决定了framework的顺序
            for (const unit of this.getLoadUnits()) {
                const isApp = unit.type === 'app';
                // 提前加载到appConfig，是因为后面的配置会依赖 appConfig 里面的信息，生成其他配置信息
                const config = this._loadConfig(unit.path, filename, isApp ? undefined : appConfig, unit.type);

                if (!config) {
                    continue;
                }

                debug('Loaded config %s/%s, %j', unit.path, filename, config);
                extend(true, target, config);
            }
        }

        // You can manipulate the order of app.config.coreMiddleware and app.config.appMiddleware in app.js
        // （core/app）配置中定义的中间件数组
        target.coreMiddleware = target.coreMiddlewares = target.coreMiddleware || [];
        target.appMiddleware = target.appMiddlewares = target.middleware || [];

        this.config = target;
        this.timing.end('Load Config');
    },

    // 单独提前加载，为啥了？还不知道
    // 知道了，原因是需要先把app的信息当成后续 配置 的依赖，所以会把这个信息注入到其他config生成函数，当成参数
    _preloadAppConfig() {
        const names = [
            'config.default',
            `config.${this.serverEnv}`,
        ];
        const target = {};

        // 2020-10-26 16:30:24 这个前置加载只会查找运行目录下面的config文件夹
        // console.log('=======> this.options.baseDir = ', this.options.baseDir, JSON.stringify(names))
        for (const filename of names) {
            // 对于没有指定baseDir，其值是process.cwd()，在EggCore构造函数里面赋值的
            const config = this._loadConfig(this.options.baseDir, filename, undefined, 'app');
            extend(true, target, config);
        }
        return target;
    },

    _loadConfig(dirpath, filename, extraInject, type) {
        const isPlugin = type === 'plugin';
        const isApp = type === 'app';

        // 约定config文件都放在config目录下面
        let filepath = this.resolveModule(path.join(dirpath, 'config', filename));
        // let config.js compatible
        // 兼容处理，不用管
        if (filename === 'config.default' && !filepath) {
            filepath = this.resolveModule(path.join(dirpath, 'config/config'));
        }

        // 2020-10-26 16:36:02 有路径可能不存在的情况，可以直接返回 by me
        if (!filepath) return null;

        const config = this.loadFile(filepath, this.appInfo, extraInject);

        if (!config) return null;

        if (isPlugin || isApp) {
            // 在app、plugin里面不能定义coreMiddleware
            assert(!config.coreMiddleware, 'Can not define coreMiddleware in app or plugin');
        }
        if (!isApp) {
            // 不是在app也不能，重定义middleware
            assert(!config.middleware, 'Can not define middleware in ' + filepath);
        }

        // store config meta, check where is the property of config come from.
        this[SET_CONFIG_META](config, filepath);

        return config;
    },

    [SET_CONFIG_META](config, filepath) {
        // 从新拷贝了一份，因为下面setConfig会覆盖key
        config = extend(true, {}, config);
        setConfig(config, filepath);
        // 把这个信息，保存到全局的configMeta中，可能用于调试吧
        extend(true, this.configMeta, config);
    },
};

// 记录那个key是哪里文件里面定义的
function setConfig(obj, filepath) {
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        // ignore console
        if (key === 'console' && val && typeof val.Console === 'function' && val.Console === Console) {
            obj[key] = filepath;
            continue;
        }
        if (val && Object.getPrototypeOf(val) === Object.prototype && Object.keys(val).length > 0) {
            setConfig(val, filepath);
            continue;
        }
        obj[key] = filepath;
    }
}