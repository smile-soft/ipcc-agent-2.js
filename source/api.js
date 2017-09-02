
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