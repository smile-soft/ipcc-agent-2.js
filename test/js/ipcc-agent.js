(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.SmileSoft = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){

var WebRTC = require('./webrtc'),
events = require('./events'),
utils = require('./utils'),
// Modules's initiation options
options = require('./options'),
moduleName = options.moduleName,
// Current protocol
protocol = window.location.protocol.indexOf('https') !== -1 ? 'https' : 'http',
// Interval to request current client's state from the server
updateStateInterval,
// Websocket object
websocket,
websocketTry = 1,
initiated = false,
errormsg = '',
// Module's public api
api;

function on(sub, cb){
	events.on(sub, cb);
}

function emit(sub, params){
	events.emit(sub, params);
}

// Reconnection Exponential Backoff Algorithm
// http://blog.johnryding.com/post/78544969349/how-to-reconnect-web-sockets-in-a-realtime-web-app
function generateInterval (k) {
	var maxInterval = (Math.pow(2, k) - 1) * 1000;

	if (maxInterval > 30*1000) {
		// If the generated interval is more than 30 seconds, 
		// truncate it down to 30 seconds.
		maxInterval = 30*1000;
	}

	// Generate the interval to a random number 
	// between 0 and the maxInterval determined from above
	return Math.random() * maxInterval;
}

function callbackOnId(id, data){
    if(id === 5){
        if(data.state !== 0 && data.state !== 1 && data.state !== 6 && data.state !== 8){
            getProcess();
        }
        setState(data);
    }
    else if(id == 7){
        setProcess(data);
    }
}

function setStateRequestInterval(){
	updateStateInterval = setInterval(function(){
		getState();
	}, options.updateInterval);
}

function initWebsocketEvents(instance){
	instance.onopen = onWebsocketOpen;
	instance.onmessage = onWebsocketMessage;
	instance.onclose = onWebsocketClose;
	instance.onerror = onWebsocketError;
}

function onWebsocketOpen(){
    console.log('Websocket opened');
    emit('ready');
    getState();
}

function onWebsocketMessage(e){
    var data = JSON.parse(e.data),
        method = data.method;

    console.log('onWebsocketMessage data: ', data);

    if(data.error) {
		return emit('Error', { module: moduleName, error: data.error });
    }

    if(data.method){
        var params = data.params;
        if(method == 'setProcess'){
			setProcess(params);
        }
        else if(method == 'setState'){
			setState(params);
        }
    } else if(data.id){
		callbackOnId(data.id, data.result);
    }
}

function onWebsocketClose(){
    console.log('Websocket closed');
    if(options.websockets) {
		var time = generateInterval(websocketTry);
		setTimeout(function(){
			websocketTry++;
			init();
		}, time);
    }
}

function onWebsocketError(error){
	emit('Error', { module: moduleName, error: error });
}

/**
 * Init function
 * 
 * @param  none
 * @return none
 */
function init(){
	if(options.webrtc){
		console.log('Initiating WebRTC module');
		WebRTC.init({sip: options.sip, audioRemote: options.audioRemote});
	}
	if(!options.websockets){
		if(websocket !== undefined) websocket.close();
		console.log('Switched to XMLHttpRequest');
		setStateRequestInterval();
		emit('ready');
	} else{
		if(!window.WebSocket) {
			console.log('WebSocket is not supported. Please update your browser.');
			console.log('Fallback to XMLHttpRequest');
			options.websockets = false;
			return init();
		}

		console.log('Switched to Websockets');
		
		// Clear "getState" method request interval and switch to websockets
		if(updateStateInterval !== undefined) clearInterval(updateStateInterval);

		// Initiate Websocket handshake
		websocket = new WebSocket((protocol === 'https' ? 'wss' : 'ws') + '://'+options.server+'/','json.api.smile-soft.com');
		initWebsocketEvents(websocket);
	}
}

/**
 * Send request to the server via XMLHttpRequest or Websockets
 * @param  {String} method Server API method
 * @param  {Object} params Request parameters
 * @param  {Number} id     Callback id. Send from server to client via Websockets
 * @return {String}        Returns response from the server
 */
function sendRequest(method, params, callback){
	var jsonrpc = {}, xhr, parsedJSON, requestTimer, err = null;
	jsonrpc.method = method;

	if(params) jsonrpc.params = params;
	if(typeof callback === 'number') jsonrpc.id = callback;

	jsonrpc = JSON.stringify(jsonrpc);

	if(options.websockets)
		websocket.send(jsonrpc);
	else{
		xhr = new XMLHttpRequest();
		xhr.open("POST", protocol+'://'+options.server+"/", true);

		requestTimer = setTimeout(function(){
			xhr.abort();
		}, 30000);
		xhr.onreadystatechange = function() {
			if (xhr.readyState==4){
				clearTimeout(requestTimer);
				if(xhr.response) {
					parsedJSON = JSON.parse(xhr.response);
					if(parsedJSON.error) {
						err = parsedJSON.error;
						emit('Error', { module: moduleName, error:  err});
					}
					if(callback) {
						callback(parsedJSON.result);
					}
				}
			}
		};
		xhr.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');
		xhr.send(jsonrpc);
	}
}

/**
 * Get information of current process
 * List of process ids:
 * 1 - 'Incoming call'
 * 7 - 'Incoming chat'
 * 32 - 'Outgoing call'
 * 129 - 'Outgoing autodial'
 * 257 -  'Outgoing callback'
 * 
 * @return {Object} current process information
 */
function getProcess(){
	sendRequest('getProcess', null, (options.websockets ? 7 : setProcess));
}

/**
 * Get information of current client's state
 * Possible states:
 * 0 - 'Unregistered'
 * 1 - 'Pause'
 * 3 - 'Incoming call'
 * 4 - 'Outgoing call'
 * 5 - 'Connected with incomming call'
 * 6 - 'Wrap'
 * 7 - 'Generic task'
 * 8 - 'Idle'
 * 9 - 'Connected with outgoing call'
 * 
 * @return {Object} current client's state
 * 
 */
function getState(){
	sendRequest('getState', null, (options.websockets ? 5 : setState));
}

/**
 * State chage event received from the server
 */
function setState(stateInfo){
	emit('statechange', stateInfo);
}

/**
 * Current process information received from the server
 * @param {Object} processInfo process information
 * @return none
 */
function setProcess(processInfo){
	emit('processchange', processInfo);
}

/**
 * Module's initiation function that accepts initiation options
 * 
 * @param  {Object} opts module's initiation options
 * @return {Object}      [description]
 */
function client(opts){
	if(opts) options = utils.deepExtend(options, opts);
	if(initiated) return console.warn('Module '+moduleName+' already initiated, do nothing');
	console.log('Initiating '+options.moduleName+' module with options: ', options);
	init();
	initiated = true;
	return api;
}

api = {

	// Current process info
	process: {},

	// Current state
	state: null,

	// Current substate
	substate: null,

	// Event subscription function
	on: on,

	// Event emitting function
	emit: emit,

	/**
	 * Initiate outgoing call
	 * @param  {String} number telephone number to dial
	 * @return none
	 */
	call: function(number){
		if(options.webrtc) {
			WebRTC.audiocall(number);
		} else {
			sendRequest('initCall', { number: number });
		}
	},

	/**
	 * Answer to incoming call
	 * @return none
	 */
	answer: function(){
		// if(options.webrtc) {
		// 	WebRTC.answer();
		// } else {
			sendRequest('answerCall');
		// }
	},

	/**
	 * Press hold button
	 * @return none
	 */
	hold: function(){
		// if(options.webrtc) {
		// 	WebRTC.hold();
		// } else {
			sendRequest('pressHold');
		// }
	},

	/**
	 * Change agent's state to IDLE
	 * Could be called only if agent is either in WRAP or PAUSE states
	 * @return none
	 */
	idle: function(){
		if(api.state === 1 || api.state === 6) {
			sendRequest('setPauseState', { state: 0 });
		} else {
			console.log('Not in WRAP or PAUSE, do nothing.');
		}
	},

	/**
	 * Press conference button
	 * @return none
	 */
	conference: function(){
		sendRequest('pressConference');
	},

	/**
	 * Drop current call
	 * @return none
	 */
	drop: function(){
		if(options.webrtc) {
			WebRTC.terminate();
		} else {
			sendRequest('dropCall');
		}
	},

	/**
	 * Close current process with exit code
	 * @param  {String} processid process id
	 * @param  {Number} exitcode  exit code
	 * @return none
	 */
	close: function(processid, exitcode){
		errormsg = '';
		if(!processid) errormsg += 'processid is not defined\n';
		if(!exitcode) errormsg += 'exitcode is not defined\n';
		if(errormsg !== '') return console.error('Can\'t close process:\n' + errormsg);

		sendRequest('closeProcess', { processid: processid, exitcode: exitcode });
	},

	/**
	 * Set pause state
	 * Possible states:
	 * 0 - switch to IDLE state
	 * Any pause codes that were set in Admin Studio
	 * 
	 * @param {Number} state   pause state
	 * @param {String} comment comment string
	 * @return none
	 */
	pause: function(state, comment){
		sendRequest('setPauseState', { state: state, comment: comment || '' });
	}

};

on('statechange', function (params){
	api.state = params.state;
	api.substate = params.substate;
});

on('processchange', function (params){
	api.process = params;
});

module.exports = client;
},{"./events":2,"./options":4,"./utils":5,"./webrtc":6}],2:[function(require,module,exports){
var subs = {};
var hOP = subs.hasOwnProperty;

module.exports = {
	on: function(sub, listener) {
		// Create the subscription's object if not yet created
		if(!hOP.call(subs, sub)) subs[sub] = [];

		// Add the listener to queue
		var index = subs[sub].push(listener) -1;

		// Provide handle back for removal of subscription
		return {
			off: function() {
				delete subs[sub][index];
			}
		};
	},
	emit: function(sub, info) {
		// If the subscription doesn't exist, or there's no listeners in queue, just leave
		if(!hOP.call(subs, sub)) return;

		// Cycle through subscriptions queue, fire!
		subs[sub].forEach(function(item) {
			item(info !== undefined ? info : {});
		});
	}
};
},{}],3:[function(require,module,exports){
(function (global){
var SmileSoft = global.SmileSoft || {};
var options = require('./options');
var api = require('./api');

SmileSoft[options.moduleName] = api;

module.exports = SmileSoft;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./api":1,"./options":4}],4:[function(require,module,exports){
(function (global){
module.exports = {
	moduleName: 'Agent',
	// Server IP address or Domain name and server port (if other than 80/443)
	// Exp: 192.168.1.100:8880 or www.example.com
	server: global.location.host,
	updateInterval: 1000,
	websockets: true,
	webrtc: true,
	sip: {
		realm: global.location.host,
		ws_servers: 'wss://'+global.location.host,
		// authorization_user: '',
		// uri: '',
		// password: '',
		// display_name: '',
		register: true
	},
	audioRemote: null
};
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],5:[function(require,module,exports){

module.exports = {
	extendObj: extendObj,
	deepExtend: deepExtend
};

/**
 * Extend's object with properties
 * 
 * @return {Object} Merged objects
 */
function extendObj(target, source){
	var a = Object.create(target);
	Object.keys(source).map(function (prop) {
		prop in a && (a[prop] = source[prop]);
	});
	return a;
}

function deepExtend(destination, source) {
  for (var property in source) {
    if (source[property] && source[property].constructor &&
     source[property].constructor === Object) {
      destination[property] = destination[property] || {};
      arguments.callee(destination[property], source[property]);
    } else {
      destination[property] = source[property];
    }
  }
  return destination;
}
},{}],6:[function(require,module,exports){
(function (global){
var events = require('./events'),
JsSIP = global.JsSIP,
options,
sipClient,
sipSession,
sipCallEvents;

function isWebrtcSupported(){
	var RTC = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection,
		userMeida = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.msGetUserMedia || navigator.mozGetUserMedia,
		ice = window.mozRTCIceCandidate || window.RTCIceCandidate;

	return !!RTC && !!userMeida && !!ice;
}

function initJsSIPEvents(){
	sipClient.on('connected', function(e){ console.log('sip connected event: ', e); });
	sipClient.on('disconnected', function(e){ console.log('sip disconnected event: ', e); });
	sipClient.on('newMessage', function(e){ console.log('sip newMessage event: ', e); });
	sipClient.on('newRTCSession', function(e){
		console.log('sip newRTCSession event: ', e);
		sipSession = e.session;
	});
	sipClient.on('registered', function(e){ console.log('sip registered event: ', e); });
	sipClient.on('unregistered', function(e){ console.log('sip unregistered event: ', e); });
	sipClient.on('registrationFailed', function(e){ console.log('sip registrationFailed event: ', e); });

	sipCallEvents = {
		progress: function(e){
			console.log('call progress event: ', e);
			events.emit('call.progress', e);
		},
		failed: function(e){
			console.log('call failed event:', e);
			events.emit('call.failed', e);
		},
		ended: function(e){
			console.log('call ended event: ', e);
			events.emit('call.ended', e);
		},
		confirmed: function(e){
			console.log('call confirmed event: ', e);
			events.emit('call.confirmed', e);
		},
		addstream: function(e){
			console.log('call addstream event: ', e);
			var stream = e.stream;
			options.audioRemote = JsSIP.rtcninja.attachMediaStream(options.audioRemote, stream);
		}
	};
}

function audiocall(number){
	sipSession = sipClient.call(number, {
		eventHandlers: sipCallEvents,
		mediaConstraints: { audio: true, video: false }
	});
}

function terminate(){
	sipClient.terminateSessions();
}

function answer(){
	console.log('answer: ',sipClient);
	sipSession.answer();
}

function hold(){
	console.log('hold: ', sipSession.isOnHold());
	if(sipSession && sipSession.isOnHold().local) {
		sipSession.unhold();
	} else {
		sipSession.hold();
	}
}

function init(opts){
	options = opts;
	sipClient = new JsSIP.UA(options.sip);
	initJsSIPEvents();
	sipClient.start();
	return sipClient;
}

module.exports = {
	lib: JsSIP,
	init: init,
	audiocall: audiocall,
	terminate: terminate,
	answer: answer,
	hold: hold
};
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./events":2}]},{},[3])(3)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzb3VyY2UvYXBpLmpzIiwic291cmNlL2V2ZW50cy5qcyIsInNvdXJjZS9tYWluLmpzIiwic291cmNlL29wdGlvbnMuanMiLCJzb3VyY2UvdXRpbHMuanMiLCJzb3VyY2Uvd2VicnRjLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqWUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQzNCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7QUNOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ2xCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDOUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJcbnZhciBXZWJSVEMgPSByZXF1aXJlKCcuL3dlYnJ0YycpLFxuZXZlbnRzID0gcmVxdWlyZSgnLi9ldmVudHMnKSxcbnV0aWxzID0gcmVxdWlyZSgnLi91dGlscycpLFxuLy8gTW9kdWxlcydzIGluaXRpYXRpb24gb3B0aW9uc1xub3B0aW9ucyA9IHJlcXVpcmUoJy4vb3B0aW9ucycpLFxubW9kdWxlTmFtZSA9IG9wdGlvbnMubW9kdWxlTmFtZSxcbi8vIEN1cnJlbnQgcHJvdG9jb2xcbnByb3RvY29sID0gd2luZG93LmxvY2F0aW9uLnByb3RvY29sLmluZGV4T2YoJ2h0dHBzJykgIT09IC0xID8gJ2h0dHBzJyA6ICdodHRwJyxcbi8vIEludGVydmFsIHRvIHJlcXVlc3QgY3VycmVudCBjbGllbnQncyBzdGF0ZSBmcm9tIHRoZSBzZXJ2ZXJcbnVwZGF0ZVN0YXRlSW50ZXJ2YWwsXG4vLyBXZWJzb2NrZXQgb2JqZWN0XG53ZWJzb2NrZXQsXG53ZWJzb2NrZXRUcnkgPSAxLFxuaW5pdGlhdGVkID0gZmFsc2UsXG5lcnJvcm1zZyA9ICcnLFxuLy8gTW9kdWxlJ3MgcHVibGljIGFwaVxuYXBpO1xuXG5mdW5jdGlvbiBvbihzdWIsIGNiKXtcblx0ZXZlbnRzLm9uKHN1YiwgY2IpO1xufVxuXG5mdW5jdGlvbiBlbWl0KHN1YiwgcGFyYW1zKXtcblx0ZXZlbnRzLmVtaXQoc3ViLCBwYXJhbXMpO1xufVxuXG4vLyBSZWNvbm5lY3Rpb24gRXhwb25lbnRpYWwgQmFja29mZiBBbGdvcml0aG1cbi8vIGh0dHA6Ly9ibG9nLmpvaG5yeWRpbmcuY29tL3Bvc3QvNzg1NDQ5NjkzNDkvaG93LXRvLXJlY29ubmVjdC13ZWItc29ja2V0cy1pbi1hLXJlYWx0aW1lLXdlYi1hcHBcbmZ1bmN0aW9uIGdlbmVyYXRlSW50ZXJ2YWwgKGspIHtcblx0dmFyIG1heEludGVydmFsID0gKE1hdGgucG93KDIsIGspIC0gMSkgKiAxMDAwO1xuXG5cdGlmIChtYXhJbnRlcnZhbCA+IDMwKjEwMDApIHtcblx0XHQvLyBJZiB0aGUgZ2VuZXJhdGVkIGludGVydmFsIGlzIG1vcmUgdGhhbiAzMCBzZWNvbmRzLCBcblx0XHQvLyB0cnVuY2F0ZSBpdCBkb3duIHRvIDMwIHNlY29uZHMuXG5cdFx0bWF4SW50ZXJ2YWwgPSAzMCoxMDAwO1xuXHR9XG5cblx0Ly8gR2VuZXJhdGUgdGhlIGludGVydmFsIHRvIGEgcmFuZG9tIG51bWJlciBcblx0Ly8gYmV0d2VlbiAwIGFuZCB0aGUgbWF4SW50ZXJ2YWwgZGV0ZXJtaW5lZCBmcm9tIGFib3ZlXG5cdHJldHVybiBNYXRoLnJhbmRvbSgpICogbWF4SW50ZXJ2YWw7XG59XG5cbmZ1bmN0aW9uIGNhbGxiYWNrT25JZChpZCwgZGF0YSl7XG4gICAgaWYoaWQgPT09IDUpe1xuICAgICAgICBpZihkYXRhLnN0YXRlICE9PSAwICYmIGRhdGEuc3RhdGUgIT09IDEgJiYgZGF0YS5zdGF0ZSAhPT0gNiAmJiBkYXRhLnN0YXRlICE9PSA4KXtcbiAgICAgICAgICAgIGdldFByb2Nlc3MoKTtcbiAgICAgICAgfVxuICAgICAgICBzZXRTdGF0ZShkYXRhKTtcbiAgICB9XG4gICAgZWxzZSBpZihpZCA9PSA3KXtcbiAgICAgICAgc2V0UHJvY2VzcyhkYXRhKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNldFN0YXRlUmVxdWVzdEludGVydmFsKCl7XG5cdHVwZGF0ZVN0YXRlSW50ZXJ2YWwgPSBzZXRJbnRlcnZhbChmdW5jdGlvbigpe1xuXHRcdGdldFN0YXRlKCk7XG5cdH0sIG9wdGlvbnMudXBkYXRlSW50ZXJ2YWwpO1xufVxuXG5mdW5jdGlvbiBpbml0V2Vic29ja2V0RXZlbnRzKGluc3RhbmNlKXtcblx0aW5zdGFuY2Uub25vcGVuID0gb25XZWJzb2NrZXRPcGVuO1xuXHRpbnN0YW5jZS5vbm1lc3NhZ2UgPSBvbldlYnNvY2tldE1lc3NhZ2U7XG5cdGluc3RhbmNlLm9uY2xvc2UgPSBvbldlYnNvY2tldENsb3NlO1xuXHRpbnN0YW5jZS5vbmVycm9yID0gb25XZWJzb2NrZXRFcnJvcjtcbn1cblxuZnVuY3Rpb24gb25XZWJzb2NrZXRPcGVuKCl7XG4gICAgY29uc29sZS5sb2coJ1dlYnNvY2tldCBvcGVuZWQnKTtcbiAgICBlbWl0KCdyZWFkeScpO1xuICAgIGdldFN0YXRlKCk7XG59XG5cbmZ1bmN0aW9uIG9uV2Vic29ja2V0TWVzc2FnZShlKXtcbiAgICB2YXIgZGF0YSA9IEpTT04ucGFyc2UoZS5kYXRhKSxcbiAgICAgICAgbWV0aG9kID0gZGF0YS5tZXRob2Q7XG5cbiAgICBjb25zb2xlLmxvZygnb25XZWJzb2NrZXRNZXNzYWdlIGRhdGE6ICcsIGRhdGEpO1xuXG4gICAgaWYoZGF0YS5lcnJvcikge1xuXHRcdHJldHVybiBlbWl0KCdFcnJvcicsIHsgbW9kdWxlOiBtb2R1bGVOYW1lLCBlcnJvcjogZGF0YS5lcnJvciB9KTtcbiAgICB9XG5cbiAgICBpZihkYXRhLm1ldGhvZCl7XG4gICAgICAgIHZhciBwYXJhbXMgPSBkYXRhLnBhcmFtcztcbiAgICAgICAgaWYobWV0aG9kID09ICdzZXRQcm9jZXNzJyl7XG5cdFx0XHRzZXRQcm9jZXNzKHBhcmFtcyk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZihtZXRob2QgPT0gJ3NldFN0YXRlJyl7XG5cdFx0XHRzZXRTdGF0ZShwYXJhbXMpO1xuICAgICAgICB9XG4gICAgfSBlbHNlIGlmKGRhdGEuaWQpe1xuXHRcdGNhbGxiYWNrT25JZChkYXRhLmlkLCBkYXRhLnJlc3VsdCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBvbldlYnNvY2tldENsb3NlKCl7XG4gICAgY29uc29sZS5sb2coJ1dlYnNvY2tldCBjbG9zZWQnKTtcbiAgICBpZihvcHRpb25zLndlYnNvY2tldHMpIHtcblx0XHR2YXIgdGltZSA9IGdlbmVyYXRlSW50ZXJ2YWwod2Vic29ja2V0VHJ5KTtcblx0XHRzZXRUaW1lb3V0KGZ1bmN0aW9uKCl7XG5cdFx0XHR3ZWJzb2NrZXRUcnkrKztcblx0XHRcdGluaXQoKTtcblx0XHR9LCB0aW1lKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIG9uV2Vic29ja2V0RXJyb3IoZXJyb3Ipe1xuXHRlbWl0KCdFcnJvcicsIHsgbW9kdWxlOiBtb2R1bGVOYW1lLCBlcnJvcjogZXJyb3IgfSk7XG59XG5cbi8qKlxuICogSW5pdCBmdW5jdGlvblxuICogXG4gKiBAcGFyYW0gIG5vbmVcbiAqIEByZXR1cm4gbm9uZVxuICovXG5mdW5jdGlvbiBpbml0KCl7XG5cdGlmKG9wdGlvbnMud2VicnRjKXtcblx0XHRjb25zb2xlLmxvZygnSW5pdGlhdGluZyBXZWJSVEMgbW9kdWxlJyk7XG5cdFx0V2ViUlRDLmluaXQoe3NpcDogb3B0aW9ucy5zaXAsIGF1ZGlvUmVtb3RlOiBvcHRpb25zLmF1ZGlvUmVtb3RlfSk7XG5cdH1cblx0aWYoIW9wdGlvbnMud2Vic29ja2V0cyl7XG5cdFx0aWYod2Vic29ja2V0ICE9PSB1bmRlZmluZWQpIHdlYnNvY2tldC5jbG9zZSgpO1xuXHRcdGNvbnNvbGUubG9nKCdTd2l0Y2hlZCB0byBYTUxIdHRwUmVxdWVzdCcpO1xuXHRcdHNldFN0YXRlUmVxdWVzdEludGVydmFsKCk7XG5cdFx0ZW1pdCgncmVhZHknKTtcblx0fSBlbHNle1xuXHRcdGlmKCF3aW5kb3cuV2ViU29ja2V0KSB7XG5cdFx0XHRjb25zb2xlLmxvZygnV2ViU29ja2V0IGlzIG5vdCBzdXBwb3J0ZWQuIFBsZWFzZSB1cGRhdGUgeW91ciBicm93c2VyLicpO1xuXHRcdFx0Y29uc29sZS5sb2coJ0ZhbGxiYWNrIHRvIFhNTEh0dHBSZXF1ZXN0Jyk7XG5cdFx0XHRvcHRpb25zLndlYnNvY2tldHMgPSBmYWxzZTtcblx0XHRcdHJldHVybiBpbml0KCk7XG5cdFx0fVxuXG5cdFx0Y29uc29sZS5sb2coJ1N3aXRjaGVkIHRvIFdlYnNvY2tldHMnKTtcblx0XHRcblx0XHQvLyBDbGVhciBcImdldFN0YXRlXCIgbWV0aG9kIHJlcXVlc3QgaW50ZXJ2YWwgYW5kIHN3aXRjaCB0byB3ZWJzb2NrZXRzXG5cdFx0aWYodXBkYXRlU3RhdGVJbnRlcnZhbCAhPT0gdW5kZWZpbmVkKSBjbGVhckludGVydmFsKHVwZGF0ZVN0YXRlSW50ZXJ2YWwpO1xuXG5cdFx0Ly8gSW5pdGlhdGUgV2Vic29ja2V0IGhhbmRzaGFrZVxuXHRcdHdlYnNvY2tldCA9IG5ldyBXZWJTb2NrZXQoKHByb3RvY29sID09PSAnaHR0cHMnID8gJ3dzcycgOiAnd3MnKSArICc6Ly8nK29wdGlvbnMuc2VydmVyKycvJywnanNvbi5hcGkuc21pbGUtc29mdC5jb20nKTtcblx0XHRpbml0V2Vic29ja2V0RXZlbnRzKHdlYnNvY2tldCk7XG5cdH1cbn1cblxuLyoqXG4gKiBTZW5kIHJlcXVlc3QgdG8gdGhlIHNlcnZlciB2aWEgWE1MSHR0cFJlcXVlc3Qgb3IgV2Vic29ja2V0c1xuICogQHBhcmFtICB7U3RyaW5nfSBtZXRob2QgU2VydmVyIEFQSSBtZXRob2RcbiAqIEBwYXJhbSAge09iamVjdH0gcGFyYW1zIFJlcXVlc3QgcGFyYW1ldGVyc1xuICogQHBhcmFtICB7TnVtYmVyfSBpZCAgICAgQ2FsbGJhY2sgaWQuIFNlbmQgZnJvbSBzZXJ2ZXIgdG8gY2xpZW50IHZpYSBXZWJzb2NrZXRzXG4gKiBAcmV0dXJuIHtTdHJpbmd9ICAgICAgICBSZXR1cm5zIHJlc3BvbnNlIGZyb20gdGhlIHNlcnZlclxuICovXG5mdW5jdGlvbiBzZW5kUmVxdWVzdChtZXRob2QsIHBhcmFtcywgY2FsbGJhY2spe1xuXHR2YXIganNvbnJwYyA9IHt9LCB4aHIsIHBhcnNlZEpTT04sIHJlcXVlc3RUaW1lciwgZXJyID0gbnVsbDtcblx0anNvbnJwYy5tZXRob2QgPSBtZXRob2Q7XG5cblx0aWYocGFyYW1zKSBqc29ucnBjLnBhcmFtcyA9IHBhcmFtcztcblx0aWYodHlwZW9mIGNhbGxiYWNrID09PSAnbnVtYmVyJykganNvbnJwYy5pZCA9IGNhbGxiYWNrO1xuXG5cdGpzb25ycGMgPSBKU09OLnN0cmluZ2lmeShqc29ucnBjKTtcblxuXHRpZihvcHRpb25zLndlYnNvY2tldHMpXG5cdFx0d2Vic29ja2V0LnNlbmQoanNvbnJwYyk7XG5cdGVsc2V7XG5cdFx0eGhyID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCk7XG5cdFx0eGhyLm9wZW4oXCJQT1NUXCIsIHByb3RvY29sKyc6Ly8nK29wdGlvbnMuc2VydmVyK1wiL1wiLCB0cnVlKTtcblxuXHRcdHJlcXVlc3RUaW1lciA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKXtcblx0XHRcdHhoci5hYm9ydCgpO1xuXHRcdH0sIDMwMDAwKTtcblx0XHR4aHIub25yZWFkeXN0YXRlY2hhbmdlID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRpZiAoeGhyLnJlYWR5U3RhdGU9PTQpe1xuXHRcdFx0XHRjbGVhclRpbWVvdXQocmVxdWVzdFRpbWVyKTtcblx0XHRcdFx0aWYoeGhyLnJlc3BvbnNlKSB7XG5cdFx0XHRcdFx0cGFyc2VkSlNPTiA9IEpTT04ucGFyc2UoeGhyLnJlc3BvbnNlKTtcblx0XHRcdFx0XHRpZihwYXJzZWRKU09OLmVycm9yKSB7XG5cdFx0XHRcdFx0XHRlcnIgPSBwYXJzZWRKU09OLmVycm9yO1xuXHRcdFx0XHRcdFx0ZW1pdCgnRXJyb3InLCB7IG1vZHVsZTogbW9kdWxlTmFtZSwgZXJyb3I6ICBlcnJ9KTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0aWYoY2FsbGJhY2spIHtcblx0XHRcdFx0XHRcdGNhbGxiYWNrKHBhcnNlZEpTT04ucmVzdWx0KTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9O1xuXHRcdHhoci5zZXRSZXF1ZXN0SGVhZGVyKCdDb250ZW50LVR5cGUnLCAnYXBwbGljYXRpb24vanNvbjsgY2hhcnNldD1VVEYtOCcpO1xuXHRcdHhoci5zZW5kKGpzb25ycGMpO1xuXHR9XG59XG5cbi8qKlxuICogR2V0IGluZm9ybWF0aW9uIG9mIGN1cnJlbnQgcHJvY2Vzc1xuICogTGlzdCBvZiBwcm9jZXNzIGlkczpcbiAqIDEgLSAnSW5jb21pbmcgY2FsbCdcbiAqIDcgLSAnSW5jb21pbmcgY2hhdCdcbiAqIDMyIC0gJ091dGdvaW5nIGNhbGwnXG4gKiAxMjkgLSAnT3V0Z29pbmcgYXV0b2RpYWwnXG4gKiAyNTcgLSAgJ091dGdvaW5nIGNhbGxiYWNrJ1xuICogXG4gKiBAcmV0dXJuIHtPYmplY3R9IGN1cnJlbnQgcHJvY2VzcyBpbmZvcm1hdGlvblxuICovXG5mdW5jdGlvbiBnZXRQcm9jZXNzKCl7XG5cdHNlbmRSZXF1ZXN0KCdnZXRQcm9jZXNzJywgbnVsbCwgKG9wdGlvbnMud2Vic29ja2V0cyA/IDcgOiBzZXRQcm9jZXNzKSk7XG59XG5cbi8qKlxuICogR2V0IGluZm9ybWF0aW9uIG9mIGN1cnJlbnQgY2xpZW50J3Mgc3RhdGVcbiAqIFBvc3NpYmxlIHN0YXRlczpcbiAqIDAgLSAnVW5yZWdpc3RlcmVkJ1xuICogMSAtICdQYXVzZSdcbiAqIDMgLSAnSW5jb21pbmcgY2FsbCdcbiAqIDQgLSAnT3V0Z29pbmcgY2FsbCdcbiAqIDUgLSAnQ29ubmVjdGVkIHdpdGggaW5jb21taW5nIGNhbGwnXG4gKiA2IC0gJ1dyYXAnXG4gKiA3IC0gJ0dlbmVyaWMgdGFzaydcbiAqIDggLSAnSWRsZSdcbiAqIDkgLSAnQ29ubmVjdGVkIHdpdGggb3V0Z29pbmcgY2FsbCdcbiAqIFxuICogQHJldHVybiB7T2JqZWN0fSBjdXJyZW50IGNsaWVudCdzIHN0YXRlXG4gKiBcbiAqL1xuZnVuY3Rpb24gZ2V0U3RhdGUoKXtcblx0c2VuZFJlcXVlc3QoJ2dldFN0YXRlJywgbnVsbCwgKG9wdGlvbnMud2Vic29ja2V0cyA/IDUgOiBzZXRTdGF0ZSkpO1xufVxuXG4vKipcbiAqIFN0YXRlIGNoYWdlIGV2ZW50IHJlY2VpdmVkIGZyb20gdGhlIHNlcnZlclxuICovXG5mdW5jdGlvbiBzZXRTdGF0ZShzdGF0ZUluZm8pe1xuXHRlbWl0KCdzdGF0ZWNoYW5nZScsIHN0YXRlSW5mbyk7XG59XG5cbi8qKlxuICogQ3VycmVudCBwcm9jZXNzIGluZm9ybWF0aW9uIHJlY2VpdmVkIGZyb20gdGhlIHNlcnZlclxuICogQHBhcmFtIHtPYmplY3R9IHByb2Nlc3NJbmZvIHByb2Nlc3MgaW5mb3JtYXRpb25cbiAqIEByZXR1cm4gbm9uZVxuICovXG5mdW5jdGlvbiBzZXRQcm9jZXNzKHByb2Nlc3NJbmZvKXtcblx0ZW1pdCgncHJvY2Vzc2NoYW5nZScsIHByb2Nlc3NJbmZvKTtcbn1cblxuLyoqXG4gKiBNb2R1bGUncyBpbml0aWF0aW9uIGZ1bmN0aW9uIHRoYXQgYWNjZXB0cyBpbml0aWF0aW9uIG9wdGlvbnNcbiAqIFxuICogQHBhcmFtICB7T2JqZWN0fSBvcHRzIG1vZHVsZSdzIGluaXRpYXRpb24gb3B0aW9uc1xuICogQHJldHVybiB7T2JqZWN0fSAgICAgIFtkZXNjcmlwdGlvbl1cbiAqL1xuZnVuY3Rpb24gY2xpZW50KG9wdHMpe1xuXHRpZihvcHRzKSBvcHRpb25zID0gdXRpbHMuZGVlcEV4dGVuZChvcHRpb25zLCBvcHRzKTtcblx0aWYoaW5pdGlhdGVkKSByZXR1cm4gY29uc29sZS53YXJuKCdNb2R1bGUgJyttb2R1bGVOYW1lKycgYWxyZWFkeSBpbml0aWF0ZWQsIGRvIG5vdGhpbmcnKTtcblx0Y29uc29sZS5sb2coJ0luaXRpYXRpbmcgJytvcHRpb25zLm1vZHVsZU5hbWUrJyBtb2R1bGUgd2l0aCBvcHRpb25zOiAnLCBvcHRpb25zKTtcblx0aW5pdCgpO1xuXHRpbml0aWF0ZWQgPSB0cnVlO1xuXHRyZXR1cm4gYXBpO1xufVxuXG5hcGkgPSB7XG5cblx0Ly8gQ3VycmVudCBwcm9jZXNzIGluZm9cblx0cHJvY2Vzczoge30sXG5cblx0Ly8gQ3VycmVudCBzdGF0ZVxuXHRzdGF0ZTogbnVsbCxcblxuXHQvLyBDdXJyZW50IHN1YnN0YXRlXG5cdHN1YnN0YXRlOiBudWxsLFxuXG5cdC8vIEV2ZW50IHN1YnNjcmlwdGlvbiBmdW5jdGlvblxuXHRvbjogb24sXG5cblx0Ly8gRXZlbnQgZW1pdHRpbmcgZnVuY3Rpb25cblx0ZW1pdDogZW1pdCxcblxuXHQvKipcblx0ICogSW5pdGlhdGUgb3V0Z29pbmcgY2FsbFxuXHQgKiBAcGFyYW0gIHtTdHJpbmd9IG51bWJlciB0ZWxlcGhvbmUgbnVtYmVyIHRvIGRpYWxcblx0ICogQHJldHVybiBub25lXG5cdCAqL1xuXHRjYWxsOiBmdW5jdGlvbihudW1iZXIpe1xuXHRcdGlmKG9wdGlvbnMud2VicnRjKSB7XG5cdFx0XHRXZWJSVEMuYXVkaW9jYWxsKG51bWJlcik7XG5cdFx0fSBlbHNlIHtcblx0XHRcdHNlbmRSZXF1ZXN0KCdpbml0Q2FsbCcsIHsgbnVtYmVyOiBudW1iZXIgfSk7XG5cdFx0fVxuXHR9LFxuXG5cdC8qKlxuXHQgKiBBbnN3ZXIgdG8gaW5jb21pbmcgY2FsbFxuXHQgKiBAcmV0dXJuIG5vbmVcblx0ICovXG5cdGFuc3dlcjogZnVuY3Rpb24oKXtcblx0XHQvLyBpZihvcHRpb25zLndlYnJ0Yykge1xuXHRcdC8vIFx0V2ViUlRDLmFuc3dlcigpO1xuXHRcdC8vIH0gZWxzZSB7XG5cdFx0XHRzZW5kUmVxdWVzdCgnYW5zd2VyQ2FsbCcpO1xuXHRcdC8vIH1cblx0fSxcblxuXHQvKipcblx0ICogUHJlc3MgaG9sZCBidXR0b25cblx0ICogQHJldHVybiBub25lXG5cdCAqL1xuXHRob2xkOiBmdW5jdGlvbigpe1xuXHRcdC8vIGlmKG9wdGlvbnMud2VicnRjKSB7XG5cdFx0Ly8gXHRXZWJSVEMuaG9sZCgpO1xuXHRcdC8vIH0gZWxzZSB7XG5cdFx0XHRzZW5kUmVxdWVzdCgncHJlc3NIb2xkJyk7XG5cdFx0Ly8gfVxuXHR9LFxuXG5cdC8qKlxuXHQgKiBDaGFuZ2UgYWdlbnQncyBzdGF0ZSB0byBJRExFXG5cdCAqIENvdWxkIGJlIGNhbGxlZCBvbmx5IGlmIGFnZW50IGlzIGVpdGhlciBpbiBXUkFQIG9yIFBBVVNFIHN0YXRlc1xuXHQgKiBAcmV0dXJuIG5vbmVcblx0ICovXG5cdGlkbGU6IGZ1bmN0aW9uKCl7XG5cdFx0aWYoYXBpLnN0YXRlID09PSAxIHx8IGFwaS5zdGF0ZSA9PT0gNikge1xuXHRcdFx0c2VuZFJlcXVlc3QoJ3NldFBhdXNlU3RhdGUnLCB7IHN0YXRlOiAwIH0pO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRjb25zb2xlLmxvZygnTm90IGluIFdSQVAgb3IgUEFVU0UsIGRvIG5vdGhpbmcuJyk7XG5cdFx0fVxuXHR9LFxuXG5cdC8qKlxuXHQgKiBQcmVzcyBjb25mZXJlbmNlIGJ1dHRvblxuXHQgKiBAcmV0dXJuIG5vbmVcblx0ICovXG5cdGNvbmZlcmVuY2U6IGZ1bmN0aW9uKCl7XG5cdFx0c2VuZFJlcXVlc3QoJ3ByZXNzQ29uZmVyZW5jZScpO1xuXHR9LFxuXG5cdC8qKlxuXHQgKiBEcm9wIGN1cnJlbnQgY2FsbFxuXHQgKiBAcmV0dXJuIG5vbmVcblx0ICovXG5cdGRyb3A6IGZ1bmN0aW9uKCl7XG5cdFx0aWYob3B0aW9ucy53ZWJydGMpIHtcblx0XHRcdFdlYlJUQy50ZXJtaW5hdGUoKTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0c2VuZFJlcXVlc3QoJ2Ryb3BDYWxsJyk7XG5cdFx0fVxuXHR9LFxuXG5cdC8qKlxuXHQgKiBDbG9zZSBjdXJyZW50IHByb2Nlc3Mgd2l0aCBleGl0IGNvZGVcblx0ICogQHBhcmFtICB7U3RyaW5nfSBwcm9jZXNzaWQgcHJvY2VzcyBpZFxuXHQgKiBAcGFyYW0gIHtOdW1iZXJ9IGV4aXRjb2RlICBleGl0IGNvZGVcblx0ICogQHJldHVybiBub25lXG5cdCAqL1xuXHRjbG9zZTogZnVuY3Rpb24ocHJvY2Vzc2lkLCBleGl0Y29kZSl7XG5cdFx0ZXJyb3Jtc2cgPSAnJztcblx0XHRpZighcHJvY2Vzc2lkKSBlcnJvcm1zZyArPSAncHJvY2Vzc2lkIGlzIG5vdCBkZWZpbmVkXFxuJztcblx0XHRpZighZXhpdGNvZGUpIGVycm9ybXNnICs9ICdleGl0Y29kZSBpcyBub3QgZGVmaW5lZFxcbic7XG5cdFx0aWYoZXJyb3Jtc2cgIT09ICcnKSByZXR1cm4gY29uc29sZS5lcnJvcignQ2FuXFwndCBjbG9zZSBwcm9jZXNzOlxcbicgKyBlcnJvcm1zZyk7XG5cblx0XHRzZW5kUmVxdWVzdCgnY2xvc2VQcm9jZXNzJywgeyBwcm9jZXNzaWQ6IHByb2Nlc3NpZCwgZXhpdGNvZGU6IGV4aXRjb2RlIH0pO1xuXHR9LFxuXG5cdC8qKlxuXHQgKiBTZXQgcGF1c2Ugc3RhdGVcblx0ICogUG9zc2libGUgc3RhdGVzOlxuXHQgKiAwIC0gc3dpdGNoIHRvIElETEUgc3RhdGVcblx0ICogQW55IHBhdXNlIGNvZGVzIHRoYXQgd2VyZSBzZXQgaW4gQWRtaW4gU3R1ZGlvXG5cdCAqIFxuXHQgKiBAcGFyYW0ge051bWJlcn0gc3RhdGUgICBwYXVzZSBzdGF0ZVxuXHQgKiBAcGFyYW0ge1N0cmluZ30gY29tbWVudCBjb21tZW50IHN0cmluZ1xuXHQgKiBAcmV0dXJuIG5vbmVcblx0ICovXG5cdHBhdXNlOiBmdW5jdGlvbihzdGF0ZSwgY29tbWVudCl7XG5cdFx0c2VuZFJlcXVlc3QoJ3NldFBhdXNlU3RhdGUnLCB7IHN0YXRlOiBzdGF0ZSwgY29tbWVudDogY29tbWVudCB8fCAnJyB9KTtcblx0fVxuXG59O1xuXG5vbignc3RhdGVjaGFuZ2UnLCBmdW5jdGlvbiAocGFyYW1zKXtcblx0YXBpLnN0YXRlID0gcGFyYW1zLnN0YXRlO1xuXHRhcGkuc3Vic3RhdGUgPSBwYXJhbXMuc3Vic3RhdGU7XG59KTtcblxub24oJ3Byb2Nlc3NjaGFuZ2UnLCBmdW5jdGlvbiAocGFyYW1zKXtcblx0YXBpLnByb2Nlc3MgPSBwYXJhbXM7XG59KTtcblxubW9kdWxlLmV4cG9ydHMgPSBjbGllbnQ7IiwidmFyIHN1YnMgPSB7fTtcbnZhciBoT1AgPSBzdWJzLmhhc093blByb3BlcnR5O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcblx0b246IGZ1bmN0aW9uKHN1YiwgbGlzdGVuZXIpIHtcblx0XHQvLyBDcmVhdGUgdGhlIHN1YnNjcmlwdGlvbidzIG9iamVjdCBpZiBub3QgeWV0IGNyZWF0ZWRcblx0XHRpZighaE9QLmNhbGwoc3Vicywgc3ViKSkgc3Vic1tzdWJdID0gW107XG5cblx0XHQvLyBBZGQgdGhlIGxpc3RlbmVyIHRvIHF1ZXVlXG5cdFx0dmFyIGluZGV4ID0gc3Vic1tzdWJdLnB1c2gobGlzdGVuZXIpIC0xO1xuXG5cdFx0Ly8gUHJvdmlkZSBoYW5kbGUgYmFjayBmb3IgcmVtb3ZhbCBvZiBzdWJzY3JpcHRpb25cblx0XHRyZXR1cm4ge1xuXHRcdFx0b2ZmOiBmdW5jdGlvbigpIHtcblx0XHRcdFx0ZGVsZXRlIHN1YnNbc3ViXVtpbmRleF07XG5cdFx0XHR9XG5cdFx0fTtcblx0fSxcblx0ZW1pdDogZnVuY3Rpb24oc3ViLCBpbmZvKSB7XG5cdFx0Ly8gSWYgdGhlIHN1YnNjcmlwdGlvbiBkb2Vzbid0IGV4aXN0LCBvciB0aGVyZSdzIG5vIGxpc3RlbmVycyBpbiBxdWV1ZSwganVzdCBsZWF2ZVxuXHRcdGlmKCFoT1AuY2FsbChzdWJzLCBzdWIpKSByZXR1cm47XG5cblx0XHQvLyBDeWNsZSB0aHJvdWdoIHN1YnNjcmlwdGlvbnMgcXVldWUsIGZpcmUhXG5cdFx0c3Vic1tzdWJdLmZvckVhY2goZnVuY3Rpb24oaXRlbSkge1xuXHRcdFx0aXRlbShpbmZvICE9PSB1bmRlZmluZWQgPyBpbmZvIDoge30pO1xuXHRcdH0pO1xuXHR9XG59OyIsInZhciBTbWlsZVNvZnQgPSBnbG9iYWwuU21pbGVTb2Z0IHx8IHt9O1xudmFyIG9wdGlvbnMgPSByZXF1aXJlKCcuL29wdGlvbnMnKTtcbnZhciBhcGkgPSByZXF1aXJlKCcuL2FwaScpO1xuXG5TbWlsZVNvZnRbb3B0aW9ucy5tb2R1bGVOYW1lXSA9IGFwaTtcblxubW9kdWxlLmV4cG9ydHMgPSBTbWlsZVNvZnQ7IiwibW9kdWxlLmV4cG9ydHMgPSB7XG5cdG1vZHVsZU5hbWU6ICdBZ2VudCcsXG5cdC8vIFNlcnZlciBJUCBhZGRyZXNzIG9yIERvbWFpbiBuYW1lIGFuZCBzZXJ2ZXIgcG9ydCAoaWYgb3RoZXIgdGhhbiA4MC80NDMpXG5cdC8vIEV4cDogMTkyLjE2OC4xLjEwMDo4ODgwIG9yIHd3dy5leGFtcGxlLmNvbVxuXHRzZXJ2ZXI6IGdsb2JhbC5sb2NhdGlvbi5ob3N0LFxuXHR1cGRhdGVJbnRlcnZhbDogMTAwMCxcblx0d2Vic29ja2V0czogdHJ1ZSxcblx0d2VicnRjOiB0cnVlLFxuXHRzaXA6IHtcblx0XHRyZWFsbTogZ2xvYmFsLmxvY2F0aW9uLmhvc3QsXG5cdFx0d3Nfc2VydmVyczogJ3dzczovLycrZ2xvYmFsLmxvY2F0aW9uLmhvc3QsXG5cdFx0Ly8gYXV0aG9yaXphdGlvbl91c2VyOiAnJyxcblx0XHQvLyB1cmk6ICcnLFxuXHRcdC8vIHBhc3N3b3JkOiAnJyxcblx0XHQvLyBkaXNwbGF5X25hbWU6ICcnLFxuXHRcdHJlZ2lzdGVyOiB0cnVlXG5cdH0sXG5cdGF1ZGlvUmVtb3RlOiBudWxsXG59OyIsIlxubW9kdWxlLmV4cG9ydHMgPSB7XG5cdGV4dGVuZE9iajogZXh0ZW5kT2JqLFxuXHRkZWVwRXh0ZW5kOiBkZWVwRXh0ZW5kXG59O1xuXG4vKipcbiAqIEV4dGVuZCdzIG9iamVjdCB3aXRoIHByb3BlcnRpZXNcbiAqIFxuICogQHJldHVybiB7T2JqZWN0fSBNZXJnZWQgb2JqZWN0c1xuICovXG5mdW5jdGlvbiBleHRlbmRPYmoodGFyZ2V0LCBzb3VyY2Upe1xuXHR2YXIgYSA9IE9iamVjdC5jcmVhdGUodGFyZ2V0KTtcblx0T2JqZWN0LmtleXMoc291cmNlKS5tYXAoZnVuY3Rpb24gKHByb3ApIHtcblx0XHRwcm9wIGluIGEgJiYgKGFbcHJvcF0gPSBzb3VyY2VbcHJvcF0pO1xuXHR9KTtcblx0cmV0dXJuIGE7XG59XG5cbmZ1bmN0aW9uIGRlZXBFeHRlbmQoZGVzdGluYXRpb24sIHNvdXJjZSkge1xuICBmb3IgKHZhciBwcm9wZXJ0eSBpbiBzb3VyY2UpIHtcbiAgICBpZiAoc291cmNlW3Byb3BlcnR5XSAmJiBzb3VyY2VbcHJvcGVydHldLmNvbnN0cnVjdG9yICYmXG4gICAgIHNvdXJjZVtwcm9wZXJ0eV0uY29uc3RydWN0b3IgPT09IE9iamVjdCkge1xuICAgICAgZGVzdGluYXRpb25bcHJvcGVydHldID0gZGVzdGluYXRpb25bcHJvcGVydHldIHx8IHt9O1xuICAgICAgYXJndW1lbnRzLmNhbGxlZShkZXN0aW5hdGlvbltwcm9wZXJ0eV0sIHNvdXJjZVtwcm9wZXJ0eV0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBkZXN0aW5hdGlvbltwcm9wZXJ0eV0gPSBzb3VyY2VbcHJvcGVydHldO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZGVzdGluYXRpb247XG59IiwidmFyIGV2ZW50cyA9IHJlcXVpcmUoJy4vZXZlbnRzJyksXG5Kc1NJUCA9IGdsb2JhbC5Kc1NJUCxcbm9wdGlvbnMsXG5zaXBDbGllbnQsXG5zaXBTZXNzaW9uLFxuc2lwQ2FsbEV2ZW50cztcblxuZnVuY3Rpb24gaXNXZWJydGNTdXBwb3J0ZWQoKXtcblx0dmFyIFJUQyA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiB8fCB3aW5kb3cubW96UlRDUGVlckNvbm5lY3Rpb24gfHwgd2luZG93LndlYmtpdFJUQ1BlZXJDb25uZWN0aW9uLFxuXHRcdHVzZXJNZWlkYSA9IG5hdmlnYXRvci5nZXRVc2VyTWVkaWEgfHwgbmF2aWdhdG9yLndlYmtpdEdldFVzZXJNZWRpYSB8fCBuYXZpZ2F0b3IubXNHZXRVc2VyTWVkaWEgfHwgbmF2aWdhdG9yLm1vekdldFVzZXJNZWRpYSxcblx0XHRpY2UgPSB3aW5kb3cubW96UlRDSWNlQ2FuZGlkYXRlIHx8IHdpbmRvdy5SVENJY2VDYW5kaWRhdGU7XG5cblx0cmV0dXJuICEhUlRDICYmICEhdXNlck1laWRhICYmICEhaWNlO1xufVxuXG5mdW5jdGlvbiBpbml0SnNTSVBFdmVudHMoKXtcblx0c2lwQ2xpZW50Lm9uKCdjb25uZWN0ZWQnLCBmdW5jdGlvbihlKXsgY29uc29sZS5sb2coJ3NpcCBjb25uZWN0ZWQgZXZlbnQ6ICcsIGUpOyB9KTtcblx0c2lwQ2xpZW50Lm9uKCdkaXNjb25uZWN0ZWQnLCBmdW5jdGlvbihlKXsgY29uc29sZS5sb2coJ3NpcCBkaXNjb25uZWN0ZWQgZXZlbnQ6ICcsIGUpOyB9KTtcblx0c2lwQ2xpZW50Lm9uKCduZXdNZXNzYWdlJywgZnVuY3Rpb24oZSl7IGNvbnNvbGUubG9nKCdzaXAgbmV3TWVzc2FnZSBldmVudDogJywgZSk7IH0pO1xuXHRzaXBDbGllbnQub24oJ25ld1JUQ1Nlc3Npb24nLCBmdW5jdGlvbihlKXtcblx0XHRjb25zb2xlLmxvZygnc2lwIG5ld1JUQ1Nlc3Npb24gZXZlbnQ6ICcsIGUpO1xuXHRcdHNpcFNlc3Npb24gPSBlLnNlc3Npb247XG5cdH0pO1xuXHRzaXBDbGllbnQub24oJ3JlZ2lzdGVyZWQnLCBmdW5jdGlvbihlKXsgY29uc29sZS5sb2coJ3NpcCByZWdpc3RlcmVkIGV2ZW50OiAnLCBlKTsgfSk7XG5cdHNpcENsaWVudC5vbigndW5yZWdpc3RlcmVkJywgZnVuY3Rpb24oZSl7IGNvbnNvbGUubG9nKCdzaXAgdW5yZWdpc3RlcmVkIGV2ZW50OiAnLCBlKTsgfSk7XG5cdHNpcENsaWVudC5vbigncmVnaXN0cmF0aW9uRmFpbGVkJywgZnVuY3Rpb24oZSl7IGNvbnNvbGUubG9nKCdzaXAgcmVnaXN0cmF0aW9uRmFpbGVkIGV2ZW50OiAnLCBlKTsgfSk7XG5cblx0c2lwQ2FsbEV2ZW50cyA9IHtcblx0XHRwcm9ncmVzczogZnVuY3Rpb24oZSl7XG5cdFx0XHRjb25zb2xlLmxvZygnY2FsbCBwcm9ncmVzcyBldmVudDogJywgZSk7XG5cdFx0XHRldmVudHMuZW1pdCgnY2FsbC5wcm9ncmVzcycsIGUpO1xuXHRcdH0sXG5cdFx0ZmFpbGVkOiBmdW5jdGlvbihlKXtcblx0XHRcdGNvbnNvbGUubG9nKCdjYWxsIGZhaWxlZCBldmVudDonLCBlKTtcblx0XHRcdGV2ZW50cy5lbWl0KCdjYWxsLmZhaWxlZCcsIGUpO1xuXHRcdH0sXG5cdFx0ZW5kZWQ6IGZ1bmN0aW9uKGUpe1xuXHRcdFx0Y29uc29sZS5sb2coJ2NhbGwgZW5kZWQgZXZlbnQ6ICcsIGUpO1xuXHRcdFx0ZXZlbnRzLmVtaXQoJ2NhbGwuZW5kZWQnLCBlKTtcblx0XHR9LFxuXHRcdGNvbmZpcm1lZDogZnVuY3Rpb24oZSl7XG5cdFx0XHRjb25zb2xlLmxvZygnY2FsbCBjb25maXJtZWQgZXZlbnQ6ICcsIGUpO1xuXHRcdFx0ZXZlbnRzLmVtaXQoJ2NhbGwuY29uZmlybWVkJywgZSk7XG5cdFx0fSxcblx0XHRhZGRzdHJlYW06IGZ1bmN0aW9uKGUpe1xuXHRcdFx0Y29uc29sZS5sb2coJ2NhbGwgYWRkc3RyZWFtIGV2ZW50OiAnLCBlKTtcblx0XHRcdHZhciBzdHJlYW0gPSBlLnN0cmVhbTtcblx0XHRcdG9wdGlvbnMuYXVkaW9SZW1vdGUgPSBKc1NJUC5ydGNuaW5qYS5hdHRhY2hNZWRpYVN0cmVhbShvcHRpb25zLmF1ZGlvUmVtb3RlLCBzdHJlYW0pO1xuXHRcdH1cblx0fTtcbn1cblxuZnVuY3Rpb24gYXVkaW9jYWxsKG51bWJlcil7XG5cdHNpcFNlc3Npb24gPSBzaXBDbGllbnQuY2FsbChudW1iZXIsIHtcblx0XHRldmVudEhhbmRsZXJzOiBzaXBDYWxsRXZlbnRzLFxuXHRcdG1lZGlhQ29uc3RyYWludHM6IHsgYXVkaW86IHRydWUsIHZpZGVvOiBmYWxzZSB9XG5cdH0pO1xufVxuXG5mdW5jdGlvbiB0ZXJtaW5hdGUoKXtcblx0c2lwQ2xpZW50LnRlcm1pbmF0ZVNlc3Npb25zKCk7XG59XG5cbmZ1bmN0aW9uIGFuc3dlcigpe1xuXHRjb25zb2xlLmxvZygnYW5zd2VyOiAnLHNpcENsaWVudCk7XG5cdHNpcFNlc3Npb24uYW5zd2VyKCk7XG59XG5cbmZ1bmN0aW9uIGhvbGQoKXtcblx0Y29uc29sZS5sb2coJ2hvbGQ6ICcsIHNpcFNlc3Npb24uaXNPbkhvbGQoKSk7XG5cdGlmKHNpcFNlc3Npb24gJiYgc2lwU2Vzc2lvbi5pc09uSG9sZCgpLmxvY2FsKSB7XG5cdFx0c2lwU2Vzc2lvbi51bmhvbGQoKTtcblx0fSBlbHNlIHtcblx0XHRzaXBTZXNzaW9uLmhvbGQoKTtcblx0fVxufVxuXG5mdW5jdGlvbiBpbml0KG9wdHMpe1xuXHRvcHRpb25zID0gb3B0cztcblx0c2lwQ2xpZW50ID0gbmV3IEpzU0lQLlVBKG9wdGlvbnMuc2lwKTtcblx0aW5pdEpzU0lQRXZlbnRzKCk7XG5cdHNpcENsaWVudC5zdGFydCgpO1xuXHRyZXR1cm4gc2lwQ2xpZW50O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcblx0bGliOiBKc1NJUCxcblx0aW5pdDogaW5pdCxcblx0YXVkaW9jYWxsOiBhdWRpb2NhbGwsXG5cdHRlcm1pbmF0ZTogdGVybWluYXRlLFxuXHRhbnN3ZXI6IGFuc3dlcixcblx0aG9sZDogaG9sZFxufTsiXX0=
