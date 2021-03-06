'use strict';

const is = require('is-type-of');
const assert = require('assert');
const getReady = require('get-ready');
const { Ready } = require('ready-callback');
const { EventEmitter } = require('events');
const debug = require('debug')('egg-core:lifecycle');
const INIT = Symbol('Lifycycle#init');
const INIT_READY = Symbol('Lifecycle#initReady');
const DELEGATE_READY_EVENT = Symbol('Lifecycle#delegateReadyEvent');
const REGISTER_READY_CALLBACK = Symbol('Lifecycle#registerReadyCallback');
const CLOSE_SET = Symbol('Lifecycle#closeSet');
const IS_CLOSED = Symbol('Lifecycle#isClosed');
const BOOT_HOOKS = Symbol('Lifecycle#bootHooks');
const BOOTS = Symbol('Lifecycle#boots');

const utils = require('./utils');

class Lifecycle extends EventEmitter {

    /**
     * @param {object} options - options
     * @param {String} options.baseDir - the directory of application
     * @param {EggCore} options.app - Application instance
     * @param {Logger} options.logger - logger
     */
    constructor(options) {
        super();
        this.options = options;
        this[BOOT_HOOKS] = []; // 是钩子类的定义，不是执行态
        this[BOOTS] = []; // 是实例化后的对象，可直接调用
        this[CLOSE_SET] = new Set();
        this[IS_CLOSED] = false;
        this[INIT] = false;
        getReady.mixin(this); //自生的ready回调，和new Ready的区分开

        this.timing.start('Application Start');
        // get app timeout from env or use default timeout 10 second
        const eggReadyTimeoutEnv = Number.parseInt(process.env.EGG_READY_TIMEOUT_ENV || 10000);
        assert(
            Number.isInteger(eggReadyTimeoutEnv),
            `process.env.EGG_READY_TIMEOUT_ENV ${process.env.EGG_READY_TIMEOUT_ENV} should be able to parseInt.`);
        this.readyTimeout = eggReadyTimeoutEnv;

        // 初始化了两个加载器，等待注册的loader、和boot完成
        this[INIT_READY]();
        this
            .on('ready_stat', data => {
                this.logger.info('[egg:core:ready_stat] end ready task %s, remain %j', data.id, data.remain);
            })
            .on('ready_timeout', id => {
                this.logger.warn('[egg:core:ready_timeout] %s seconds later %s was still unable to finish.', this.readyTimeout / 1000, id);
            });

        this.ready(err => {
            this.triggerDidReady(err);
            this.timing.end('Application Start');
        });
    }

    get app() {
        return this.options.app;
    }

    get logger() {
        return this.options.logger;
    }

    get timing() {
        return this.app.timing;
    }

    //注册一个加载项，返回的是一个done函数，done执行就相当于这个加载项完成了
    // 2020-11-05 17:07:28 给外部暴漏loadReady收集异步调用的依赖
    legacyReadyCallback(name, opt) {
        return this.loadReady.readyCallback(name, opt);
    }

    // hook需要是一个class
    addBootHook(hook) {
        assert(this[INIT] === false, 'do not add hook when lifecycle has been initialized');
        this[BOOT_HOOKS].push(hook);
    }

    addFunctionAsBootHook(hook) {
        assert(this[INIT] === false, 'do not add hook when lifecycle has been initialized');
        // app.js is exported as a function
        // call this function in configDidLoad
        this[BOOT_HOOKS].push(class Hook {
            constructor(app) {
                this.app = app;
            }
            configDidLoad() {
                hook(this.app);
            }
        });
    }

    /**
     * init boots and trigger config did config
     */
    init() {
        assert(this[INIT] === false, 'lifecycle have been init');
        this[INIT] = true;
        // 使用hooks数组转换了一下
        // 2020年11月04日11:02:47 实例化了Class，并且传入了app实例
        this[BOOTS] = this[BOOT_HOOKS].map(t => new t(this.app));
    }

    // 在loader的加载器上注册一个加载项，scope有什么用，还不知道
    registerBeforeStart(scope) {
        this[REGISTER_READY_CALLBACK]({
            scope,
            ready: this.loadReady,
            timingKeyPrefix: 'Before Start',
        });
    }

    // 2020-11-04 11:10:20 注册关闭前的回调
    registerBeforeClose(fn) {
        assert(is.function(fn), 'argument should be function');
        assert(this[IS_CLOSED] === false, 'app has been closed');
        //是一个set对象，this[CLOSE_SET] = new Set();
        this[CLOSE_SET].add(fn);
    }

    // 2020-11-04 11:12:14 处理关闭，例如上面registerBeforeClose注册的回调
    async close() {
        // close in reverse order: first created, last closed
        //Set对象可以保证add进去的顺序？
        const closeFns = Array.from(this[CLOSE_SET]);
        for (const fn of closeFns.reverse()) {
            await utils.callFn(fn);
            this[CLOSE_SET].delete(fn);
        }
        // Be called after other close callbacks
        this.app.emit('close');
        this.removeAllListeners();
        this.app.removeAllListeners();
        this[IS_CLOSED] = true;
    }

