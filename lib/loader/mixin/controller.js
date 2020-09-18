'use strict';

const path = require('path');
const is = require('is-type-of');
const utility = require('utility');
const utils = require('../../utils');
const FULLPATH = require('../file_loader').FULLPATH;


module.exports = {

    /**
     * Load app/controller
     * @param {Object} opt - LoaderOptions
     * @since 1.0.0
     */
    loadController(opt) {
        this.timing.start('Load Controller');
        opt = Object.assign({
            caseStyle: 'lower',
            directory: path.join(this.options.baseDir, 'app/controller'),
            // 下面这个回调会在file_loader -> getExports里面使用，用于实例化
            initializer: (obj, opt) => {
                if (is.function(obj) && !is.generatorFunction(obj) && !is.class(obj) && !is.asyncFunction(obj)) {
                    obj = obj(this.app);
                }
                if (is.class(obj)) {
                    obj.prototype.pathName = opt.pathName;
                    obj.prototype.fullPath = opt.path;
                    return wrapClass(obj);
                }
                if (is.object(obj)) {
                    return wrapObject(obj, opt.path);
                }
                // support generatorFunction for forward compatbility
                if (is.generatorFunction(obj) || is.asyncFunction(obj)) {
                    return wrapObject({ 'module.exports': obj }, opt.path)['module.exports'];

                }
                return obj;
            },
        }, opt);
        const controllerBase = opt.directory;

        this.loadToApp(controllerBase, 'controller', opt);
        this.options.logger.info('[egg:loader] Controller loaded: %s', controllerBase);
        this.timing.end('Load Controller');
    },

};

// wrap the class, yield a object with middlewares
function wrapClass(Controller) {
    let proto = Controller.prototype;
    const ret = {};
    // tracing the prototype chain
    while (proto !== Object.prototype) {
        const keys = Object.getOwnPropertyNames(proto);
        for (const key of keys) {
            // getOwnPropertyNames will return constructor
            // that should be ignored
            if (key === 'constructor') {
                continue;
            }
            // skip getter, setter & non-function properties
            const d = Object.getOwnPropertyDescriptor(proto, key);
            // prevent to override sub method
            if (is.function(d.value) && !ret.hasOwnProperty(key)) {
                // 这里的起名说明问题，一个Control的方法属性就是一个中间件，所以把Control里面的方法都转换掉
                // 到最后是一个Control转成了一个Object，这个Object里面包含了Control的所有方法属性；
                // 对于转换后的Object的方法属性methodA，其实等同于调用new Control().methodA()
                // 也就说明：每次处理get/post的方法，都会new一个Control
                ret[key] = methodToMiddleware(Controller, key);
                ret[key][FULLPATH] = Controller.prototype.fullPath + '#' + Controller.name + '.' + key + '()';
            }
        }
        proto = Object.getPrototypeOf(proto);
    }
    return ret;

    // 看了Contorl的loader，会使用这个函数；本质上路由哪里注册的函数就是下面这个函数包装的
    function methodToMiddleware(Controller, key) {
        return function classControllerMiddleware(...args) {
            const controller = new Controller(this);
            if (!this.app.config.controller || !this.app.config.controller.supportParams) {
                args = [this];
            }
            return utils.callFn(controller[key], args, controller);
        };
    }
}

// wrap the method of the object, method can receive ctx as it's first argument
function wrapObject(obj, path, prefix) {
    const keys = Object.keys(obj);
    const ret = {};
    for (const key of keys) {
        if (is.function(obj[key])) {
            const names = utility.getParamNames(obj[key]);
            if (names[0] === 'next') {
                throw new Error(`controller \`${prefix || ''}${key}\` should not use next as argument from file ${path}`);
            }
            ret[key] = functionToMiddleware(obj[key]);
            ret[key][FULLPATH] = `${path}#${prefix || ''}${key}()`;
        } else if (is.object(obj[key])) {
            ret[key] = wrapObject(obj[key], path, `${prefix || ''}${key}.`);
        }
    }
    return ret;

    function functionToMiddleware(func) {
        const objectControllerMiddleware = async function(...args) {
            if (!this.app.config.controller || !this.app.config.controller.supportParams) {
                args = [this];
            }
            return await utils.callFn(func, args, this);
        };
        for (const key in func) {
            objectControllerMiddleware[key] = func[key];
        }
        return objectControllerMiddleware;
    }
}