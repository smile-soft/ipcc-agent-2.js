(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.SmileSoft = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
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
		WebRTC.init({sip: options.sip});
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
		if(options.webrtc) {
			WebRTC.answer();
		} else {
			sendRequest('answerCall');
		}
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
var utils = require('./utils');
var events = require('./events');
var options = {};
var sipClient;
var sipSession;
var sipCallEvents;

function isWebrtcSupported(){
	var RTC = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection,
		userMeida = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.msGetUserMedia || navigator.mozGetUserMedia || navigator.mediaDevices.getUserMedia,
		ice = window.mozRTCIceCandidate || window.RTCIceCandidate;

	return !!RTC && !!userMeida && !!ice;
}

function initJsSIPEvents(){
	sipClient.on('connected', function(e){ console.log('sip connected event: ', e); });
	sipClient.on('disconnected', function(e){ console.log('sip disconnected event: ', e); });
	sipClient.on('newMessage', function(e){ console.log('sip newMessage event: ', e); });
	sipClient.on('newRTCSession', function(e){
		console.log('sip newRTCSession event: ', e);
		events.emit('webrtc/newRTCSession', e);
		sipSession = e.session;
	});
	sipClient.on('registered', function(e){ console.log('sip registered event: ', e); });
	sipClient.on('unregistered', function(e){ console.log('sip unregistered event: ', e); });
	sipClient.on('registrationFailed', function(e){ console.log('sip registrationFailed event: ', e); });

	sipCallEvents = {
		progress: function(e){
			console.log('call progress event: ', e);
			events.emit('webrtc/progress', e);
		},
		failed: function(e){
			console.log('call failed event:', e);
			events.emit('webrtc/failed', e);
		},
		ended: function(e){
			console.log('call ended event: ', e);
			events.emit('webrtc/ended', e);
		},
		confirmed: function(e){
			console.log('call confirmed event: ', e);
			events.emit('webrtc/confirmed', e);
		},
		sdp: function(e){
			console.log('sdp event: ', e);
		}
	};
}

function isEstablished(){
	return sipSession.isEstablished();
}

function isInProgress(){
	return sipSession.isInProgress();
}

function isEnded(){
	return sipSession.isEnded();
}

function unregister(){
	sipClient.stop();
}

function audiocall(number){
	sipSession = sipClient.call(number, {
		eventHandlers: sipCallEvents,
		mediaConstraints: { audio: true, video: false }
	});

	sipSession.connection.addEventListener('track', function(e) {
		events.emit('webrtc/addstream', e);
		if(options.audioRemote.srcObject !== e.streams[0]) options.audioRemote.srcObject = e.streams[0];
	})
}

function terminate(){
	sipSession.terminate({
		status_code: 200
	});
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

function createRemoteAudio(){
	var el = document.createElement('audio');
	el.setAttribute('autoplay', 'autoplay');
	document.body.appendChild(el);
	return el;
}

function init(params){
	var JsSIP = global.JsSIP;
	var socket;

	console.log('JsSIP: ', global, JsSIP);

	options = utils.deepExtend(options, params);
	options.audioRemote = createRemoteAudio();

	socket = new JsSIP.WebSocketInterface(options.sip.ws_servers);
	options.sip.sockets = [socket];

	if(options.sip.register === undefined) options.sip.register = false;

	console.log('Initiating WebRTC module:', options);
	
	sipClient = new JsSIP.UA(options.sip);
	initJsSIPEvents();
	sipClient.start();
}

module.exports = {
	init: init,
	unregister: unregister,
	audiocall: audiocall,
	terminate: terminate,
	answer: answer,
	hold: hold,
	isInProgress: isInProgress,
	isEstablished: isEstablished,
	isEnded: isEnded,
	isSupported: isWebrtcSupported
};
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./events":2,"./utils":5}]},{},[3])(3)
});

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzb3VyY2UvYXBpLmpzIiwic291cmNlL2V2ZW50cy5qcyIsInNvdXJjZS9tYWluLmpzIiwic291cmNlL29wdGlvbnMuanMiLCJzb3VyY2UvdXRpbHMuanMiLCJzb3VyY2Uvd2VicnRjLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9YQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDM0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ05BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUM5QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbigpe2Z1bmN0aW9uIHIoZSxuLHQpe2Z1bmN0aW9uIG8oaSxmKXtpZighbltpXSl7aWYoIWVbaV0pe3ZhciBjPVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmU7aWYoIWYmJmMpcmV0dXJuIGMoaSwhMCk7aWYodSlyZXR1cm4gdShpLCEwKTt2YXIgYT1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK2krXCInXCIpO3Rocm93IGEuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixhfXZhciBwPW5baV09e2V4cG9ydHM6e319O2VbaV1bMF0uY2FsbChwLmV4cG9ydHMsZnVuY3Rpb24ocil7dmFyIG49ZVtpXVsxXVtyXTtyZXR1cm4gbyhufHxyKX0scCxwLmV4cG9ydHMscixlLG4sdCl9cmV0dXJuIG5baV0uZXhwb3J0c31mb3IodmFyIHU9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZSxpPTA7aTx0Lmxlbmd0aDtpKyspbyh0W2ldKTtyZXR1cm4gb31yZXR1cm4gcn0pKCkiLCJ2YXIgV2ViUlRDID0gcmVxdWlyZSgnLi93ZWJydGMnKSxcbmV2ZW50cyA9IHJlcXVpcmUoJy4vZXZlbnRzJyksXG51dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMnKSxcbi8vIE1vZHVsZXMncyBpbml0aWF0aW9uIG9wdGlvbnNcbm9wdGlvbnMgPSByZXF1aXJlKCcuL29wdGlvbnMnKSxcbm1vZHVsZU5hbWUgPSBvcHRpb25zLm1vZHVsZU5hbWUsXG4vLyBDdXJyZW50IHByb3RvY29sXG5wcm90b2NvbCA9IHdpbmRvdy5sb2NhdGlvbi5wcm90b2NvbC5pbmRleE9mKCdodHRwcycpICE9PSAtMSA/ICdodHRwcycgOiAnaHR0cCcsXG4vLyBJbnRlcnZhbCB0byByZXF1ZXN0IGN1cnJlbnQgY2xpZW50J3Mgc3RhdGUgZnJvbSB0aGUgc2VydmVyXG51cGRhdGVTdGF0ZUludGVydmFsLFxuLy8gV2Vic29ja2V0IG9iamVjdFxud2Vic29ja2V0LFxud2Vic29ja2V0VHJ5ID0gMSxcbmluaXRpYXRlZCA9IGZhbHNlLFxuZXJyb3Jtc2cgPSAnJyxcbi8vIE1vZHVsZSdzIHB1YmxpYyBhcGlcbmFwaTtcblxuZnVuY3Rpb24gb24oc3ViLCBjYil7XG5cdGV2ZW50cy5vbihzdWIsIGNiKTtcbn1cblxuZnVuY3Rpb24gZW1pdChzdWIsIHBhcmFtcyl7XG5cdGV2ZW50cy5lbWl0KHN1YiwgcGFyYW1zKTtcbn1cblxuLy8gUmVjb25uZWN0aW9uIEV4cG9uZW50aWFsIEJhY2tvZmYgQWxnb3JpdGhtXG4vLyBodHRwOi8vYmxvZy5qb2hucnlkaW5nLmNvbS9wb3N0Lzc4NTQ0OTY5MzQ5L2hvdy10by1yZWNvbm5lY3Qtd2ViLXNvY2tldHMtaW4tYS1yZWFsdGltZS13ZWItYXBwXG5mdW5jdGlvbiBnZW5lcmF0ZUludGVydmFsIChrKSB7XG5cdHZhciBtYXhJbnRlcnZhbCA9IChNYXRoLnBvdygyLCBrKSAtIDEpICogMTAwMDtcblxuXHRpZiAobWF4SW50ZXJ2YWwgPiAzMCoxMDAwKSB7XG5cdFx0Ly8gSWYgdGhlIGdlbmVyYXRlZCBpbnRlcnZhbCBpcyBtb3JlIHRoYW4gMzAgc2Vjb25kcywgXG5cdFx0Ly8gdHJ1bmNhdGUgaXQgZG93biB0byAzMCBzZWNvbmRzLlxuXHRcdG1heEludGVydmFsID0gMzAqMTAwMDtcblx0fVxuXG5cdC8vIEdlbmVyYXRlIHRoZSBpbnRlcnZhbCB0byBhIHJhbmRvbSBudW1iZXIgXG5cdC8vIGJldHdlZW4gMCBhbmQgdGhlIG1heEludGVydmFsIGRldGVybWluZWQgZnJvbSBhYm92ZVxuXHRyZXR1cm4gTWF0aC5yYW5kb20oKSAqIG1heEludGVydmFsO1xufVxuXG5mdW5jdGlvbiBjYWxsYmFja09uSWQoaWQsIGRhdGEpe1xuICAgIGlmKGlkID09PSA1KXtcbiAgICAgICAgaWYoZGF0YS5zdGF0ZSAhPT0gMCAmJiBkYXRhLnN0YXRlICE9PSAxICYmIGRhdGEuc3RhdGUgIT09IDYgJiYgZGF0YS5zdGF0ZSAhPT0gOCl7XG4gICAgICAgICAgICBnZXRQcm9jZXNzKCk7XG4gICAgICAgIH1cbiAgICAgICAgc2V0U3RhdGUoZGF0YSk7XG4gICAgfVxuICAgIGVsc2UgaWYoaWQgPT0gNyl7XG4gICAgICAgIHNldFByb2Nlc3MoZGF0YSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzZXRTdGF0ZVJlcXVlc3RJbnRlcnZhbCgpe1xuXHR1cGRhdGVTdGF0ZUludGVydmFsID0gc2V0SW50ZXJ2YWwoZnVuY3Rpb24oKXtcblx0XHRnZXRTdGF0ZSgpO1xuXHR9LCBvcHRpb25zLnVwZGF0ZUludGVydmFsKTtcbn1cblxuZnVuY3Rpb24gaW5pdFdlYnNvY2tldEV2ZW50cyhpbnN0YW5jZSl7XG5cdGluc3RhbmNlLm9ub3BlbiA9IG9uV2Vic29ja2V0T3Blbjtcblx0aW5zdGFuY2Uub25tZXNzYWdlID0gb25XZWJzb2NrZXRNZXNzYWdlO1xuXHRpbnN0YW5jZS5vbmNsb3NlID0gb25XZWJzb2NrZXRDbG9zZTtcblx0aW5zdGFuY2Uub25lcnJvciA9IG9uV2Vic29ja2V0RXJyb3I7XG59XG5cbmZ1bmN0aW9uIG9uV2Vic29ja2V0T3Blbigpe1xuICAgIGNvbnNvbGUubG9nKCdXZWJzb2NrZXQgb3BlbmVkJyk7XG4gICAgZW1pdCgncmVhZHknKTtcbiAgICBnZXRTdGF0ZSgpO1xufVxuXG5mdW5jdGlvbiBvbldlYnNvY2tldE1lc3NhZ2UoZSl7XG4gICAgdmFyIGRhdGEgPSBKU09OLnBhcnNlKGUuZGF0YSksXG4gICAgICAgIG1ldGhvZCA9IGRhdGEubWV0aG9kO1xuXG4gICAgY29uc29sZS5sb2coJ29uV2Vic29ja2V0TWVzc2FnZSBkYXRhOiAnLCBkYXRhKTtcblxuICAgIGlmKGRhdGEuZXJyb3IpIHtcblx0XHRyZXR1cm4gZW1pdCgnRXJyb3InLCB7IG1vZHVsZTogbW9kdWxlTmFtZSwgZXJyb3I6IGRhdGEuZXJyb3IgfSk7XG4gICAgfVxuXG4gICAgaWYoZGF0YS5tZXRob2Qpe1xuICAgICAgICB2YXIgcGFyYW1zID0gZGF0YS5wYXJhbXM7XG4gICAgICAgIGlmKG1ldGhvZCA9PSAnc2V0UHJvY2Vzcycpe1xuXHRcdFx0c2V0UHJvY2VzcyhwYXJhbXMpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYobWV0aG9kID09ICdzZXRTdGF0ZScpe1xuXHRcdFx0c2V0U3RhdGUocGFyYW1zKTtcbiAgICAgICAgfVxuICAgIH0gZWxzZSBpZihkYXRhLmlkKXtcblx0XHRjYWxsYmFja09uSWQoZGF0YS5pZCwgZGF0YS5yZXN1bHQpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gb25XZWJzb2NrZXRDbG9zZSgpe1xuICAgIGNvbnNvbGUubG9nKCdXZWJzb2NrZXQgY2xvc2VkJyk7XG4gICAgaWYob3B0aW9ucy53ZWJzb2NrZXRzKSB7XG5cdFx0dmFyIHRpbWUgPSBnZW5lcmF0ZUludGVydmFsKHdlYnNvY2tldFRyeSk7XG5cdFx0c2V0VGltZW91dChmdW5jdGlvbigpe1xuXHRcdFx0d2Vic29ja2V0VHJ5Kys7XG5cdFx0XHRpbml0KCk7XG5cdFx0fSwgdGltZSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBvbldlYnNvY2tldEVycm9yKGVycm9yKXtcblx0ZW1pdCgnRXJyb3InLCB7IG1vZHVsZTogbW9kdWxlTmFtZSwgZXJyb3I6IGVycm9yIH0pO1xufVxuXG4vKipcbiAqIEluaXQgZnVuY3Rpb25cbiAqIFxuICogQHBhcmFtICBub25lXG4gKiBAcmV0dXJuIG5vbmVcbiAqL1xuZnVuY3Rpb24gaW5pdCgpe1xuXHRpZihvcHRpb25zLndlYnJ0Yyl7XG5cdFx0V2ViUlRDLmluaXQoe3NpcDogb3B0aW9ucy5zaXB9KTtcblx0fVxuXHRpZighb3B0aW9ucy53ZWJzb2NrZXRzKXtcblx0XHRpZih3ZWJzb2NrZXQgIT09IHVuZGVmaW5lZCkgd2Vic29ja2V0LmNsb3NlKCk7XG5cdFx0Y29uc29sZS5sb2coJ1N3aXRjaGVkIHRvIFhNTEh0dHBSZXF1ZXN0Jyk7XG5cdFx0c2V0U3RhdGVSZXF1ZXN0SW50ZXJ2YWwoKTtcblx0XHRlbWl0KCdyZWFkeScpO1xuXHR9IGVsc2V7XG5cdFx0aWYoIXdpbmRvdy5XZWJTb2NrZXQpIHtcblx0XHRcdGNvbnNvbGUubG9nKCdXZWJTb2NrZXQgaXMgbm90IHN1cHBvcnRlZC4gUGxlYXNlIHVwZGF0ZSB5b3VyIGJyb3dzZXIuJyk7XG5cdFx0XHRjb25zb2xlLmxvZygnRmFsbGJhY2sgdG8gWE1MSHR0cFJlcXVlc3QnKTtcblx0XHRcdG9wdGlvbnMud2Vic29ja2V0cyA9IGZhbHNlO1xuXHRcdFx0cmV0dXJuIGluaXQoKTtcblx0XHR9XG5cblx0XHRjb25zb2xlLmxvZygnU3dpdGNoZWQgdG8gV2Vic29ja2V0cycpO1xuXHRcdFxuXHRcdC8vIENsZWFyIFwiZ2V0U3RhdGVcIiBtZXRob2QgcmVxdWVzdCBpbnRlcnZhbCBhbmQgc3dpdGNoIHRvIHdlYnNvY2tldHNcblx0XHRpZih1cGRhdGVTdGF0ZUludGVydmFsICE9PSB1bmRlZmluZWQpIGNsZWFySW50ZXJ2YWwodXBkYXRlU3RhdGVJbnRlcnZhbCk7XG5cblx0XHQvLyBJbml0aWF0ZSBXZWJzb2NrZXQgaGFuZHNoYWtlXG5cdFx0d2Vic29ja2V0ID0gbmV3IFdlYlNvY2tldCgocHJvdG9jb2wgPT09ICdodHRwcycgPyAnd3NzJyA6ICd3cycpICsgJzovLycrb3B0aW9ucy5zZXJ2ZXIrJy8nLCdqc29uLmFwaS5zbWlsZS1zb2Z0LmNvbScpO1xuXHRcdGluaXRXZWJzb2NrZXRFdmVudHMod2Vic29ja2V0KTtcblx0fVxufVxuXG4vKipcbiAqIFNlbmQgcmVxdWVzdCB0byB0aGUgc2VydmVyIHZpYSBYTUxIdHRwUmVxdWVzdCBvciBXZWJzb2NrZXRzXG4gKiBAcGFyYW0gIHtTdHJpbmd9IG1ldGhvZCBTZXJ2ZXIgQVBJIG1ldGhvZFxuICogQHBhcmFtICB7T2JqZWN0fSBwYXJhbXMgUmVxdWVzdCBwYXJhbWV0ZXJzXG4gKiBAcGFyYW0gIHtOdW1iZXJ9IGlkICAgICBDYWxsYmFjayBpZC4gU2VuZCBmcm9tIHNlcnZlciB0byBjbGllbnQgdmlhIFdlYnNvY2tldHNcbiAqIEByZXR1cm4ge1N0cmluZ30gICAgICAgIFJldHVybnMgcmVzcG9uc2UgZnJvbSB0aGUgc2VydmVyXG4gKi9cbmZ1bmN0aW9uIHNlbmRSZXF1ZXN0KG1ldGhvZCwgcGFyYW1zLCBjYWxsYmFjayl7XG5cdHZhciBqc29ucnBjID0ge30sIHhociwgcGFyc2VkSlNPTiwgcmVxdWVzdFRpbWVyLCBlcnIgPSBudWxsO1xuXHRqc29ucnBjLm1ldGhvZCA9IG1ldGhvZDtcblxuXHRpZihwYXJhbXMpIGpzb25ycGMucGFyYW1zID0gcGFyYW1zO1xuXHRpZih0eXBlb2YgY2FsbGJhY2sgPT09ICdudW1iZXInKSBqc29ucnBjLmlkID0gY2FsbGJhY2s7XG5cblx0anNvbnJwYyA9IEpTT04uc3RyaW5naWZ5KGpzb25ycGMpO1xuXG5cdGlmKG9wdGlvbnMud2Vic29ja2V0cylcblx0XHR3ZWJzb2NrZXQuc2VuZChqc29ucnBjKTtcblx0ZWxzZXtcblx0XHR4aHIgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKTtcblx0XHR4aHIub3BlbihcIlBPU1RcIiwgcHJvdG9jb2wrJzovLycrb3B0aW9ucy5zZXJ2ZXIrXCIvXCIsIHRydWUpO1xuXG5cdFx0cmVxdWVzdFRpbWVyID0gc2V0VGltZW91dChmdW5jdGlvbigpe1xuXHRcdFx0eGhyLmFib3J0KCk7XG5cdFx0fSwgMzAwMDApO1xuXHRcdHhoci5vbnJlYWR5c3RhdGVjaGFuZ2UgPSBmdW5jdGlvbigpIHtcblx0XHRcdGlmICh4aHIucmVhZHlTdGF0ZT09NCl7XG5cdFx0XHRcdGNsZWFyVGltZW91dChyZXF1ZXN0VGltZXIpO1xuXHRcdFx0XHRpZih4aHIucmVzcG9uc2UpIHtcblx0XHRcdFx0XHRwYXJzZWRKU09OID0gSlNPTi5wYXJzZSh4aHIucmVzcG9uc2UpO1xuXHRcdFx0XHRcdGlmKHBhcnNlZEpTT04uZXJyb3IpIHtcblx0XHRcdFx0XHRcdGVyciA9IHBhcnNlZEpTT04uZXJyb3I7XG5cdFx0XHRcdFx0XHRlbWl0KCdFcnJvcicsIHsgbW9kdWxlOiBtb2R1bGVOYW1lLCBlcnJvcjogIGVycn0pO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0XHRpZihjYWxsYmFjaykge1xuXHRcdFx0XHRcdFx0Y2FsbGJhY2socGFyc2VkSlNPTi5yZXN1bHQpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH07XG5cdFx0eGhyLnNldFJlcXVlc3RIZWFkZXIoJ0NvbnRlbnQtVHlwZScsICdhcHBsaWNhdGlvbi9qc29uOyBjaGFyc2V0PVVURi04Jyk7XG5cdFx0eGhyLnNlbmQoanNvbnJwYyk7XG5cdH1cbn1cblxuLyoqXG4gKiBHZXQgaW5mb3JtYXRpb24gb2YgY3VycmVudCBwcm9jZXNzXG4gKiBMaXN0IG9mIHByb2Nlc3MgaWRzOlxuICogMSAtICdJbmNvbWluZyBjYWxsJ1xuICogNyAtICdJbmNvbWluZyBjaGF0J1xuICogMzIgLSAnT3V0Z29pbmcgY2FsbCdcbiAqIDEyOSAtICdPdXRnb2luZyBhdXRvZGlhbCdcbiAqIDI1NyAtICAnT3V0Z29pbmcgY2FsbGJhY2snXG4gKiBcbiAqIEByZXR1cm4ge09iamVjdH0gY3VycmVudCBwcm9jZXNzIGluZm9ybWF0aW9uXG4gKi9cbmZ1bmN0aW9uIGdldFByb2Nlc3MoKXtcblx0c2VuZFJlcXVlc3QoJ2dldFByb2Nlc3MnLCBudWxsLCAob3B0aW9ucy53ZWJzb2NrZXRzID8gNyA6IHNldFByb2Nlc3MpKTtcbn1cblxuLyoqXG4gKiBHZXQgaW5mb3JtYXRpb24gb2YgY3VycmVudCBjbGllbnQncyBzdGF0ZVxuICogUG9zc2libGUgc3RhdGVzOlxuICogMCAtICdVbnJlZ2lzdGVyZWQnXG4gKiAxIC0gJ1BhdXNlJ1xuICogMyAtICdJbmNvbWluZyBjYWxsJ1xuICogNCAtICdPdXRnb2luZyBjYWxsJ1xuICogNSAtICdDb25uZWN0ZWQgd2l0aCBpbmNvbW1pbmcgY2FsbCdcbiAqIDYgLSAnV3JhcCdcbiAqIDcgLSAnR2VuZXJpYyB0YXNrJ1xuICogOCAtICdJZGxlJ1xuICogOSAtICdDb25uZWN0ZWQgd2l0aCBvdXRnb2luZyBjYWxsJ1xuICogXG4gKiBAcmV0dXJuIHtPYmplY3R9IGN1cnJlbnQgY2xpZW50J3Mgc3RhdGVcbiAqIFxuICovXG5mdW5jdGlvbiBnZXRTdGF0ZSgpe1xuXHRzZW5kUmVxdWVzdCgnZ2V0U3RhdGUnLCBudWxsLCAob3B0aW9ucy53ZWJzb2NrZXRzID8gNSA6IHNldFN0YXRlKSk7XG59XG5cbi8qKlxuICogU3RhdGUgY2hhZ2UgZXZlbnQgcmVjZWl2ZWQgZnJvbSB0aGUgc2VydmVyXG4gKi9cbmZ1bmN0aW9uIHNldFN0YXRlKHN0YXRlSW5mbyl7XG5cdGVtaXQoJ3N0YXRlY2hhbmdlJywgc3RhdGVJbmZvKTtcbn1cblxuLyoqXG4gKiBDdXJyZW50IHByb2Nlc3MgaW5mb3JtYXRpb24gcmVjZWl2ZWQgZnJvbSB0aGUgc2VydmVyXG4gKiBAcGFyYW0ge09iamVjdH0gcHJvY2Vzc0luZm8gcHJvY2VzcyBpbmZvcm1hdGlvblxuICogQHJldHVybiBub25lXG4gKi9cbmZ1bmN0aW9uIHNldFByb2Nlc3MocHJvY2Vzc0luZm8pe1xuXHRlbWl0KCdwcm9jZXNzY2hhbmdlJywgcHJvY2Vzc0luZm8pO1xufVxuXG4vKipcbiAqIE1vZHVsZSdzIGluaXRpYXRpb24gZnVuY3Rpb24gdGhhdCBhY2NlcHRzIGluaXRpYXRpb24gb3B0aW9uc1xuICogXG4gKiBAcGFyYW0gIHtPYmplY3R9IG9wdHMgbW9kdWxlJ3MgaW5pdGlhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJuIHtPYmplY3R9ICAgICAgW2Rlc2NyaXB0aW9uXVxuICovXG5mdW5jdGlvbiBjbGllbnQob3B0cyl7XG5cdGlmKG9wdHMpIG9wdGlvbnMgPSB1dGlscy5kZWVwRXh0ZW5kKG9wdGlvbnMsIG9wdHMpO1xuXHRpZihpbml0aWF0ZWQpIHJldHVybiBjb25zb2xlLndhcm4oJ01vZHVsZSAnK21vZHVsZU5hbWUrJyBhbHJlYWR5IGluaXRpYXRlZCwgZG8gbm90aGluZycpO1xuXHRjb25zb2xlLmxvZygnSW5pdGlhdGluZyAnK29wdGlvbnMubW9kdWxlTmFtZSsnIG1vZHVsZSB3aXRoIG9wdGlvbnM6ICcsIG9wdGlvbnMpO1xuXHRpbml0KCk7XG5cdGluaXRpYXRlZCA9IHRydWU7XG5cdHJldHVybiBhcGk7XG59XG5cbmFwaSA9IHtcblxuXHQvLyBDdXJyZW50IHByb2Nlc3MgaW5mb1xuXHRwcm9jZXNzOiB7fSxcblxuXHQvLyBDdXJyZW50IHN0YXRlXG5cdHN0YXRlOiBudWxsLFxuXG5cdC8vIEN1cnJlbnQgc3Vic3RhdGVcblx0c3Vic3RhdGU6IG51bGwsXG5cblx0Ly8gRXZlbnQgc3Vic2NyaXB0aW9uIGZ1bmN0aW9uXG5cdG9uOiBvbixcblxuXHQvLyBFdmVudCBlbWl0dGluZyBmdW5jdGlvblxuXHRlbWl0OiBlbWl0LFxuXG5cdC8qKlxuXHQgKiBJbml0aWF0ZSBvdXRnb2luZyBjYWxsXG5cdCAqIEBwYXJhbSAge1N0cmluZ30gbnVtYmVyIHRlbGVwaG9uZSBudW1iZXIgdG8gZGlhbFxuXHQgKiBAcmV0dXJuIG5vbmVcblx0ICovXG5cdGNhbGw6IGZ1bmN0aW9uKG51bWJlcil7XG5cdFx0aWYob3B0aW9ucy53ZWJydGMpIHtcblx0XHRcdFdlYlJUQy5hdWRpb2NhbGwobnVtYmVyKTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0c2VuZFJlcXVlc3QoJ2luaXRDYWxsJywgeyBudW1iZXI6IG51bWJlciB9KTtcblx0XHR9XG5cdH0sXG5cblx0LyoqXG5cdCAqIEFuc3dlciB0byBpbmNvbWluZyBjYWxsXG5cdCAqIEByZXR1cm4gbm9uZVxuXHQgKi9cblx0YW5zd2VyOiBmdW5jdGlvbigpe1xuXHRcdGlmKG9wdGlvbnMud2VicnRjKSB7XG5cdFx0XHRXZWJSVEMuYW5zd2VyKCk7XG5cdFx0fSBlbHNlIHtcblx0XHRcdHNlbmRSZXF1ZXN0KCdhbnN3ZXJDYWxsJyk7XG5cdFx0fVxuXHR9LFxuXG5cdC8qKlxuXHQgKiBQcmVzcyBob2xkIGJ1dHRvblxuXHQgKiBAcmV0dXJuIG5vbmVcblx0ICovXG5cdGhvbGQ6IGZ1bmN0aW9uKCl7XG5cdFx0Ly8gaWYob3B0aW9ucy53ZWJydGMpIHtcblx0XHQvLyBcdFdlYlJUQy5ob2xkKCk7XG5cdFx0Ly8gfSBlbHNlIHtcblx0XHRcdHNlbmRSZXF1ZXN0KCdwcmVzc0hvbGQnKTtcblx0XHQvLyB9XG5cdH0sXG5cblx0LyoqXG5cdCAqIENoYW5nZSBhZ2VudCdzIHN0YXRlIHRvIElETEVcblx0ICogQ291bGQgYmUgY2FsbGVkIG9ubHkgaWYgYWdlbnQgaXMgZWl0aGVyIGluIFdSQVAgb3IgUEFVU0Ugc3RhdGVzXG5cdCAqIEByZXR1cm4gbm9uZVxuXHQgKi9cblx0aWRsZTogZnVuY3Rpb24oKXtcblx0XHRpZihhcGkuc3RhdGUgPT09IDEgfHwgYXBpLnN0YXRlID09PSA2KSB7XG5cdFx0XHRzZW5kUmVxdWVzdCgnc2V0UGF1c2VTdGF0ZScsIHsgc3RhdGU6IDAgfSk7XG5cdFx0fSBlbHNlIHtcblx0XHRcdGNvbnNvbGUubG9nKCdOb3QgaW4gV1JBUCBvciBQQVVTRSwgZG8gbm90aGluZy4nKTtcblx0XHR9XG5cdH0sXG5cblx0LyoqXG5cdCAqIFByZXNzIGNvbmZlcmVuY2UgYnV0dG9uXG5cdCAqIEByZXR1cm4gbm9uZVxuXHQgKi9cblx0Y29uZmVyZW5jZTogZnVuY3Rpb24oKXtcblx0XHRzZW5kUmVxdWVzdCgncHJlc3NDb25mZXJlbmNlJyk7XG5cdH0sXG5cblx0LyoqXG5cdCAqIERyb3AgY3VycmVudCBjYWxsXG5cdCAqIEByZXR1cm4gbm9uZVxuXHQgKi9cblx0ZHJvcDogZnVuY3Rpb24oKXtcblx0XHRpZihvcHRpb25zLndlYnJ0Yykge1xuXHRcdFx0V2ViUlRDLnRlcm1pbmF0ZSgpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRzZW5kUmVxdWVzdCgnZHJvcENhbGwnKTtcblx0XHR9XG5cdH0sXG5cblx0LyoqXG5cdCAqIENsb3NlIGN1cnJlbnQgcHJvY2VzcyB3aXRoIGV4aXQgY29kZVxuXHQgKiBAcGFyYW0gIHtTdHJpbmd9IHByb2Nlc3NpZCBwcm9jZXNzIGlkXG5cdCAqIEBwYXJhbSAge051bWJlcn0gZXhpdGNvZGUgIGV4aXQgY29kZVxuXHQgKiBAcmV0dXJuIG5vbmVcblx0ICovXG5cdGNsb3NlOiBmdW5jdGlvbihwcm9jZXNzaWQsIGV4aXRjb2RlKXtcblx0XHRlcnJvcm1zZyA9ICcnO1xuXHRcdGlmKCFwcm9jZXNzaWQpIGVycm9ybXNnICs9ICdwcm9jZXNzaWQgaXMgbm90IGRlZmluZWRcXG4nO1xuXHRcdGlmKCFleGl0Y29kZSkgZXJyb3Jtc2cgKz0gJ2V4aXRjb2RlIGlzIG5vdCBkZWZpbmVkXFxuJztcblx0XHRpZihlcnJvcm1zZyAhPT0gJycpIHJldHVybiBjb25zb2xlLmVycm9yKCdDYW5cXCd0IGNsb3NlIHByb2Nlc3M6XFxuJyArIGVycm9ybXNnKTtcblxuXHRcdHNlbmRSZXF1ZXN0KCdjbG9zZVByb2Nlc3MnLCB7IHByb2Nlc3NpZDogcHJvY2Vzc2lkLCBleGl0Y29kZTogZXhpdGNvZGUgfSk7XG5cdH0sXG5cblx0LyoqXG5cdCAqIFNldCBwYXVzZSBzdGF0ZVxuXHQgKiBQb3NzaWJsZSBzdGF0ZXM6XG5cdCAqIDAgLSBzd2l0Y2ggdG8gSURMRSBzdGF0ZVxuXHQgKiBBbnkgcGF1c2UgY29kZXMgdGhhdCB3ZXJlIHNldCBpbiBBZG1pbiBTdHVkaW9cblx0ICogXG5cdCAqIEBwYXJhbSB7TnVtYmVyfSBzdGF0ZSAgIHBhdXNlIHN0YXRlXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSBjb21tZW50IGNvbW1lbnQgc3RyaW5nXG5cdCAqIEByZXR1cm4gbm9uZVxuXHQgKi9cblx0cGF1c2U6IGZ1bmN0aW9uKHN0YXRlLCBjb21tZW50KXtcblx0XHRzZW5kUmVxdWVzdCgnc2V0UGF1c2VTdGF0ZScsIHsgc3RhdGU6IHN0YXRlLCBjb21tZW50OiBjb21tZW50IHx8ICcnIH0pO1xuXHR9XG5cbn07XG5cbm9uKCdzdGF0ZWNoYW5nZScsIGZ1bmN0aW9uIChwYXJhbXMpe1xuXHRhcGkuc3RhdGUgPSBwYXJhbXMuc3RhdGU7XG5cdGFwaS5zdWJzdGF0ZSA9IHBhcmFtcy5zdWJzdGF0ZTtcbn0pO1xuXG5vbigncHJvY2Vzc2NoYW5nZScsIGZ1bmN0aW9uIChwYXJhbXMpe1xuXHRhcGkucHJvY2VzcyA9IHBhcmFtcztcbn0pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGNsaWVudDsiLCJ2YXIgc3VicyA9IHt9O1xudmFyIGhPUCA9IHN1YnMuaGFzT3duUHJvcGVydHk7XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuXHRvbjogZnVuY3Rpb24oc3ViLCBsaXN0ZW5lcikge1xuXHRcdC8vIENyZWF0ZSB0aGUgc3Vic2NyaXB0aW9uJ3Mgb2JqZWN0IGlmIG5vdCB5ZXQgY3JlYXRlZFxuXHRcdGlmKCFoT1AuY2FsbChzdWJzLCBzdWIpKSBzdWJzW3N1Yl0gPSBbXTtcblxuXHRcdC8vIEFkZCB0aGUgbGlzdGVuZXIgdG8gcXVldWVcblx0XHR2YXIgaW5kZXggPSBzdWJzW3N1Yl0ucHVzaChsaXN0ZW5lcikgLTE7XG5cblx0XHQvLyBQcm92aWRlIGhhbmRsZSBiYWNrIGZvciByZW1vdmFsIG9mIHN1YnNjcmlwdGlvblxuXHRcdHJldHVybiB7XG5cdFx0XHRvZmY6IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRkZWxldGUgc3Vic1tzdWJdW2luZGV4XTtcblx0XHRcdH1cblx0XHR9O1xuXHR9LFxuXHRlbWl0OiBmdW5jdGlvbihzdWIsIGluZm8pIHtcblx0XHQvLyBJZiB0aGUgc3Vic2NyaXB0aW9uIGRvZXNuJ3QgZXhpc3QsIG9yIHRoZXJlJ3Mgbm8gbGlzdGVuZXJzIGluIHF1ZXVlLCBqdXN0IGxlYXZlXG5cdFx0aWYoIWhPUC5jYWxsKHN1YnMsIHN1YikpIHJldHVybjtcblxuXHRcdC8vIEN5Y2xlIHRocm91Z2ggc3Vic2NyaXB0aW9ucyBxdWV1ZSwgZmlyZSFcblx0XHRzdWJzW3N1Yl0uZm9yRWFjaChmdW5jdGlvbihpdGVtKSB7XG5cdFx0XHRpdGVtKGluZm8gIT09IHVuZGVmaW5lZCA/IGluZm8gOiB7fSk7XG5cdFx0fSk7XG5cdH1cbn07IiwidmFyIFNtaWxlU29mdCA9IGdsb2JhbC5TbWlsZVNvZnQgfHwge307XG52YXIgb3B0aW9ucyA9IHJlcXVpcmUoJy4vb3B0aW9ucycpO1xudmFyIGFwaSA9IHJlcXVpcmUoJy4vYXBpJyk7XG5cblNtaWxlU29mdFtvcHRpb25zLm1vZHVsZU5hbWVdID0gYXBpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNtaWxlU29mdDsiLCJtb2R1bGUuZXhwb3J0cyA9IHtcblx0bW9kdWxlTmFtZTogJ0FnZW50Jyxcblx0Ly8gU2VydmVyIElQIGFkZHJlc3Mgb3IgRG9tYWluIG5hbWUgYW5kIHNlcnZlciBwb3J0IChpZiBvdGhlciB0aGFuIDgwLzQ0Mylcblx0Ly8gRXhwOiAxOTIuMTY4LjEuMTAwOjg4ODAgb3Igd3d3LmV4YW1wbGUuY29tXG5cdHNlcnZlcjogZ2xvYmFsLmxvY2F0aW9uLmhvc3QsXG5cdHVwZGF0ZUludGVydmFsOiAxMDAwLFxuXHR3ZWJzb2NrZXRzOiB0cnVlLFxuXHR3ZWJydGM6IHRydWUsXG5cdHNpcDoge1xuXHRcdHJlYWxtOiBnbG9iYWwubG9jYXRpb24uaG9zdCxcblx0XHR3c19zZXJ2ZXJzOiAnd3NzOi8vJytnbG9iYWwubG9jYXRpb24uaG9zdCxcblx0XHQvLyBhdXRob3JpemF0aW9uX3VzZXI6ICcnLFxuXHRcdC8vIHVyaTogJycsXG5cdFx0Ly8gcGFzc3dvcmQ6ICcnLFxuXHRcdC8vIGRpc3BsYXlfbmFtZTogJycsXG5cdFx0cmVnaXN0ZXI6IHRydWVcblx0fSxcblx0YXVkaW9SZW1vdGU6IG51bGxcbn07IiwiXG5tb2R1bGUuZXhwb3J0cyA9IHtcblx0ZXh0ZW5kT2JqOiBleHRlbmRPYmosXG5cdGRlZXBFeHRlbmQ6IGRlZXBFeHRlbmRcbn07XG5cbi8qKlxuICogRXh0ZW5kJ3Mgb2JqZWN0IHdpdGggcHJvcGVydGllc1xuICogXG4gKiBAcmV0dXJuIHtPYmplY3R9IE1lcmdlZCBvYmplY3RzXG4gKi9cbmZ1bmN0aW9uIGV4dGVuZE9iaih0YXJnZXQsIHNvdXJjZSl7XG5cdHZhciBhID0gT2JqZWN0LmNyZWF0ZSh0YXJnZXQpO1xuXHRPYmplY3Qua2V5cyhzb3VyY2UpLm1hcChmdW5jdGlvbiAocHJvcCkge1xuXHRcdHByb3AgaW4gYSAmJiAoYVtwcm9wXSA9IHNvdXJjZVtwcm9wXSk7XG5cdH0pO1xuXHRyZXR1cm4gYTtcbn1cblxuZnVuY3Rpb24gZGVlcEV4dGVuZChkZXN0aW5hdGlvbiwgc291cmNlKSB7XG4gIGZvciAodmFyIHByb3BlcnR5IGluIHNvdXJjZSkge1xuICAgIGlmIChzb3VyY2VbcHJvcGVydHldICYmIHNvdXJjZVtwcm9wZXJ0eV0uY29uc3RydWN0b3IgJiZcbiAgICAgc291cmNlW3Byb3BlcnR5XS5jb25zdHJ1Y3RvciA9PT0gT2JqZWN0KSB7XG4gICAgICBkZXN0aW5hdGlvbltwcm9wZXJ0eV0gPSBkZXN0aW5hdGlvbltwcm9wZXJ0eV0gfHwge307XG4gICAgICBhcmd1bWVudHMuY2FsbGVlKGRlc3RpbmF0aW9uW3Byb3BlcnR5XSwgc291cmNlW3Byb3BlcnR5XSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGRlc3RpbmF0aW9uW3Byb3BlcnR5XSA9IHNvdXJjZVtwcm9wZXJ0eV07XG4gICAgfVxuICB9XG4gIHJldHVybiBkZXN0aW5hdGlvbjtcbn0iLCJ2YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzJyk7XG52YXIgZXZlbnRzID0gcmVxdWlyZSgnLi9ldmVudHMnKTtcbnZhciBvcHRpb25zID0ge307XG52YXIgc2lwQ2xpZW50O1xudmFyIHNpcFNlc3Npb247XG52YXIgc2lwQ2FsbEV2ZW50cztcblxuZnVuY3Rpb24gaXNXZWJydGNTdXBwb3J0ZWQoKXtcblx0dmFyIFJUQyA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiB8fCB3aW5kb3cubW96UlRDUGVlckNvbm5lY3Rpb24gfHwgd2luZG93LndlYmtpdFJUQ1BlZXJDb25uZWN0aW9uLFxuXHRcdHVzZXJNZWlkYSA9IG5hdmlnYXRvci5nZXRVc2VyTWVkaWEgfHwgbmF2aWdhdG9yLndlYmtpdEdldFVzZXJNZWRpYSB8fCBuYXZpZ2F0b3IubXNHZXRVc2VyTWVkaWEgfHwgbmF2aWdhdG9yLm1vekdldFVzZXJNZWRpYSB8fCBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYSxcblx0XHRpY2UgPSB3aW5kb3cubW96UlRDSWNlQ2FuZGlkYXRlIHx8IHdpbmRvdy5SVENJY2VDYW5kaWRhdGU7XG5cblx0cmV0dXJuICEhUlRDICYmICEhdXNlck1laWRhICYmICEhaWNlO1xufVxuXG5mdW5jdGlvbiBpbml0SnNTSVBFdmVudHMoKXtcblx0c2lwQ2xpZW50Lm9uKCdjb25uZWN0ZWQnLCBmdW5jdGlvbihlKXsgY29uc29sZS5sb2coJ3NpcCBjb25uZWN0ZWQgZXZlbnQ6ICcsIGUpOyB9KTtcblx0c2lwQ2xpZW50Lm9uKCdkaXNjb25uZWN0ZWQnLCBmdW5jdGlvbihlKXsgY29uc29sZS5sb2coJ3NpcCBkaXNjb25uZWN0ZWQgZXZlbnQ6ICcsIGUpOyB9KTtcblx0c2lwQ2xpZW50Lm9uKCduZXdNZXNzYWdlJywgZnVuY3Rpb24oZSl7IGNvbnNvbGUubG9nKCdzaXAgbmV3TWVzc2FnZSBldmVudDogJywgZSk7IH0pO1xuXHRzaXBDbGllbnQub24oJ25ld1JUQ1Nlc3Npb24nLCBmdW5jdGlvbihlKXtcblx0XHRjb25zb2xlLmxvZygnc2lwIG5ld1JUQ1Nlc3Npb24gZXZlbnQ6ICcsIGUpO1xuXHRcdGV2ZW50cy5lbWl0KCd3ZWJydGMvbmV3UlRDU2Vzc2lvbicsIGUpO1xuXHRcdHNpcFNlc3Npb24gPSBlLnNlc3Npb247XG5cdH0pO1xuXHRzaXBDbGllbnQub24oJ3JlZ2lzdGVyZWQnLCBmdW5jdGlvbihlKXsgY29uc29sZS5sb2coJ3NpcCByZWdpc3RlcmVkIGV2ZW50OiAnLCBlKTsgfSk7XG5cdHNpcENsaWVudC5vbigndW5yZWdpc3RlcmVkJywgZnVuY3Rpb24oZSl7IGNvbnNvbGUubG9nKCdzaXAgdW5yZWdpc3RlcmVkIGV2ZW50OiAnLCBlKTsgfSk7XG5cdHNpcENsaWVudC5vbigncmVnaXN0cmF0aW9uRmFpbGVkJywgZnVuY3Rpb24oZSl7IGNvbnNvbGUubG9nKCdzaXAgcmVnaXN0cmF0aW9uRmFpbGVkIGV2ZW50OiAnLCBlKTsgfSk7XG5cblx0c2lwQ2FsbEV2ZW50cyA9IHtcblx0XHRwcm9ncmVzczogZnVuY3Rpb24oZSl7XG5cdFx0XHRjb25zb2xlLmxvZygnY2FsbCBwcm9ncmVzcyBldmVudDogJywgZSk7XG5cdFx0XHRldmVudHMuZW1pdCgnd2VicnRjL3Byb2dyZXNzJywgZSk7XG5cdFx0fSxcblx0XHRmYWlsZWQ6IGZ1bmN0aW9uKGUpe1xuXHRcdFx0Y29uc29sZS5sb2coJ2NhbGwgZmFpbGVkIGV2ZW50OicsIGUpO1xuXHRcdFx0ZXZlbnRzLmVtaXQoJ3dlYnJ0Yy9mYWlsZWQnLCBlKTtcblx0XHR9LFxuXHRcdGVuZGVkOiBmdW5jdGlvbihlKXtcblx0XHRcdGNvbnNvbGUubG9nKCdjYWxsIGVuZGVkIGV2ZW50OiAnLCBlKTtcblx0XHRcdGV2ZW50cy5lbWl0KCd3ZWJydGMvZW5kZWQnLCBlKTtcblx0XHR9LFxuXHRcdGNvbmZpcm1lZDogZnVuY3Rpb24oZSl7XG5cdFx0XHRjb25zb2xlLmxvZygnY2FsbCBjb25maXJtZWQgZXZlbnQ6ICcsIGUpO1xuXHRcdFx0ZXZlbnRzLmVtaXQoJ3dlYnJ0Yy9jb25maXJtZWQnLCBlKTtcblx0XHR9LFxuXHRcdHNkcDogZnVuY3Rpb24oZSl7XG5cdFx0XHRjb25zb2xlLmxvZygnc2RwIGV2ZW50OiAnLCBlKTtcblx0XHR9XG5cdH07XG59XG5cbmZ1bmN0aW9uIGlzRXN0YWJsaXNoZWQoKXtcblx0cmV0dXJuIHNpcFNlc3Npb24uaXNFc3RhYmxpc2hlZCgpO1xufVxuXG5mdW5jdGlvbiBpc0luUHJvZ3Jlc3MoKXtcblx0cmV0dXJuIHNpcFNlc3Npb24uaXNJblByb2dyZXNzKCk7XG59XG5cbmZ1bmN0aW9uIGlzRW5kZWQoKXtcblx0cmV0dXJuIHNpcFNlc3Npb24uaXNFbmRlZCgpO1xufVxuXG5mdW5jdGlvbiB1bnJlZ2lzdGVyKCl7XG5cdHNpcENsaWVudC5zdG9wKCk7XG59XG5cbmZ1bmN0aW9uIGF1ZGlvY2FsbChudW1iZXIpe1xuXHRzaXBTZXNzaW9uID0gc2lwQ2xpZW50LmNhbGwobnVtYmVyLCB7XG5cdFx0ZXZlbnRIYW5kbGVyczogc2lwQ2FsbEV2ZW50cyxcblx0XHRtZWRpYUNvbnN0cmFpbnRzOiB7IGF1ZGlvOiB0cnVlLCB2aWRlbzogZmFsc2UgfVxuXHR9KTtcblxuXHRzaXBTZXNzaW9uLmNvbm5lY3Rpb24uYWRkRXZlbnRMaXN0ZW5lcigndHJhY2snLCBmdW5jdGlvbihlKSB7XG5cdFx0ZXZlbnRzLmVtaXQoJ3dlYnJ0Yy9hZGRzdHJlYW0nLCBlKTtcblx0XHRpZihvcHRpb25zLmF1ZGlvUmVtb3RlLnNyY09iamVjdCAhPT0gZS5zdHJlYW1zWzBdKSBvcHRpb25zLmF1ZGlvUmVtb3RlLnNyY09iamVjdCA9IGUuc3RyZWFtc1swXTtcblx0fSlcbn1cblxuZnVuY3Rpb24gdGVybWluYXRlKCl7XG5cdHNpcFNlc3Npb24udGVybWluYXRlKHtcblx0XHRzdGF0dXNfY29kZTogMjAwXG5cdH0pO1xufVxuXG5mdW5jdGlvbiBhbnN3ZXIoKXtcblx0Y29uc29sZS5sb2coJ2Fuc3dlcjogJyxzaXBDbGllbnQpO1xuXHRzaXBTZXNzaW9uLmFuc3dlcigpO1xufVxuXG5mdW5jdGlvbiBob2xkKCl7XG5cdGNvbnNvbGUubG9nKCdob2xkOiAnLCBzaXBTZXNzaW9uLmlzT25Ib2xkKCkpO1xuXHRpZihzaXBTZXNzaW9uICYmIHNpcFNlc3Npb24uaXNPbkhvbGQoKS5sb2NhbCkge1xuXHRcdHNpcFNlc3Npb24udW5ob2xkKCk7XG5cdH0gZWxzZSB7XG5cdFx0c2lwU2Vzc2lvbi5ob2xkKCk7XG5cdH1cbn1cblxuZnVuY3Rpb24gY3JlYXRlUmVtb3RlQXVkaW8oKXtcblx0dmFyIGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYXVkaW8nKTtcblx0ZWwuc2V0QXR0cmlidXRlKCdhdXRvcGxheScsICdhdXRvcGxheScpO1xuXHRkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGVsKTtcblx0cmV0dXJuIGVsO1xufVxuXG5mdW5jdGlvbiBpbml0KHBhcmFtcyl7XG5cdHZhciBKc1NJUCA9IGdsb2JhbC5Kc1NJUDtcblx0dmFyIHNvY2tldDtcblxuXHRjb25zb2xlLmxvZygnSnNTSVA6ICcsIGdsb2JhbCwgSnNTSVApO1xuXG5cdG9wdGlvbnMgPSB1dGlscy5kZWVwRXh0ZW5kKG9wdGlvbnMsIHBhcmFtcyk7XG5cdG9wdGlvbnMuYXVkaW9SZW1vdGUgPSBjcmVhdGVSZW1vdGVBdWRpbygpO1xuXG5cdHNvY2tldCA9IG5ldyBKc1NJUC5XZWJTb2NrZXRJbnRlcmZhY2Uob3B0aW9ucy5zaXAud3Nfc2VydmVycyk7XG5cdG9wdGlvbnMuc2lwLnNvY2tldHMgPSBbc29ja2V0XTtcblxuXHRpZihvcHRpb25zLnNpcC5yZWdpc3RlciA9PT0gdW5kZWZpbmVkKSBvcHRpb25zLnNpcC5yZWdpc3RlciA9IGZhbHNlO1xuXG5cdGNvbnNvbGUubG9nKCdJbml0aWF0aW5nIFdlYlJUQyBtb2R1bGU6Jywgb3B0aW9ucyk7XG5cdFxuXHRzaXBDbGllbnQgPSBuZXcgSnNTSVAuVUEob3B0aW9ucy5zaXApO1xuXHRpbml0SnNTSVBFdmVudHMoKTtcblx0c2lwQ2xpZW50LnN0YXJ0KCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuXHRpbml0OiBpbml0LFxuXHR1bnJlZ2lzdGVyOiB1bnJlZ2lzdGVyLFxuXHRhdWRpb2NhbGw6IGF1ZGlvY2FsbCxcblx0dGVybWluYXRlOiB0ZXJtaW5hdGUsXG5cdGFuc3dlcjogYW5zd2VyLFxuXHRob2xkOiBob2xkLFxuXHRpc0luUHJvZ3Jlc3M6IGlzSW5Qcm9ncmVzcyxcblx0aXNFc3RhYmxpc2hlZDogaXNFc3RhYmxpc2hlZCxcblx0aXNFbmRlZDogaXNFbmRlZCxcblx0aXNTdXBwb3J0ZWQ6IGlzV2VicnRjU3VwcG9ydGVkXG59OyJdfQ==
