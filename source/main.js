var SmileSoft = global.SmileSoft || {};
var options = require('./options');
var api = require('./api');

SmileSoft[options.moduleName] = api;

module.exports = SmileSoft;