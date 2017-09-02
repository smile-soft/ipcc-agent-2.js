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