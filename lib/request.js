var constants = require('./constants');
var utils = require('./utils');
var Session = require('./session');
var loginLib = require('./login');

var noop = function noop() {};

var buildAuthHeader = function buildAuthHeader(session) {
    var header = {};

    if (session) {
        // 就是X-WX-Skey
        header[constants.WX_HEADER_SKEY] = session;
    }

    return header;
};

/***
 * @class
 * 表示请求过程中发生的异常
 */
var RequestError = (function () {
    function RequestError(type, message) {
        Error.call(this, message);
        this.type = type;
        this.message = message;
    }

    RequestError.prototype = new Error();
    RequestError.prototype.constructor = RequestError;

    return RequestError;
})();
// 非常常用的request方法
function request(options) {
    // options包含{url:login:success，fail}
    if (typeof options !== 'object') {
        var message = '请求传参应为 object 类型，但实际传了 ' + (typeof options) + ' 类型';
        throw new RequestError(constants.ERR_INVALID_PARAMS, message);
    }
    // 从参数里获取是否需要登录才能请求
    var requireLogin = options.login;
    var success = options.success || noop;
    var fail = options.fail || noop;
    var complete = options.complete || noop;
    var originHeader = options.header || {};

    // 成功回调
    var callSuccess = function () {
        // 一般而言就是传入的回调函数options.success
        // 这种写法是为了省略形参
        success.apply(null, arguments);
        complete.apply(null, arguments);
    };

    // 失败回调
    var callFail = function (error) {
        fail.call(null, error);
        complete.call(null, error);
    };

    // 是否已经进行过重试
    var hasRetried = false;
    // 如果需要邓丽
    if (requireLogin) {
        doRequestWithLogin();
    } else {
        doRequest();
    }

    // 登录后再请求
    function doRequestWithLogin() {
        // 无非是先调用封装好登录的方法，成功了再去请求，核心还是wx.request
        loginLib.login({ success: doRequest, fail: callFail });
    }

    // 实际进行请求的方法
    // 核心请求方法
    function doRequest() {
        // wx.session获取session信息构建请求头
        var authHeader = buildAuthHeader(Session.get());
        // 合并参数，options 包含外界传来的参数及回调等
        wx.request(utils.extend({}, options, {
            header: utils.extend({}, originHeader, authHeader),

            success: function (response) {
                var data = response.data;

                var error, message;
                if (data && data.code === -1) {
                    Session.clear();
                    // 如果是登录态无效，并且还没重试过，会尝试登录后刷新凭据重新请求
                    if (!hasRetried) {
                        hasRetried = true;
                        doRequestWithLogin();
                        return;
                    }

                    message = '登录态已过期';
                    error = new RequestError(data.error, message);

                    callFail(error);
                    return;
                } else {
                    // 把response传递过去，省略形参的一种写法
                    callSuccess.apply(null, arguments);
                }
            },

            fail: callFail,
            complete: noop,
        }));
    };

};

module.exports = {
    RequestError: RequestError,
    request: request,
};