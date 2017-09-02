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