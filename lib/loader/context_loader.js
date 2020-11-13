'use strict';

const assert = require('assert');
const is = require('is-type-of');
const FileLoader = require('./file_loader');
const CLASSLOADER = Symbol('classLoader');
const EXPORTS = FileLoader.EXPORTS;

class ClassLoader {

    // 输入：options.properties = { user: UserServiceClass, faq.task: FaqServiceClass}
    // 输出：new ClassLoader({ ctx, properties }) = { user: new UserServiceClass(), faq.task: new FaqServiceClass()}
    // 这里需要特别注意_cache的使用，原因是ClassLoader实例是以define的get方法来访问的，多次访问同样的属性，需要返回同一个实例
    constructor(options) {
        assert(options.ctx, 'options.ctx is required');
        const properties = options.properties;
        this._cache = new Map();
        this._ctx = options.ctx;

        for (const property in properties) {
            this.defineProperty(property, properties[property]);
        }
    }

    // 对这个类的实例，定义properties包含的相同属性，其实是实例化的过程
    defineProperty(property, values) {
        Object.defineProperty(this, property, {
            get() {
                let instance = this._cache.get(property);
                if (!instance) {
                    instance = getInstance(values, this._ctx);
                    this._cache.set(property, instance);
                }
                return instance;
            },
        });
    }
}

/**
 * Same as {@link FileLoader}, but it will attach file to `inject[fieldClass]`. The exports will be lazy loaded, such as `ctx.group.repository`.
 * @extends FileLoader
 * @since 1.0.0
 */
class ContextLoader extends FileLoader {

    /**
     * @class
     * @param {Object} options - options same as {@link FileLoader}
     * @param {String} options.fieldClass - determine the field name of inject object.
     */
    constructor(options) {
        assert(options.property, 'options.property is required');
        assert(options.inject, 'options.inject is required');
        // 2020-11-08 13:09:40 最开始target是空的，这个在file_loader里面使用：会把所有加载到的代码定义，存放到target上。
        const target = options.target = {};
        if (options.fieldClass) {
            options.inject[options.fieldClass] = target;
        }
        super(options);

        const app = this.options.inject;
        const property = options.property;

        // define ctx.service
        // app.context 属性是koa里面原生的，是每次处理一个http请求，新建ctx的父类
        // 假如property是service，那么就是app.context.service
        Object.defineProperty(app.context, property, {
            // 下面get里面执行的代码，上下文是context，this也是指向context
            get() {
                // distinguish property cache,
                // cache's lifecycle is the same with this context instance
                // e.x. ctx.service1 and ctx.service2 have different cache
                // 每次处理http请求，context都是新建的，所以这个缓存是针对单次会话有效
                // 也就是每一次会话，都会实例化一遍target所export的类或者方法！！！
                // 例如一次回话，会多次调用ctx.service.user, ctx.service.other，这样会命中缓存
                if (!this[CLASSLOADER]) {
                    // 2020-11-08 13:14:20 不光会缓存service，其他在context上面load的属性都会用这个缓存
                    this[CLASSLOADER] = new Map();
                }
                const classLoader = this[CLASSLOADER];

                let instance = classLoader.get(property);
                if (!instance) {
                    /**
                     * target = { user: UserServiceClass, faq.task: FaqServiceClass}
                     */
                    instance = getInstance(target, this); //this 指向 app.context
                    classLoader.set(property, instance);
                }
                return instance;
            },
        });
    }
}

module.exports = ContextLoader;


function getInstance(values, ctx) {
    // it's a directory when it has no exports
    // then use ClassLoader
    const Class = values[EXPORTS] ? values : null;
    let instance;
    if (Class) {
        if (is.class(Class)) {
            instance = new Class(ctx); //实例化，非常关键的信息
        } else {
            // it's just an object
            instance = Class;
        }
        // Can't set property to primitive, so check again
        // e.x. module.exports = 1;
    } else if (is.primitive(values)) {
        instance = values;
    } else {
        instance = new ClassLoader({ ctx, properties: values });
    }
    return instance;
}