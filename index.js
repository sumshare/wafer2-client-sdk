var constants = require('./lib/constants');
var login = require('./lib/login');
var Session = require('./lib/session');
var request = require('./lib/request');
var Tunnel = require('./lib/tunnel');
// 封装好的SDK
var exports = module.exports = {
    login: login.login,
    setLoginUrl: login.setLoginUrl,
    LoginError: login.LoginError,

    clearSession: Session.clear,

    request: request.request,
    RequestError: request.RequestError,

    Tunnel: Tunnel,
};

// 导出错误类型码
Object.keys(constants).forEach(function(key) {
    // 找到以ERR打头的
    if (key.indexOf('ERR_') === 0) {
        // 赋值
        exports[key] = constants[key];
    }
});