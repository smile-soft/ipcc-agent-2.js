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