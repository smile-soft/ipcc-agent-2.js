
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