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