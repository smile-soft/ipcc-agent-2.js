var gulp = require('gulp');
var source = require('vinyl-source-stream');
var streamify = require('gulp-streamify');
var uglify = require('gulp-uglify');
var rename = require('gulp-rename');
var notify = require('gulp-notify');
var browserify = require('browserify');

var basePath = {
	src: 'source/',
	dest: './',
	test: 'test/'
};

function bundle(cb) {
	var bundleStream = browserify(basePath.src+'main.js', {
		standalone: 'SmileSoft',
		bundleExternal: false,
		debug: true
	}).bundle();

	bundleStream
	.pipe(source(basePath.src+'main.js'))
	.pipe(rename('ipcc-agent.js'))
	.pipe(gulp.dest(basePath.dest))
	.pipe(streamify(uglify()))
	.pipe(rename({suffix: '.min'}))
	.pipe(gulp.dest(basePath.dest))
	.pipe(notify({ message: 'bundle task complete' }));

	cb();
}

function build(cb) {
	gulp.start(['bundle', 'test']);
	cb();
}

function test(cb) {
	gulp.src(basePath.dest+'ipcc-agent.js')
	.pipe(gulp.dest(basePath.test+'js/'));
	cb();
}

exports.bundle = bundle;
exports.test = test;