    // 2020-11-04 11:27:45 触发配置即将加载的钩子吗？但接着就触发了配置已经加载的钩子，不太明白
    // 2020-11-04 16:32:21 custom.js 里面触发了这个调用
    triggerConfigWillLoad() {
        for (const boot of this[BOOTS]) {
            if (boot.configWillLoad) {
                boot.configWillLoad();
            }
        }
        this.triggerConfigDidLoad();
    }

    triggerConfigDidLoad() {
        for (const boot of this[BOOTS]) {
            if (boot.configDidLoad) {
                boot.configDidLoad(); // 在egg源码目录下的 agent.js 里面定义的Class，有实现这个方法
            }
            // function boot hook register after configDidLoad trigger
            // 2020-11-04 11:30:18 这个里面还有注册关闭前的钩子
            const beforeClose = boot.beforeClose && boot.beforeClose.bind(boot);
            if (beforeClose) {
                this.registerBeforeClose(beforeClose);
            }
        }
        this.triggerDidLoad();
    }

    // 2020-11-04 11:39:36 看不懂，因为调用了REGISTER_READY_CALLBACK
    // 2020-11-06 21:09:16 基本明白了，这个钩子在插件开发中经常用
    triggerDidLoad() {
        debug('register didLoad');
        for (const boot of this[BOOTS]) {
            const didLoad = boot.didLoad && boot.didLoad.bind(boot);
            if (didLoad) {
                this[REGISTER_READY_CALLBACK]({
                    scope: didLoad,
                    ready: this.loadReady,
                    timingKeyPrefix: 'Did Load',
                    scopeFullName: boot.fullPath + ':didLoad',
                });
            }
        }
    }

    triggerWillReady() {
        debug('register willReady');
        //start函数，如果没有注册的回调会立即执行 this.bootReady.ready(true)
        //猜测这里调用一次start，可能是因为triggerWillReady会多次调用，主动触发一次，是的之前的调用生效
        this.bootReady.start();
        for (const boot of this[BOOTS]) {
            const willReady = boot.willReady && boot.willReady.bind(boot);
            if (willReady) {
                this[REGISTER_READY_CALLBACK]({
                    scope: willReady,
                    ready: this.bootReady,
                    timingKeyPrefix: 'Will Ready',
                    scopeFullName: boot.fullPath + ':willReady',
                });
            }
        }
    }

    // 2020-11-04 11:44:39 触发didReady事件，很简单
    triggerDidReady(err) {
        debug('trigger didReady');

        // 同步等待
        (async() => {
            for (const boot of this[BOOTS]) {
                if (boot.didReady) {
                    try {
                        await boot.didReady(err);
                    } catch (e) {
                        this.emit('error', e);
                    }
                }
            }
            debug('trigger didReady done');
        })();
    }

    // 2020-11-04 11:44:33 触发serverDidReady事件，很简单；但没有找到哪里调用过这个
    // 2020-11-05 16:32:49 在egg源码目录egg.js里面，调用了。this.messenger.once('egg-ready',)触发就会调用
    triggerServerDidReady() {
        (async() => {
            for (const boot of this[BOOTS]) {
                try {
                    await utils.callFn(boot.serverDidReady, null, boot);
                } catch (e) {
                    this.emit('error', e);
                }
            }
        })();
    }

    // 初始化了2个ready实例，分别用于计数加载
    [INIT_READY]() {
        // 这个Ready相当于一个计数器，readyCallback会+1，done一下-1
        // 用于loader的加载器
        this.loadReady = new Ready({ timeout: this.readyTimeout });
        this[DELEGATE_READY_EVENT](this.loadReady);
        this.loadReady.ready(err => {
            debug('didLoad done');
            if (err) {
                this.ready(err);
            } else {
                this.triggerWillReady();
            }
        });

        //用于启动的加载器
        this.bootReady = new Ready({ timeout: this.readyTimeout, lazyStart: true });
        this[DELEGATE_READY_EVENT](this.bootReady);
        this.bootReady.ready(err => {
            this.ready(err || true);
        });
    }

    [DELEGATE_READY_EVENT](ready) {
        ready.once('error', err => ready.ready(err));
        ready.on('ready_timeout', id => this.emit('ready_timeout', id));
        ready.on('ready_stat', data => this.emit('ready_stat', data));
        ready.on('error', err => this.emit('error', err));
    }

    // scope是一个绑定了执行作用域的函数，等待异步执行
    [REGISTER_READY_CALLBACK]({ scope, ready, timingKeyPrefix, scopeFullName }) {
        if (!is.function(scope)) {
            throw new Error('boot only support function');
        }

        // get filename from stack if scopeFullName is undefined
        const name = scopeFullName || utils.getCalleeFromStack(true, 4); // didLoad or willReady
        const timingkey = `${timingKeyPrefix} in ` + utils.getResolvedFilename(name, this.app.baseDir);

        this.timing.start(timingkey);

        // 每调用一次，就加了一个依赖
        const done = ready.readyCallback(name);

        // ensure scope executes after load completed
        process.nextTick(() => {
            utils.callFn(scope).then(() => {
                done();
                this.timing.end(timingkey);
            }, err => {
                done(err);
                this.timing.end(timingkey);
            });
        });
    }
}

module.exports = Lifecycle;