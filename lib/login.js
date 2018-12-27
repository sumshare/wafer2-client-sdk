var utils = require('./utils');
var constants = require('./constants');
var Session = require('./session');

/***
 * @class
 * 表示登录过程中发生的异常
 */
var LoginError = (function() {
    function LoginError(type, message) {
        Error.call(this, message);
        this.type = type;
        this.message = message;
    }

    LoginError.prototype = new Error();
    LoginError.prototype.constructor = LoginError;

    return LoginError;
})();

/**
 * 微信登录，获取 code 和 encryptData
 */
// function (wxLoginError, wxLoginResult){}就是传入的callback
var getWxLoginResult = function getLoginCode(callback) {
    // 参数是doLogin传入的回调函数
    // 调用栈应当是login=>doLogin=>getWxLoginResult=>wx.login
    // 真正的核心登录在这里
    // 小程序核心开放API
    // wx.login
    // success返回errMsg和code
    wx.login({
        success: function(loginResult) {
            // 获取用户信息
            wx.getUserInfo({
                // 成功是调用传入的回调函数
                // 包装wxLoginResult 
                success: function(userResult) {
                    // 讲道理要设置withCredentials
                    // 可根据请求头分析，的确拿到了敏感数据
                    // 根据实验，login之后调用getUserInfo拿到敏感数据
                    // login调用之后，5分钟内单独调用getUserInfo拿到敏感数据
                    // 
                    // 唯一的解释是withCredentials默认值是true，API文档未做说明
                    // 总之，经过实验，这样是能拿到敏感数据的
                    callback(null, {
                        code: loginResult.code,
                        // 对称加密的敏感数据，解密算法https://mp.weixin.qq.com/debug/wxadoc/dev/api/signature.html
                        encryptedData: userResult.encryptedData,
                        // 加密算法的初始向量
                        iv: userResult.iv,
                        userInfo: userResult.userInfo,
                    });
                },
                // 获取用户信息失败
                fail: function(userError) {
                    var error = new LoginError(constants.ERR_WX_GET_USER_INFO, '获取微信用户信息失败，请检查网络状态');
                    error.detail = userError;
                    callback(error, null);
                },
            });
        },
        // 登录失败
        fail: function(loginError) {
            var error = new LoginError(constants.ERR_WX_LOGIN_FAILED, '微信登录失败，请检查网络状态');
            error.detail = loginError;
            callback(error, null);
        },
    });
};

var noop = function noop() {};
var defaultOptions = {
    method: 'GET',
    success: noop,
    fail: noop,
    loginUrl: null,
};

/**
 * @method
 * 进行服务器登录，以获得登录会话
 *
 * @param {Object} options 登录配置
 * @param {string} options.loginUrl 登录使用的 URL，服务器应该在这个 URL 上处理登录请求
 * @param {string} [options.method] 请求使用的 HTTP 方法，默认为 "GET"
 * @param {Function} options.success(userInfo) 登录成功后的回调函数，参数 userInfo 微信用户信息
 * @param {Function} options.fail(error) 登录失败后的回调函数，参数 error 错误信息
 */
var login = function login(options) {
    // options大致为两个回调函数
    // 从小程序demo来看，调用login传入的是success,fail两个回调方法

    // var noop = function noop() {};
    // 这是options的数据结构
    // var defaultOptions = {
    //     method: 'GET',
    //     success: noop,
    //     fail: noop,
    //     loginUrl: null,
    // };
    options = utils.extend({}, defaultOptions, options);
    // 在小程序启动运行时就会调用一次setLoginUrl
    // 从而设置defaultOptions.loginUrl的值
    // setLoginUrl将从配置文件获取的相关信息设置好 loginUrl: `${host}/weapp/login`,
    // 一般不会出现不存在defaultOptions.loginUrl的情况
    if (!defaultOptions.loginUrl) {
        options.fail(new LoginError(constants.ERR_INVALID_PARAMS, '登录错误：缺少登录地址，请通过 setLoginUrl() 方法设置登录地址'));
        return;
    }

    var doLogin = () => getWxLoginResult(function(wxLoginError, wxLoginResult) {
        // 这里以成功通过接口，获取用户信息为主
        // wxLoginError正常情况为null
        if (wxLoginError) {
            options.fail(wxLoginError);
            return;
        }
        // wxLoginResult的正确返回说明
        // {
        //     code: loginResult.code,
        //     encryptedData: userResult.encryptedData,
        //     iv: userResult.iv,
        //     userInfo: userResult.userInfo,
        // }

        var userInfo = wxLoginResult.userInfo;

        // 构造请求头，包含 code、encryptedData 和 iv
        var code = wxLoginResult.code;
        var encryptedData = wxLoginResult.encryptedData;
        var iv = wxLoginResult.iv;
        var header = {};
        // 构建请求头
        // 直观给出
        /*
            WX_HEADER_CODE: 'X-WX-Code',
            WX_HEADER_ENCRYPTED_DATA: 'X-WX-Encrypted-Data',
            WX_HEADER_IV: 'X-WX-IV',
        */
        header[constants.WX_HEADER_CODE] = code;
        header[constants.WX_HEADER_ENCRYPTED_DATA] = encryptedData;
        header[constants.WX_HEADER_IV] = iv;

        // 由于还需要在后端数据库留下登录状态及相关信息，所以搞定前端之后，还得处理后端

        // 请求服务器登录地址，获得会话信息
        // 前后端真正的连接节点
        // 这里真正发送了请求，node 端所需要的code 都可以在这里体现
        wx.request({
            url: options.loginUrl,
            header: header,
            method: options.method,
            data: options.data,
            success: function(result) {
                // 这里需要查阅工程本身后端接口文档
                // 回到qucikstart demo去查阅
                var data = result.data;

                // 成功地响应会话信息
                if (data && data.code === 0 && data.data.skey) {
                    var res = data.data
                    if (res.userinfo) {
                        Session.set(res.skey);
                        options.success(userInfo);
                    } else {
                        var errorMessage = '登录失败(' + data.error + ')：' + (data.message || '未知错误');
                        var noSessionError = new LoginError(constants.ERR_LOGIN_SESSION_NOT_RECEIVED, errorMessage);
                        options.fail(noSessionError);
                    }

                    // 没有正确响应会话信息
                } else {
                    var errorMessage = '登录请求没有包含会话响应，请确保服务器处理 `' + options.loginUrl + '` 的时候正确使用了 SDK 输出登录结果';
                    var noSessionError = new LoginError(constants.ERR_LOGIN_SESSION_NOT_RECEIVED, errorMessage);
                    options.fail(noSessionError);
                }
            },

            // 响应错误
            fail: function(loginResponseError) {
                var error = new LoginError(constants.ERR_LOGIN_FAILED, '登录失败，可能是网络错误或者服务器发生异常');
                options.fail(error);
            },
        });
    });

    // 登录核心逻辑
    // 如果存在session信息则调用options中的回调方法把用户信息作为参数传过去
    // 否则的话调用登录函数

    var session = Session.get();
    if (session) {
        // session数据存在也要检查登录状态时效性
        wx.checkSession({
            success: function() {
                options.success(session.userInfo);
            },

            fail: function() {
                Session.clear();
                doLogin();
            },
        });
    } else {
        doLogin();
    }
};

var setLoginUrl = function(loginUrl) {
    defaultOptions.loginUrl = loginUrl;
};

module.exports = {
    LoginError: LoginError,
    login: login,
    setLoginUrl: setLoginUrl,
};